/**
 * Reconnect resilience for the chrome-extension backend. Port of the
 * reconcile/ownership half of QwenPaw's `control_link/chrome/adapter.py`.
 *
 * The extension side already carries its own half (30s watchdog alarm, 60s
 * self-demotion, chrome.storage.session restore); the nm host carries the
 * 120s reconnect-backoff budget. This module is the CORE side:
 *
 *   - on every (re)connection it reconciles each live session's page→tab map
 *     against `tabs.list`: tabs still alive are kept (state survives a bridge
 *     blip), tabs that vanished forget their pages and mark the session
 *     "needs reopen" (governed REROUTE-style error on next use);
 *   - tabs created by DSH whose owner is NOT a live session are flagged
 *     orphans. By default they are ONLY flagged — auto-closing user-visible
 *     tabs on a reconnect guess is the highest-severity footgun, so closing
 *     is an explicit opt-in (config `closeOrphanTabs`).
 */
import { BrowserError } from '../../governance/errors.ts';
export interface ExtSessionLike {
    readonly ownerId: string;
    readonly workspaceId: string;
    /** pageId -> tabId (mutable map the session owns). */
    readonly pages: Map<string, number>;
    readonly pageIdsByTab: Map<number, string>;
    forgetPage(pageId: string, tabId: number): void;
    /** Flag set by reconcile: prior pages are gone, model should re-open. */
    needsReopen: boolean;
    /** Fire-and-forget enable calls to re-arm page/runtime domains. */
    reenablePages(): void;
}
interface OrphanRecord {
    tabId: number;
    url: string;
    ownerId: string;
    workspaceId: string;
    at: number;
}
export declare function configureResilience(opts: {
    closeOrphanTabs?: boolean;
}): void;
export declare function registerSession(session: ExtSessionLike): void;
export declare function unregisterSession(session: ExtSessionLike): void;
export declare function orphanedTabs(): OrphanRecord[];
/** Error surfaced when a model touches a session whose tabs were lost. */
export declare function needsReopenError(): BrowserError;
export declare function resetResilience(): void;
export {};
