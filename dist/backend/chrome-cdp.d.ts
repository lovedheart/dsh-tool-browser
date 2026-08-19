/**
 * Chrome-over-CDP backend for the ControlLink port.
 *
 * Drives the user's REAL, already-running Chrome (launched with
 * `--remote-debugging-port=<port>`) by attaching to its DevTools Protocol
 * endpoint via Playwright's `chromium.connectOverCDP`. Unlike the managed
 * Playwright backend, this does not launch or own a browser process — it only
 * attaches to one. That distinction drives two behaviours that differ from
 * `playwright.ts`:
 *
 *   1. `isHeadless()` is always `false` — the attached browser is the user's
 *      headed, on-screen Chrome.
 *   2. `close()` does NOT close the user's browser. For a `connectOverCDP`
 *      connection, `browser.close()` only tears down the CDP client connection;
 *      the user's Chrome keeps running with all its windows and tabs intact.
 *
 * The shared {@link PlaywrightPage} / {@link PlaywrightLocator} wrappers (the
 * page + locator port translation) are reused from `./page-wrappers.ts`; only
 * the session + factory here are CDP-specific.
 */
import type { ControlLink } from './ports.ts';
/**
 * Create a Chrome-over-CDP ControlLink.
 *
 * Attaches to the user's real, already-running Chrome via
 * `chromium.connectOverCDP({ endpointUrl: opts.cdpUrl })`. Requires
 * `opts.cdpUrl` (e.g. `http://127.0.0.1:9222`) — the user must have launched
 * Chrome with `--remote-debugging-port=<port>`.
 */
export declare function createChromeControlLink(): ControlLink;
