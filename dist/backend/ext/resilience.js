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
import { nmBridge } from "./bridge.js";
import { BrowserError } from "../../governance/errors.js";
const sessions = new Set();
const orphans = new Map();
let closeOrphanTabs = false;
let reconciling = Promise.resolve();
let wired = false;
export function configureResilience(opts) {
    if (opts.closeOrphanTabs !== undefined)
        closeOrphanTabs = opts.closeOrphanTabs;
}
export function registerSession(session) {
    sessions.add(session);
    wireBridgeEvents();
}
export function unregisterSession(session) {
    sessions.delete(session);
}
export function orphanedTabs() {
    return [...orphans.values()];
}
function wireBridgeEvents() {
    if (wired)
        return;
    wired = true;
    // Reconnect → full reconcile (serialized against each other).
    nmBridge.onConnectionChange((connected) => {
        if (connected)
            reconciling = reconciling.then(() => reconcile()).catch(() => undefined);
    });
    // Live tab-loss events → forget immediately (no waiting for a reconnect).
    nmBridge.onEvent((method, params) => {
        if (method !== 'tab.detached' && method !== 'tabs.removed' && method !== 'tabs.reconciled')
            return;
        const tabId = Number(params.tabId ?? params.tabIds?.[0]);
        if (!Number.isInteger(tabId))
            return;
        for (const s of sessions) {
            const pageId = s.pageIdsByTab.get(tabId);
            if (pageId !== undefined)
                s.forgetPage(pageId, tabId);
        }
        orphans.delete(tabId);
    });
}
/** Re-run enable on every still-alive page after a reconnect (best-effort). */
async function reconcile() {
    let tabs;
    try {
        const result = await nmBridge.request('tabs.list', {}, 15_000);
        tabs = (Array.isArray(result) ? result : result.tabs ?? []);
    }
    catch {
        return; // bridge died again mid-reconcile; next connection event retries
    }
    const live = new Map();
    for (const t of tabs)
        if (typeof t.tabId === 'number')
            live.set(t.tabId, t);
    // 1. Per-session page reconciliation.
    for (const session of [...sessions]) {
        for (const [pageId, tabId] of [...session.pages]) {
            const tab = live.get(tabId);
            if (!tab) {
                session.forgetPage(pageId, tabId);
                session.needsReopen = true;
            }
        }
        session.reenablePages();
    }
    // 2. Global ownership audit: DSH-created tabs without a live owner.
    orphans.clear();
    const liveOwnerIds = new Set([...sessions].map((s) => s.ownerId));
    for (const [tabId, tab] of live) {
        const created = tab.createdByDsh === true;
        if (!created)
            continue;
        const ownerId = String(tab.ownerId ?? '');
        if (ownerId && !liveOwnerIds.has(ownerId)) {
            orphans.set(tabId, {
                tabId,
                url: String(tab.url ?? ''),
                ownerId,
                workspaceId: String(tab.workspaceId ?? ''),
                at: Date.now(),
            });
            if (closeOrphanTabs) {
                await nmBridge.request('tab.close', { tabId }).catch(() => undefined);
                orphans.delete(tabId);
            }
        }
    }
}
/** Error surfaced when a model touches a session whose tabs were lost. */
export function needsReopenError() {
    return new BrowserError({
        category: 'RETRYABLE',
        cause: 'state_stale',
        reason: 'browser session was reset after a disconnect',
        detail: 'Previous pages were lost (Chrome restarted or the extension reloaded). Tabs that survived are still usable.',
        suggested_action: 'Re-open the page you need: page = await browser.open(url).',
    });
}
export function resetResilience() {
    sessions.clear();
    orphans.clear();
}
