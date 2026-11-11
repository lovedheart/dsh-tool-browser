/**
 * Local CDP endpoint discovery for `backend: chrome`.
 * Ported from QwenPaw `browser/control_link/cdp/discovery.py`: probe
 * `http://127.0.0.1:<port>/json/version` across the conventional debugging
 * port range so the user does not have to configure `cdpUrl` by hand when
 * Chrome is already running with `--remote-debugging-port`.
 *
 * `/json/version` is the right probe (not `/json`): it answers only for a real
 * DevTools endpoint and carries `webSocketDebuggerUrl`, the browser-level
 * target Playwright's `connectOverCDP` attaches to.
 */
interface CdpVersion {
    Browser?: string;
    'webSocketDebuggerUrl'?: string;
}
/** Fetch /json/version from one port; null if unreachable or not CDP. */
export declare function fetchCdpVersion(port: number): Promise<CdpVersion | null>;
/**
 * Scan local debugging ports for a live CDP endpoint.
 * Returns the browser endpoint URL (e.g. `http://127.0.0.1:9222`) of the
 * lowest matching port, or null when no debuggable Chrome was found.
 */
export declare function discoverCdpUrl(portMin?: number, portMax?: number): Promise<string | null>;
export {};
