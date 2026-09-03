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
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
type EventHandler = (method: string, params: Record<string, unknown>) => void;
/** The process-wide bridge (Chrome allows one host per browser profile). */
declare class NMBridge {
    private wss;
    private socket;
    private ownsSocket;
    private pending;
    private nextId;
    private eventHandlers;
    private connectionListeners;
    private helloInfo;
    private attached;
    /** Last-known connection state for status/self-test rendering. */
    connected: boolean;
    lastCloseCode: number;
    lastCloseReason: string;
    onEvent(h: EventHandler): () => void;
    onConnectionChange(l: (connected: boolean) => void): () => void;
    get isConnected(): boolean;
    /** Answer the HTTP upgrade coming from the NM host. */
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
    private requestToken;
    private onSocket;
    private dispatch;
    /** Invoke an extension command; rejects to governed errors. */
    request(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
    status(): Record<string, unknown>;
    /** Tear down in-flight futures on disconnect. */
    private rejectAll;
    private fireConnection;
}
/** Process-wide singleton bridge (one Chrome profile ↔ one host). */
export declare const nmBridge: NMBridge;
export { NMBridge };
/** Exact upgrade pathname this plugin claims on the DSH webserver. */
export declare const BRIDGE_UPGRADE_PATH = "/api/plugins/tool-browser/ws";
/**
 * Mount the bridge onto a DSH webserver service (or any object exposing
 * `registerUpgrade` + `port`). Returns a disposer.
 */
export declare function mountBridge(webServer: {
    registerUpgrade: (route: {
        path: string;
        handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
    }) => () => void;
    port?: number;
}): () => void;
