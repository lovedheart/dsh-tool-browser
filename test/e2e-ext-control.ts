/**
 * P4 e2e: the chrome-extension backend end-to-end against a fake extension
 * that relays JSON-RPC onto a real Chromium's CDP (test/fixtures/fake-extension.ts).
 * Exercises: kernel → ExtSession → NMBridge → (nm frames) → fake ext → CDP.
 * Run: npx tsx test/e2e-ext-control.ts
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { nmBridge, mountBridge } from '../src/backend/ext/bridge.ts';
import { runSetup } from '../src/backend/ext/setup.ts';
import { createKernelManager } from '../src/kernel/manager.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const FAKE_EXT_TS = join(here, 'fixtures', 'fake-extension.ts');

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 8000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await wait(25);
  }
  return cond();
}

// webserver seam -------------------------------------------------------------
const upgrades = new Map<string, (req: any, sock: any, head: Buffer) => void>();
const http = createServer((_q, res) => {
  res.writeHead(404);
  res.end();
});
http.on('upgrade', (req, socket, head) => {
  const p = new URL(req.url ?? '/', 'http://x').pathname;
  const h = upgrades.get(p);
  if (!h) {
    socket.destroy();
    return;
  }
  h(req, socket, head);
});
await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
const port = (http.address() as { port: number }).port;
const disposeBridge = mountBridge({
  register: () => () => undefined,
  registerUpgrade: (route: { path: string; handler: any }) => {
    upgrades.set(route.path, route.handler);
    return () => upgrades.delete(route.path);
  },
  port,
});

const home = mkdtempSync(join(tmpdir(), 'p4-ctl-'));
process.env.DSH_HOME = home;
process.env.XDG_CONFIG_HOME = join(home, 'xdg');
runSetup({ wsUrl: `ws://127.0.0.1:${port}/api/plugins/tool-browser/ws`, home });
const token = JSON.parse(readFileSync(join(home, 'nm-bridge.json'), 'utf8')).token;

// fake extension process (drives real chromium via CDP) ------------------------
const ext = spawn(process.execPath, ['--import', 'tsx', FAKE_EXT_TS], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, FAKE_EXT_PORT: '9444' },
});
ext.stderr.on('data', (d: Buffer) => process.stderr.write(`[ext] ${d}`));

// In this harness the "nm host" hop is replaced by a WS pump that speaks NM
// frames over the WS messages themselves (fake ext uses raw JSON over its WS,
// mirroring what the real host forwards after unwrapping frames).
const ws = new WebSocket(`ws://127.0.0.1:${port}/api/plugins/tool-browser/ws`, {
  headers: { Authorization: `Bearer ${token}` },
});
ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'hello',
    entryId: 'e2e',
    protocolVersion: 2,
    contract: { protocolVersion: 2, minCompatibleProtocolVersion: 2, nmMaxInboundBytes: 67108864, nmMaxOutboundBytes: 1048576 },
  }));
});
ws.on('message', (data: Buffer) => {
  const m = JSON.parse(data.toString());
  if (m.type === 'hello_ack') return;
  // bridge → "extension": forward to fake ext stdin as an NM frame
  const payload = Buffer.from(data.toString());
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  ext.stdin.write(frame);
});
let extBuf = Buffer.alloc(0);
ext.stdout.on('data', (d: Buffer) => {
  extBuf = Buffer.concat([extBuf, d]);
  for (;;) {
    if (extBuf.length < 4) break;
    const n = extBuf.readUInt32LE(0);
    if (extBuf.length < 4 + n) break;
    const payload = extBuf.subarray(4, 4 + n);
    extBuf = extBuf.subarray(4 + n);
    if (ws.readyState === WebSocket.OPEN) ws.send(payload.toString('utf8'));
  }
});

check('bridge connected to fake extension', await waitFor(() => nmBridge.isConnected));

// kernel over the extension backend --------------------------------------------
const manager = createKernelManager({
  backend: 'chrome-extension',
  headless: true,
  idleTtlMs: 60_000,
  workspaceDir: () => join(tmpdir(), 'p4-work'),
});
// The control link factory needs an owner; default via env-free path: patch by
// re-importing with our own owner through config passthrough is P5 — here the
// session defaults owner to {default/default}, which is fine for e2e.

const page = await manager.execute({
  requestId: 'p4-1',
  owner: { workspace_id: 'p4-ws', session_id: 'p4-sess' },
  code: `
    browser = await Browser.connect();
    page = await browser.open("data:text/html,<title>Ext</title><h1>Hello Ext</h1><input aria-label='Name'><button>Go</button>");
    obs = await page.snapshot();
    st = await browser.sessionStatus();
    return { snap: obs.text.includes('Hello Ext'), variant: st.variant };
  `,
});
check('open + snapshot via extension backend', page.error === undefined && JSON.parse(page.value || '{}').snap === true, JSON.stringify(page.error ?? page.value));
check('variant is chrome-extension', JSON.parse(page.value || '{}').variant === 'chrome-extension', JSON.stringify(page.value));

const act = await manager.execute({
  requestId: 'p4-2',
  owner: { workspace_id: 'p4-ws', session_id: 'p4-sess' },
  code: `
    await page.getByLabel('Name').fill('ada');
    await page.getByRole('button', { name: 'Go' }).click();
    v = await page.getByLabel('Name').inputValue();
    url = (await browser.pages())[0].url;
    return { v, urlHas: url.startsWith('data:') };
  `,
});
check('locator fill + inputValue', act.error === undefined && JSON.parse(act.value || '{}').v === 'ada', JSON.stringify(act.error ?? act.value));

const nav = await manager.execute({
  requestId: 'p4-3',
  owner: { workspace_id: 'p4-ws', session_id: 'p4-sess' },
  code: `
    await page.goto("data:text/html,<b>Second</b>");
    obs = await page.snapshot();
    return { ok: obs.text.includes('Second') };
  `,
});
check('goto within same page', nav.error === undefined && JSON.parse(nav.value || '{}').ok === true, JSON.stringify(nav.error ?? nav.value));

const pages = await manager.execute({
  requestId: 'p4-4',
  owner: { workspace_id: 'p4-ws', session_id: 'p4-sess' },
  code: `
    p2 = await browser.present("data:text/html,<i>two</i>");
    list = await browser.pages();
    return { n: list.length, bothActive: list.filter(x=>x.active).length === 1 };
  `,
});
check('presentPage + pages()', pages.error === undefined && JSON.parse(pages.value || '{}').n === 2, JSON.stringify(pages.error ?? pages.value));

// stale tab → governed RETRYABLE/state_stale
const closed = await manager.execute({
  requestId: 'p4-5',
  owner: { workspace_id: 'p4-ws', session_id: 'p4-sess' },
  code: `
    list = await browser.pages();
    victim = list.find(x => !x.active);
    await browser.closePage(victim);
    try { await browser.switchPage(victim); return { err: 'none' }; }
    catch (e) { return { err: String(e && e.category ? e.category + '/' + e.cause : e).slice(0,80) }; }
  `,
});
check('closed page → governed error', /RETRYABLE\/state_stale|state_stale/.test(JSON.stringify(closed.value ?? closed.error)), JSON.stringify(closed.value ?? closed.error).slice(0, 160));

// regression: after browser.close(), the next call must get a FRESH session
const closedSess = await manager.execute({
  requestId: 'p4-6',
  owner: { workspace_id: 'p4-ws', session_id: 'p4-sess' },
  code: `await browser.close(); return { ok: true };`,
});
const reopened = await manager.execute({
  requestId: 'p4-7',
  owner: { workspace_id: 'p4-ws', session_id: 'p4-sess' },
  code: `browser = await Browser.connect(); page = await browser.open("data:text/html,<p>again</p>"); obs = await page.snapshot(); return { ok: obs.text.includes('again') };`,
});
check('close() then reconnect gets a fresh session', reopened.error === undefined && JSON.parse(reopened.value || '{}').ok === true, JSON.stringify(reopened.error ?? reopened.value));

await manager.dispose();
ws.close();
ext.kill('SIGKILL');
disposeBridge();
http.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
