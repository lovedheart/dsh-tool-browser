/**
 * P2 test: the NM host binary, offline.
 *   - --probe echoes one frame (installer self-test path)
 *   - full pump: spawn host against a local WS server with a token file,
 *     drive frames both ways, verify hello/hello_ack handshake, auth denial
 *     on bad token, and stdin-EOF exit.
 * Run: npx tsx test/e2e-ext-nmhost.ts
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { contractSnapshot, PROTOCOL_VERSION } from '../src/protocol.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const HOST_TS = join(here, '..', 'src', 'bin', 'nm-host.ts');
const PORT = 39411;

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}

function frame(payload: Buffer): Buffer {
  const f = Buffer.allocUnsafe(4 + payload.length);
  f.writeUInt32LE(payload.length, 0);
  payload.copy(f, 4);
  return f;
}
function parseFrames(buf: Buffer): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const n = buf.readUInt32LE(i);
    if (i + 4 + n > buf.length) break;
    frames.push(buf.subarray(i + 4, i + 4 + n));
    i += 4 + n;
  }
  return { frames, rest: buf.subarray(i) };
}

async function withHost(home: string, extra: string[] = []) {
  const child = spawn(process.execPath, ['--import', 'tsx', HOST_TS, ...extra], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out: Uint8Array = new Uint8Array(0);
  const got: Buffer[] = [];
  child.stdout.on('data', (d: Buffer) => {
    out = Buffer.concat([out, d]) as Buffer;
    const { frames, rest } = parseFrames(Buffer.from(out));
    got.push(...frames);
    out = rest;
  });
  const errBuf: string[] = [];
  child.stderr.on('data', (d: Buffer) => errBuf.push(d.toString()));
  const exited = new Promise<number | null>((res) => child.once('exit', (c) => res(c)));
  return {
    child,
    got,
    errBuf,
    exited,
    write: (b: Buffer) => child.stdin.write(b),
    endStdin: () => child.stdin.end(),
  };
}

// ---- probe mode ----
{
  const h = await withHost(mkdtempSync(join(tmpdir(), 'p2-probe-')), ['--probe']);
  h.write(frame(Buffer.from('{"hello":"probe"}')));
  const t0 = Date.now();
  while (h.got.length === 0 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
  check('probe echoes frame', h.got.length === 1 && h.got[0].toString() === '{"hello":"probe"}', h.got.map(String).join());
  h.endStdin();
  const code = await h.exited;
  check('probe exits 0 after stdin EOF', code === 0, String(code));
}

// ---- WS server harness ----
function startServer(opts: { expectToken: string }) {
  const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });
  const events: { type: string; msg?: any; code?: number }[] = [];
  wss.on('connection', (ws: WebSocket, req) => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? '';
    if (token !== opts.expectToken) {
      ws.close(4401, 'unauthorized');
      events.push({ type: 'denied' });
      return;
    }
    events.push({ type: 'open' });
    let acked = false;
    ws.on('message', (data: Buffer) => {
      const m = JSON.parse(data.toString());
      if (m.type === 'hello' && !acked) {
        acked = true;
        events.push({ type: 'hello', msg: m });
        ws.send(JSON.stringify({ type: 'hello_ack', status: 'ok' }));
        return;
      }
      events.push({ type: 'msg', msg: m });
      // echo back with a marker for the roundtrip check
      ws.send(JSON.stringify({ ...m, echo: true }));
    });
    ws.on('close', (code) => events.push({ type: 'close', code }));
    ws.on('ping', () => ws.pong());
  });
  return { wss, events };
}

// ---- full pump + handshake ----
{
  const home = mkdtempSync(join(tmpdir(), 'p2-pump-'));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'nm-bridge.json'), JSON.stringify({ ws_url: `ws://127.0.0.1:${PORT}/ws`, token: 'tok-abc' }), { mode: 0o600 });
  const { wss, events } = startServer({ expectToken: 'tok-abc' });
  await new Promise((r) => wss.once('listening', r));

  const h = await withHost(home);
  // wait hello
  const t0 = Date.now();
  while (!events.some((e) => e.type === 'hello') && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
  const helloEv = events.find((e) => e.type === 'hello');
  check('handshake: hello sent after connect', !!helloEv, JSON.stringify(helloEv?.msg));
  check(
    'hello carries v2 contract',
    helloEv?.msg?.protocolVersion === PROTOCOL_VERSION && helloEv?.msg?.contract?.nmMaxOutboundBytes === 1048576 && helloEv?.msg?.contract?.minCompatibleProtocolVersion === 2,
    JSON.stringify(helloEv?.msg?.contract),
  );
  check('hello carries entryId', helloEv?.msg?.entryId === 'dsh-tool-browser');

  // JSON-RPC roundtrip extension->host->core->host->extension
  h.write(frame(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'cdp.send', params: { tabId: 7, method: 'Page.navigate' } }))));
  const t1 = Date.now();
  while (h.got.length === 0 && Date.now() - t1 < 4000) await new Promise((r) => setTimeout(r, 20));
  const echoed = h.got.length ? JSON.parse(h.got[0].toString()) : null;
  check('roundtrip: frame echoed back', echoed?.echo === true && echoed?.id === 1 && echoed?.method === 'cdp.send', JSON.stringify(echoed));

  // large-ish frame (512KB, under Chrome's 1MB wall) survives
  const big = Buffer.alloc(512 * 1024, 'x');
  h.write(frame(Buffer.concat([Buffer.from('{"big":"'), big, Buffer.from('","id":2}')])));
  const t2 = Date.now();
  while (h.got.length < 2 && Date.now() - t2 < 8000) await new Promise((r) => setTimeout(r, 25));
  check('512KB frame roundtrips', h.got.length >= 2 && h.got[1].toString().includes('"echo":true'), String(h.got.length));

  // stdin EOF → host exits with 0 (Chrome closed pipe semantics)
  h.endStdin();
  const code = await Promise.race([h.exited, new Promise((r) => setTimeout(() => r('timeout'), 4000))]);
  check('exits on stdin EOF', code === 0, String(code));
  wss.close();
}

// ---- bad token: permanent rejection, no infinite retry ----
{
  const home = mkdtempSync(join(tmpdir(), 'p2-badtok-'));
  writeFileSync(join(home, 'nm-bridge.json'), JSON.stringify({ ws_url: `ws://127.0.0.1:${PORT}/ws`, token: 'WRONG' }));
  const { wss, events } = startServer({ expectToken: 'tok-abc' });
  await new Promise((r) => wss.once('listening', r));
  const h = await withHost(home);
  const t0 = Date.now();
  while (!events.some((e) => e.type === 'denied') && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 20));
  check('bad token reaches server denial path', events.some((e) => e.type === 'denied'));
  // close≠1000 with no hello_ack: host retries within budget; after 120s budget it exits 1.
  // We only verify it does NOT exit 0 quickly (it treats it as transient, keeps budget).
  await new Promise((r) => setTimeout(r, 500));
  check('still retrying (no premature exit)', h.child.exitCode === null);
  h.child.kill('SIGKILL');
  wss.close();
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
