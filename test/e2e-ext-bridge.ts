/**
 * P3 test: the host-side NM bridge over a real WS upgrade + a real nm-host
 * process, with a fake extension (stdio JSON-RPC responder) on the far side.
 *
 * Topology: [bridge (in-proc, fake webServer)] ⇄ WS ⇄ [nm-host child] ⇄ stdio ⇄
 * [fake extension child]. Verifies auth, hello, request/response, events,
 * single-connection replace, and disconnect governance.
 * Run: npx tsx test/e2e-ext-bridge.ts
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nmBridge, mountBridge } from '../src/backend/ext/bridge.ts';
import { runSetup } from '../src/backend/ext/setup.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
void here;

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 6000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await wait(25);
  }
  return cond();
}

// fake webServer faithful to dsh-host-webserver's route tables --------------
const upgrades = new Map<string, (req: any, sock: any, head: Buffer) => void>();
const http = createServer((_req, res) => { res.writeHead(404); res.end(); });
http.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  const h = upgrades.get(path);
  if (!h) { socket.destroy(); return; }
  h(req, socket, head);
});
await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
const port = (http.address() as { port: number }).port;
const fakeWebServer = {
  register: (_r: unknown) => () => undefined,
  registerUpgrade: (route: { path: string; handler: (req: any, sock: any, head: Buffer) => void }) => {
    upgrades.set(route.path, route.handler);
    return () => upgrades.delete(route.path);
  },
  port,
};
const disposeBridge = mountBridge(fakeWebServer);

const home = mkdtempSync(join(tmpdir(), 'p3-bridge-'));
process.env.DSH_HOME = home;
process.env.XDG_CONFIG_HOME = join(home, 'xdg'); // bridge reads token file from here (authority)
const setup = runSetup({ wsUrl: `ws://127.0.0.1:${port}/api/plugins/tool-browser/ws`, home });
check('setup wrote token + manifest', setup.reusedToken === false && setup.manifestPath.length > 0);

const { default: WebSocket } = await import('ws');
function fakeWsExtension(opts: { token: string | null }): Promise<{
  ws: InstanceType<typeof WebSocket>;
  send: (m: unknown) => void;
  events: { type: string; msg?: any; code?: number }[];
  noReply: number;
}> {
  return new Promise((resolve) => {
    const events: { type: string; msg?: any; code?: number }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/plugins/tool-browser/ws`, {
      headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
    });
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', entryId: 'test', protocolVersion: 2, contract: { protocolVersion: 2, nmMaxOutboundBytes: 1048576 } }));
    });
    ws.on('message', (data: Buffer) => {
      const m = JSON.parse(data.toString());
      if (m.type === 'hello_ack') { events.push({ type: 'hello_ack', msg: m }); return; }
      if (typeof m.id === 'number') {
        events.push({ type: 'rpc', msg: m });
        if (!(extApi as { noReply?: number }).noReply) {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { echoed: m.method, params: m.params } }));
        }
        return;
      }
    });
    ws.on('close', (code) => events.push({ type: 'close', code }));
    ws.on('error', (e) => events.push({ type: 'error', code: (e as Error).message.includes('401') ? 401 : 0 }));
    const extApi = { ws, send: (mm: unknown) => ws.send(JSON.stringify(mm)), events, noReply: 0 };
    resolve(extApi as any);
  });
}

// ---- 1. bad token is denied at upgrade ----
{
  const bad = await fakeWsExtension({ token: 'nope' });
  const denied = await waitFor(() => bad.events.some((e) => e.type === 'error' && e.code === 401));
  check('bad token denied (socket destroyed)', denied, JSON.stringify(bad.events));
}

// ---- 2. good token: hello + request/response + events ----
{
  const good = await fakeWsExtension({ token: require_token(home) });
  const ok = await waitFor(() => good.events.some((e) => e.type === 'hello_ack' && e.msg.status === 'ok'));
  check('hello_ack ok on valid token', ok);
  check('bridge reports connected', await waitFor(() => nmBridge.isConnected));

  const res = await nmBridge.request('cdp.send', { tabId: 1, method: 'Page.navigate', params: { url: 'x' } });
  check('request routed to extension and answered', JSON.stringify(res).includes('cdp.send'), JSON.stringify(res));

  const seen: string[] = [];
  const off = nmBridge.onEvent((m) => seen.push(m));
  good.send({ id: 'evt-1', method: 'tab.detached', params: { tabId: 9 } });
  await waitFor(() => seen.length > 0, 2000);
  off();
  check('event fanned out to handlers', seen[0] === 'tab.detached', JSON.stringify(seen));

  // ---- 3. single-connection replace ----
  const second = await fakeWsExtension({ token: require_token(home) });
  await waitFor(() => second.events.some((e) => e.type === 'hello_ack'));
  check('new hello retires the old socket', await waitFor(() => good.events.some((e) => e.type === 'close')));
  check('bridge still connected after replace', nmBridge.isConnected);
  const res2 = await nmBridge.request('tabs.list', {});
  check('request goes to the NEW socket', JSON.stringify(res2).includes('tabs.list'), JSON.stringify(res2));

  // ---- 4. disconnect governance ----
  // A slow extension: never answers, so the pending future is still in flight
  // when the socket drops. closeReply=false makes the fake stub silent.
  second.events.length && (second as any).noReply++;
  const pending = nmBridge.request('tabs.list', {}, 15_000);
  await new Promise((r) => setTimeout(r, 150));
  second.ws.close(4000, 'chrome shutdown');
  let err: Record<string, string> | undefined;
  try { await pending; } catch (e) { err = e as Record<string, string>; }
  check('pending rejected on disconnect with RETRYABLE/bridge_disconnected',
    err?.['category'] === 'RETRYABLE' && err?.['cause'] === 'bridge_disconnected',
    `${err?.['category']}/${err?.['cause']}`);
  check('bridge reports disconnected', await waitFor(() => !nmBridge.isConnected, 2000));
  check('status exposes last close code', nmBridge.status().hasOwnProperty('lastClose'), JSON.stringify(nmBridge.status()['lastClose']));
}

disposeBridge();
http.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

function require_token(h: string): string {
  return JSON.parse(readFileSync(join(h, 'nm-bridge.json'), 'utf8')).token;
}
