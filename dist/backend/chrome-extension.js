/**
 * Chrome-extension backend for the ControlLink port.
 *
 * Drives the user's REAL Chrome — with no --remote-debugging-port flag — via
 * the DSH Browser extension's chrome.debugger channel, bridged through the
 * Native Messaging host and the NMBridge (see ./ext/bridge.ts). Port of
 * QwenPaw's `control_link/chrome/adapter.py` (session/page↔tab mapping) with
 * the CDP verbs executed page-side through injected JS (./ext/cdp-inject.ts).
 *
 * Key behaviours (mirroring the adapter):
 *   - isHeadless() is always false: this is the user's on-screen Chrome;
 *   - close() closes only the tabs THIS session created (tab.create marked
 *     them via createdByDsh); the user's own tabs are never touched;
 *   - every CDP call attaches lazily (tab.attach) and maps stale-tab wire
 *     errors to governed RETRYABLE/state_stale so the model re-opens a page.
 */
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { BrowserError } from "../governance/errors.js";
import { nmBridge } from "./ext/bridge.js";
import { registerSession, unregisterSession, needsReopenError } from "./ext/resilience.js";
import { ExtPage } from "./ext/cdp-page.js";
class ExtSession {
    owner;
    opts;
    /** pageId -> Chrome tabId */
    pages = new Map();
    pageIdsByTab = new Map();
    activePageId = null;
    needsReopen = false;
    constructor(owner, opts) {
        this.owner = owner;
        this.opts = opts;
        registerSession(this);
    }
    get ownerId() {
        return this.owner.ownerId;
    }
    get workspaceId() {
        return this.owner.workspaceId;
    }
    /** Best-effort CDP re-enable for tabs that survived a bridge blip. */
    reenablePages() {
        for (const pageId of this.pages.keys()) {
            const page = new ExtPage(this, pageId);
            void page.cdp('Page.enable').catch(() => undefined);
            void page.cdp('Runtime.enable').catch(() => undefined);
        }
    }
    async cdp(pageId, method, params = {}) {
        const tabId = this.pages.get(pageId);
        if (tabId === undefined) {
            if (this.needsReopen)
                throw needsReopenError();
            throw new BrowserError({
                category: 'RETRYABLE',
                cause: 'state_stale',
                reason: 'page has been closed',
                suggested_action: 'Open a new page if you need to continue',
                detail: `unknown pageId ${pageId}`,
            });
        }
        try {
            await nmBridge.request('tab.attach', { tabId });
            return (await nmBridge.request('cdp.send', { tabId, method, params }));
        }
        catch (e) {
            if (e instanceof BrowserError && /no tab with id|tab (?:was )?closed|Cannot attach/i.test(e.reason)) {
                this.forgetPage(pageId, tabId);
                throw new BrowserError({
                    category: 'RETRYABLE',
                    cause: 'state_stale',
                    reason: 'page has been closed',
                    suggested_action: 'Open a new page if you need to continue',
                    detail: e.reason,
                });
            }
            throw e;
        }
    }
    forgetPage(pageId, tabId) {
        this.pages.delete(pageId);
        this.pageIdsByTab.delete(tabId);
        if (this.activePageId === pageId)
            this.activePageId = null;
    }
    async newPage(url) {
        const created = (await nmBridge.request('tab.create', {
            url: url ?? 'about:blank',
            ownerId: this.owner.ownerId,
            workspaceId: this.owner.workspaceId,
            protocolVersion: 2,
            active: false,
        }));
        const pageId = randomBytes(4).toString('hex');
        const tabId = Number(created.tabId);
        this.pages.set(pageId, tabId);
        this.pageIdsByTab.set(tabId, pageId);
        this.activePageId = pageId;
        this.needsReopen = false;
        const page = new ExtPage(this, pageId);
        try {
            await page.cdp('Page.enable');
            await page.cdp('Runtime.enable');
        }
        catch (e) {
            await this.closePage(pageId).catch(() => undefined);
            throw e;
        }
        if (url)
            await page.goto(url);
        return page;
    }
    /** Reuse the active page when one exists (parity with PlaywrightSession.openPage). */
    async openPage(url) {
        if (this.activePageId && this.pages.has(this.activePageId)) {
            const page = new ExtPage(this, this.activePageId);
            if (url)
                await page.goto(url);
            return page;
        }
        return this.newPage(url);
    }
    async presentPage(url) {
        return this.newPage(url);
    }
    async listPages() {
        const refs = [];
        for (const [pageId, tabId] of this.pages) {
            let url = '';
            let title = '';
            try {
                url = await this.evaluateJson(pageId, 'location.href');
                const t = await this.evaluateJson(pageId, '({title: document.title})');
                title = t.title;
            }
            catch {
                /* page may be mid-navigation; report what we know */
            }
            refs.push({ id: pageId, url, title, active: pageId === this.activePageId });
        }
        return refs;
    }
    async evaluateJson(pageId, expression, awaitPromise = false) {
        const res = await this.cdp(pageId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
        if (res.exceptionDetails) {
            throw new BrowserError({
                category: 'RETRYABLE',
                cause: 'internal',
                reason: `page-side evaluation failed: ${JSON.stringify(res.exceptionDetails).slice(0, 300)}`,
            });
        }
        return res.result?.value;
    }
    switchPage(pageId) {
        if (!this.pages.has(pageId)) {
            throw new BrowserError({ category: 'RETRYABLE', cause: 'state_stale', reason: `unknown page ${pageId}` });
        }
        this.activePageId = pageId;
    }
    async closePage(pageId) {
        const tabId = this.pages.get(pageId);
        if (tabId === undefined)
            return;
        this.forgetPage(pageId, tabId);
        await nmBridge.request('tab.close', { tabId }).catch(() => undefined);
    }
    /** Close only OUR tabs; never the user's browser (QwenPaw parity). */
    async close() {
        unregisterSession(this);
        for (const [pageId, tabId] of [...this.pages]) {
            await this.closePage(pageId).catch(() => undefined);
            void tabId;
        }
        this.pages.clear();
        this.pageIdsByTab.clear();
    }
    isHeadless() {
        return false; // the attached browser is the user's on-screen Chrome
    }
    async screenshotTo(pageId, file) {
        const shot = await this.cdp(pageId, 'Page.captureScreenshot', { format: 'png' });
        if (!shot?.data) {
            throw new BrowserError({ category: 'RETRYABLE', cause: 'internal', reason: 'screenshot returned no data' });
        }
        const { writeFileSync, mkdirSync } = await import('node:fs');
        const { dirname } = await import('node:path');
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, Buffer.from(shot.data, 'base64'));
        return { path: file };
    }
    get workspaceDir() {
        return this.opts.workspaceDir;
    }
    path(...parts) {
        return path.join(this.workspaceDir, ...parts);
    }
}
export function createChromeExtensionControlLink(owner) {
    return {
        async connect(opts) {
            if (!nmBridge.isConnected) {
                throw new BrowserError({
                    category: 'RETRYABLE',
                    cause: 'bridge_disconnected',
                    reason: 'the DSH Browser extension is not connected',
                    suggested_action: 'Ensure Chrome is running with the DSH Browser extension enabled. If the popup says "never connected", ask the user to run the browser setup once.',
                });
            }
            const session = new ExtSession({ ownerId: owner?.ownerId ?? 'default', workspaceId: owner?.workspaceId ?? 'default' }, opts);
            return adaptSession(session);
        },
        async selfTest() {
            return nmBridge.status();
        },
    };
}
/** Map the ExtSession's rich surface onto the BackendSession port shape. */
function adaptSession(session) {
    return {
        variant: 'chrome-extension',
        openPage: (url) => session.openPage(url),
        presentPage: (url) => session.presentPage(url),
        pages: () => session.listPages(),
        switchPage: async (pageId) => session.switchPage(pageId),
        closePage: (pageId) => session.closePage(pageId),
        isHeadless: () => session.isHeadless(),
        close: () => session.close(),
    };
}
export { ExtSession, ExtPage };
