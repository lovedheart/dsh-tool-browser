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

const DEFAULT_PORT_MIN = 9222;
const DEFAULT_PORT_MAX = 9232;
/** Per-port probe budget; an unreachable port must not slow connect down. */
const PROBE_TIMEOUT_MS = 500;

interface CdpVersion {
  Browser?: string;
  'webSocketDebuggerUrl'?: string;
}

/** Fetch /json/version from one port; null if unreachable or not CDP. */
export async function fetchCdpVersion(port: number): Promise<CdpVersion | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CdpVersion;
    return typeof data?.webSocketDebuggerUrl === 'string' ? data : null;
  } catch {
    // Intentional boundary (QwenPaw parity): an unreachable port is absent.
    return null;
  }
}

/**
 * Scan local debugging ports for a live CDP endpoint.
 * Returns the browser endpoint URL (e.g. `http://127.0.0.1:9222`) of the
 * lowest matching port, or null when no debuggable Chrome was found.
 */
export async function discoverCdpUrl(
  portMin = DEFAULT_PORT_MIN,
  portMax = DEFAULT_PORT_MAX,
): Promise<string | null> {
  const ports: number[] = [];
  for (let p = portMin; p <= portMax; p++) ports.push(p);
  const results = await Promise.all(ports.map(fetchCdpVersion));
  for (let i = 0; i < results.length; i++) {
    if (results[i]) return `http://127.0.0.1:${ports[i]}`;
  }
  return null;
}
