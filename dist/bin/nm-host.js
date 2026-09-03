/**
 * Native Messaging host — a dumb pipe between the DSH Browser Chrome extension
 * and this DSH instance. Ported from QwenPaw's `assets/scripts/nm_host.py`.
 *
 * Chrome starts this process via the NM launcher whenever the extension calls
 * `chrome.runtime.connectNative()`. It then:
 *   1. reads `$DSH_HOME/nm-bridge.json` (ws_url + bearer token),
 *   2. opens the bridge WebSocket (Bearer auth) and runs the hello/hello_ack
 *      handshake (protocol v2),
 *   3. pumps frames both ways: stdio length-prefixed NM frames <-> WS JSON
 *      messages, until either side ends.
 *
 * Stdin is pumped as a STREAM (never a blocking sync loop): a sync read would
 * starve the event loop and deadlock the ws→extension direction. When the WS
 * is down, stdin is paused so extension frames queue in the OS pipe instead.
 *
 * Liveness: a 20s WS ping keepalive terminates half-open peers — without it a
 * zombie host would keep the extension believing the bridge is connected
 * (mirrors the Python host's reliance on websockets' default ping/pong).
 * Reconnect across a (short) core restart: exponential 0.5s..5s within a 120s
 * budget. Permanent hello rejections exit immediately.
 *
 * Flags: --probe echoes one frame (installer self-test); --check-runtime
 * verifies the environment can run this host.
 */
import { readFileSync, writeSync, readSync, read } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { contractSnapshot, PROTOCOL_VERSION, NM_MAX_INBOUND_BYTES, NM_MAX_OUTBOUND_BYTES, NM_CLOSE_STDIN_EOF, NM_CLOSE_FRAME_PROTOCOL, NM_CLOSE_INBOUND_TOO_LARGE, ENTRY_ID, } from "../protocol.js";
const args = process.argv.slice(2);
const PROBE = args.includes('--probe');
const CHECK_RUNTIME = args.includes('--check-runtime');
function dshHome() {
    return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}
class HandshakePermanentError extends Error {
}
function log(msg) {
    process.stderr.write(`[dsh-nm-host] ${new Date().toISOString()} ${msg}\n`);
}
// -- NM frame IO ---------------------------------------------------------------
// fd 1 is a non-blocking pipe under a libuv spawn (blocking under real
// Chrome). Wrapping it as a writable net.Socket gives correct libuv stream
// semantics: internal queueing + drain backpressure, no EAGAIN surprises.
import { Socket } from 'node:net';
const stdoutSock = new Socket({ readable: false, fd: 1 });
stdoutSock.on('error', (e) => log(`stdout error: ${e.message}`));
function writeNmFrame(payload) {
    if (payload.length > NM_MAX_OUTBOUND_BYTES) {
        return Promise.reject(new Error(`core message is ${payload.length} bytes, above Chrome's ${NM_MAX_OUTBOUND_BYTES}-byte host-to-extension limit`));
    }
    const frame = Buffer.allocUnsafe(4 + payload.length);
    frame.writeUInt32LE(payload.length, 0);
    payload.copy(frame, 4);
    return new Promise((resolve, reject) => {
        stdoutSock.write(frame, (err) => (err ? reject(err) : resolve()));
    });
}
/** Sync single-frame read for --probe (no WS involved). */
function readOneFrameSync() {
    const head = Buffer.alloc(4);
    let off = 0;
    while (off < 4) {
        const got = readSync(0, head, off, 4 - off, null);
        if (got === 0)
            return off === 0 ? null : (() => { throw new Error('Incomplete NM length prefix'); })();
        off += got;
    }
    const size = head.readUInt32LE(0);
    if (size > NM_MAX_INBOUND_BYTES)
        throw new Error(`inbound frame ${size} exceeds limit`);
    const payload = Buffer.alloc(size);
    off = 0;
    while (off < size) {
        const got = readSync(0, payload, off, size - off, null);
        if (got === 0)
            throw new Error('Incomplete NM payload');
        off += got;
    }
    return payload;
}
// -- config --------------------------------------------------------------------
function loadConfig() {
    const cfgPath = join(dshHome(), 'nm-bridge.json');
    const raw = JSON.parse(readFileSync(cfgPath, 'utf8'));
    const wsUrl = String(raw.ws_url ?? '').trim();
    const token = String(raw.token ?? '').trim();
    if (!wsUrl)
        throw new Error('NM bridge ws_url is required');
    if (!token)
        throw new Error('NM bridge token is required');
    return { wsUrl, token };
}
// -- handshake -------------------------------------------------------------------
function sendHello(ws) {
    ws.send(JSON.stringify({
        type: 'hello',
        entryId: ENTRY_ID,
        protocolVersion: PROTOCOL_VERSION,
        contract: contractSnapshot(),
    }));
}
function waitHelloAck(ws, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.off('message', onMsg);
            reject(new Error('Hello ack timeout')); // transient
        }, timeoutMs);
        const onMsg = (data) => {
            let msg;
            try {
                msg = JSON.parse(data.toString('utf8'));
            }
            catch {
                return;
            }
            if (msg.type === 'hello_ack' && msg.status === 'ok') {
                clearTimeout(timer);
                ws.off('message', onMsg);
                resolve();
            }
            else if (msg.type === 'hello_ack') {
                clearTimeout(timer);
                ws.off('message', onMsg);
                reject(new HandshakePermanentError(`Hello rejected: ${JSON.stringify(msg)}`));
            }
        };
        ws.on('message', onMsg);
    });
}
// -- pumps ------------------------------------------------------------------------
const wsHolder = { ws: null };
let sawStdinEof = false;
/**
 * Streaming stdin → WS pump: sequential async reads on fd 0 give natural
 * backpressure (frames queue in the OS pipe while the WS await is pending).
 */
