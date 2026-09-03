/**
 * NMBridge — the host-side WebSocket endpoint the Native Messaging host
 * connects to, plus the JSON-RPC client facade the chrome-extension backend
 * uses to command the Chrome extension. Ported from QwenPaw's
 * `control_link/chrome/bridge.py` + `ws_handler.py` (single-connection flavor).
 *
 * Responsibilities:
 *   - serve `ws://<loopback>/api/plugins/tool-browser/ws` as an HTTP upgrade
 *     on the DSH webserver (bearer-token auth, file is the authority);
 *   - hello/hello_ack handshake with the contract comparison;
 *   - single-connection replace semantics (a new hello retires the old socket);
 *   - pending-future request/response + event fan-out for the backend.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, MIN_COMPATIBLE_PROTOCOL_VERSION, NM_MAX_OUTBOUND_BYTES, contractSnapshot, NM_CLOSE_INTERNAL_ERROR, } from "../../protocol.js";
import { BrowserError } from "../../governance/errors.js";
import { readBridgeToken } from "./setup.js";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** The process-wide bridge (Chrome allows one host per browser profile). */
class NMBridge {
    wss = new WebSocketServer({ noServer: true });
    socket = null;
    ownsSocket = false; // guard: only our active socket may mutate state
    pending = new Map();
    nextId = 1;
    eventHandlers = new Set();
    connectionListeners = new Set();
    helloInfo = {};
    attached = false;
    /** Last-known connection state for status/self-test rendering. */
    connected = false;
    lastCloseCode = 0;
    lastCloseReason = '';
    onEvent(h) {
        this.eventHandlers.add(h);
        return () => this.eventHandlers.delete(h);
    }
    onConnectionChange(l) {
        this.connectionListeners.add(l);
        return () => this.connectionListeners.delete(l);
    }
    get isConnected() {
        return this.connected && this.socket?.readyState === WebSocket.OPEN;
    }
    /** Answer the HTTP upgrade coming from the NM host. */
    handleUpgrade(req, socket, head) {
        const token = this.requestToken(req);
        const expected = readBridgeToken();
        if (!expected || !token || !timingSafeEqualStr(token, expected)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws));
    }
    requestToken(req) {
        const auth = req.headers.authorization;
        if (typeof auth === 'string' && auth.startsWith('Bearer '))
            return auth.slice(7).trim();
        try {
            const url = new URL(req.url ?? '', 'http://x');
            return (url.searchParams.get('token') ?? '').trim();
        }
        catch {
            return '';
        }
    }
    onSocket(ws) {
        // Single-connection replace: retire the incumbent (QwenPaw parity).
        const mine = { value: true };
        if (this.socket) {
            this.ownsSocket = false;
            try {
                this.socket.close(4000, 'replaced by a newer connection');
            }
            catch { /* noop */ }
        }
        this.socket = ws;
        this.ownsSocket = true;
        const owns = () => this.socket === ws && this.ownsSocket;
        let helloDone = false;
        ws.on('message', (data) => {
            if (!owns())
                return;
            let msg;
            try {
                msg = JSON.parse(data.toString('utf8'));
            }
            catch {
                return;
            }
            if (msg.type === 'hello' && !helloDone) {
                helloDone = true;
                const pv = Number(msg.protocolVersion ?? 0);
                if (pv < MIN_COMPATIBLE_PROTOCOL_VERSION) {
                    ws.send(JSON.stringify({
                        type: 'hello_ack',
                        status: 'rejected',
                        code: 'BROWSER_PROTOCOL_VERSION_MISMATCH',
                        expected_protocol_version: PROTOCOL_VERSION,
                        expected_min_protocol_version: MIN_COMPATIBLE_PROTOCOL_VERSION,
                        actual_protocol_version: pv,
                    }));
                    setTimeout(() => ws.close(NM_CLOSE_INTERNAL_ERROR, 'protocol mismatch'), 50);
                    return;
                }
                this.helloInfo = {
                    entryId: msg.entryId,
                    protocolVersion: pv,
                    contract: msg.contract,
                };
                const mismatches = contractMismatches(msg.contract);
                ws.send(JSON.stringify({ type: 'hello_ack', status: 'ok', contractMismatches: mismatches }));
                this.connected = true;
                this.fireConnection(true);
                return;
            }
            // No hello → no ack; keep the QwenPaw behavior of rejecting pre-hello
            // traffic softly (ignore), then handle RPC frames.
            if (!helloDone)
                return;
            this.dispatch(msg);
        });
        ws.on('close', (code, reason) => {
            if (!owns())
                return;
            this.connected = false;
            this.lastCloseCode = code;
            this.lastCloseReason = reason.toString('utf8');
            this.rejectAll(new BrowserError({
                category: 'RETRYABLE',
                cause: 'bridge_disconnected',
                reason: `NM bridge disconnected (code ${code})`,
                detail: this.lastCloseReason,
                suggested_action: 'The Chrome extension/native host dropped. Ensure Chrome is running and the DSH Browser extension is enabled, then retry.',
            }));
            this.fireConnection(false);
            this.socket = null;
        });
        ws.on('error', () => {
            /* close handler follows */
        });
    }
    dispatch(msg) {
        const id = msg.id;
        if (typeof id === 'number' && this.pending.has(id)) {
            const p = this.pending.get(id);
            this.pending.delete(id);
            clearTimeout(p.timer);
            if (msg.error) {
                const err = msg.error;
                p.reject(new BrowserError({
                    category: wireErrorCategory(err),
                    cause: wireErrorCause(err),
                    reason: String(err.message ?? 'extension error'),
                    detail: err.data ? JSON.stringify(err.data) : undefined,
                }));
            }
            else {
                p.resolve(msg.result);
            }
            return;
        }
        if (typeof msg.method === 'string' && typeof id === 'string' && id.startsWith('evt-')) {
            for (const h of [...this.eventHandlers])
                h(msg.method, (msg.params ?? {}));
        }
    }
    /** Invoke an extension command; rejects to governed errors. */
    request(method, params, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            const ws = this.socket;
            if (!this.isConnected || !ws) {
                reject(new BrowserError({
                    category: 'RETRYABLE',
                    cause: 'bridge_disconnected',
                    reason: 'the DSH Browser extension is not connected',
                    suggested_action: 'Open Chrome (the browser with the DSH Browser extension installed); the extension reconnects automatically. If the popup shows "never connected", run the setup command.',
                }));
                return;
            }
            let payload;
            try {
                payload = JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params });
            }
            catch (e) {
                reject(new BrowserError({ category: 'FATAL', cause: 'internal', reason: `cannot serialize ${method}: ${e.message}` }));
                return;
            }
            if (Buffer.byteLength(payload) > NM_MAX_OUTBOUND_BYTES) {
                reject(new BrowserError({
                    category: 'FATAL',
                    cause: 'internal',
                    reason: `command exceeds Chrome's ${NM_MAX_OUTBOUND_BYTES}-byte host-to-extension limit`,
                }));
                return;
            }
            const id = JSON.parse(payload).id;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new BrowserError({
                    category: 'RETRYABLE',
                    cause: 'timeout',
                    reason: `extension did not answer ${method} within ${timeoutMs} ms`,
                    suggested_action: 'Chrome may be busy or the extension was reloaded; retry the call.',
                }));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            ws.send(payload, (err) => {
                if (!err)
                    return;
                const p = this.pending.get(id);
                if (!p)
                    return;
                this.pending.delete(id);
                clearTimeout(p.timer);
                p.reject(new BrowserError({ category: 'RETRYABLE', cause: 'bridge_disconnected', reason: `send failed: ${err.message}` }));
            });
        });
    }
    status() {
        return {
            connected: this.isConnected,
            hello: this.helloInfo,
            lastClose: this.lastCloseCode ? { code: this.lastCloseCode, reason: this.lastCloseReason } : null,
            contract: contractSnapshot(),
        };
    }
    /** Tear down in-flight futures on disconnect. */
    rejectAll(e) {
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(e);
        }
        this.pending.clear();
    }
    fireConnection(v) {
        for (const l of [...this.connectionListeners]) {
            try {
                l(v);
            }
            catch { /* listener errors must not break the bridge */ }
        }
    }
}
function contractMismatches(contract) {
    const mine = contractSnapshot();
    const theirs = (contract ?? {});
    const out = [];
    for (const [k, v] of Object.entries(mine)) {
        if (theirs[k] !== undefined && theirs[k] !== v)
            out.push(`${k}: host=${String(theirs[k])} core=${String(v)}`);
    }
    return out;
}
function wireErrorCategory(err) {
    const m = String(err.message ?? '');
    // Extension-side tab staleness maps to retry (re-attach next call).
    if (/no tab with id|tab (?:was )?closed|debugger attach/i.test(m))
        return 'RETRYABLE';
    return 'FATAL';
}
function wireErrorCause(err) {
    const m = String(err.message ?? '');
    if (/no tab with id|tab (?:was )?closed/.test(m))
        return 'bridge_disconnected';
    return 'internal';
}
function timingSafeEqualStr(a, b) {
    // Hash both sides first so unequal lengths don't throw timingSafeEqual.
    const ha = createHash('sha256').update(a).digest();
    const hb = createHash('sha256').update(b).digest();
    return timingSafeEqual(ha, hb);
}
/** Process-wide singleton bridge (one Chrome profile ↔ one host). */
export const nmBridge = new NMBridge();
export { NMBridge };
/** Exact upgrade pathname this plugin claims on the DSH webserver. */
export const BRIDGE_UPGRADE_PATH = '/api/plugins/tool-browser/ws';
/**
 * Mount the bridge onto a DSH webserver service (or any object exposing
 * `registerUpgrade` + `port`). Returns a disposer.
 */
export function mountBridge(webServer) {
    return webServer.registerUpgrade({
        path: BRIDGE_UPGRADE_PATH,
        handler: (req, socket, head) => nmBridge.handleUpgrade(req, socket, head),
    });
}
