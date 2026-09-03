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

import { BrowserError } from '../governance/errors.ts';
import type { BackendOptions, BackendSession, ControlLink } from './ports.ts';

export function createChromeExtensionControlLink(): ControlLink {
  return {
    async connect(_opts: BackendOptions): Promise<BackendSession> {
      throw new BrowserError({
        category: 'FATAL',
        cause: 'config_invalid',
        reason: 'backend=chrome-extension is not yet implemented',
        suggested_action:
          'Use backend "chrome" with cdpUrl (Chrome with --remote-debugging-port) ' +
          'or backend "playwright" until the extension backend lands.',
      });
    },
  };
}