async function pumpStdin(wsHolder) {
    const fd = 0;
    let buf = Buffer.alloc(0);
    const tmp = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
        const got = await new Promise((resolve, reject) => read(fd, tmp, 0, tmp.length, null, (err, n) => (err ? reject(err) : resolve(n))));
        if (got === 0)
            break; // EOF: Chrome closed the pipe
        buf = Buffer.concat([buf, tmp.subarray(0, got)]);
        for (;;) {
            if (buf.length < 4)
                break;
            const size = buf.readUInt32LE(0);
            if (size > NM_MAX_INBOUND_BYTES) {
                log(`inbound frame ${size} exceeds ${NM_MAX_INBOUND_BYTES}, exiting`);
                wsHolder.ws?.close(NM_CLOSE_INBOUND_TOO_LARGE, 'inbound_frame_too_large');
                sawStdinEof = true;
                return;
            }
            if (buf.length < 4 + size)
                break;
            const payload = buf.subarray(4, 4 + size);
            buf = buf.subarray(4 + size);
            const ws = wsHolder.ws;
            if (ws && ws.readyState === WebSocket.OPEN) {
                await new Promise((resolve, reject) => ws.send(payload, (err) => (err ? reject(err) : resolve()))).catch((e) => log(`ws send failed: ${e.message}`));
            }
            // WS down: the frame is dropped (QwenPaw parity — the host is a dumb
            // pipe; the bridge layer above enforces liveness and retries).
        }
    }
    sawStdinEof = true;
    log('stdin EOF');
    wsHolder.ws?.close(NM_CLOSE_STDIN_EOF, 'stdin_eof');
}
function pumpWsToStdin(ws) {
    // Sequentialize writes so frames land in order under backpressure.
    let chain = Promise.resolve();
    ws.on('message', (data) => {
        chain = chain
            .then(() => writeNmFrame(Buffer.isBuffer(data) ? data : Buffer.from(String(data))))
            .catch((e) => {
            log(`outbound write failed: ${e.message}`);
            try {
                ws.close(NM_CLOSE_FRAME_PROTOCOL, 'frame_protocol_error');
            }
            catch { /* noop */ }
        });
    });
}
// -- connection with retry ----------------------------------------------------------
const RETRY_BUDGET_MS = 120_000;
const INITIAL_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;
function connectOnce(cfg) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(cfg.wsUrl, {
            headers: { Authorization: `Bearer ${cfg.token}` },
            maxPayload: NM_MAX_OUTBOUND_BYTES,
        });
        const fail = (e) => {
            ws.removeAllListeners();
            reject(e instanceof Error ? e : new Error(String(e)));
        };
        ws.once('open', async () => {
            ws.off('error', fail);
            try {
                sendHello(ws);
                await waitHelloAck(ws);
                // Keepalive: terminate half-open peers (anti-zombie).
                const interval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN)
                        ws.ping();
                    else
                        clearInterval(interval);
                }, 20_000);
                interval.unref?.();
                resolve(ws);
            }
            catch (e) {
                try {
                    ws.close();
                }
                catch { /* noop */ }
                reject(e);
            }
        });
        ws.once('error', fail);
        ws.once('close', () => fail(new Error('connection closed before handshake')));
    });
}
async function connectWithRetry(cfg) {
    const deadline = Date.now() + RETRY_BUDGET_MS;
    let delay = INITIAL_DELAY_MS;
    for (;;) {
        try {
            return await connectOnce(cfg);
        }
        catch (e) {
            if (e instanceof HandshakePermanentError)
                throw e;
            const remaining = deadline - Date.now();
            if (remaining <= 0)
                throw e;
            const wait = Math.min(delay, remaining);
            log(`connect failed (${e.message}), retrying in ${Math.round(wait)}ms`);
            await new Promise((r) => setTimeout(r, wait));
            delay = Math.min(delay * 2, MAX_DELAY_MS);
        }
    }
}
// -- main ---------------------------------------------------------------------------
async function main() {
    if (CHECK_RUNTIME) {
        return typeof WebSocket === 'function' ? 0 : 1;
    }
    if (PROBE) {
        const frame = readOneFrameSync();
        if (frame) {
            // probe exits immediately — use a blocking sync write (frame is tiny)
            const out = Buffer.allocUnsafe(4 + frame.length);
            out.writeUInt32LE(frame.length, 0);
            frame.copy(out, 4);
            let off = 0;
            while (off < out.length)
                off += writeSync(1, out, off, out.length - off);
        }
        return 0;
    }
    const cfg = loadConfig();
    void pumpStdin(wsHolder);
    for (;;) {
        let ws;
        try {
            ws = await connectWithRetry(cfg);
        }
        catch (e) {
            log(`bridge connect failed permanently: ${e.message}`);
            return sawStdinEof ? 0 : 1;
        }
        if (sawStdinEof) {
            // Chrome hung up while we were reconnecting — exit cleanly.
            try {
                ws.close();
            }
            catch { /* noop */ }
            return 0;
        }
        log('bridge connected');
        wsHolder.ws = ws;
        pumpWsToStdin(ws);
        const closed = await new Promise((resolve) => {
            ws.on('close', (code) => resolve(code || -1));
            ws.on('error', (err) => log(`ws error: ${err.message}`));
        });
        wsHolder.ws = null;
        log(`bridge closed (code ${closed})`);
        if (sawStdinEof)
            return 0;
        await new Promise((r) => setTimeout(r, INITIAL_DELAY_MS));
    }
}
main()
    .then((code) => process.exit(code))
    .catch((e) => {
    log(`fatal: ${e.stack ?? String(e)}`);
    process.exit(1);
});
