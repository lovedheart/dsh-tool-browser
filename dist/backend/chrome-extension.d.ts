/**
 * Chrome-extension backend for the ControlLink port (P0 stub).
 *
 * Drives the user's REAL Chrome — without a --remote-debugging-port flag —
 * through the DSH browser extension (chrome.debugger) bridged by a Native
 * Messaging host. Port of QwenPaw's `control_link/chrome/` (bridge + adapter).
 *
 * P0 provides only the dispatch seam: connecting raises a governed FATAL error.
 * The NM bridge, WS upgrade, and CDP page translation land in P1-P4.
 */
import type { ControlLink } from './ports.ts';
export declare function createChromeExtensionControlLink(): ControlLink;
