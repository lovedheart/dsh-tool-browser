/**
 * Playwright backend for the ControlLink port.
 *
 * Manages a Chromium browser instance via the `playwright` npm package and
 * exposes it through the {@link BackendSession} / {@link BackendPage} /
 * {@link BackendLocator} interfaces defined in `ports.ts`.
 *
 * The shared {@link PlaywrightPage} and {@link PlaywrightLocator} wrappers that
 * translate Playwright's `Page` / `Locator` into the port types live in
 * `./page-wrappers.ts` and are shared with the CDP backend (`chrome-cdp.ts`).
 * This file keeps only the Playwright-specific session + factory.
 */
import { chromium } from 'playwright';
import { PlaywrightPage } from "./page-wrappers.js";
// ---------------------------------------------------------------------------
// BackendSession
// ---------------------------------------------------------------------------
class PlaywrightSession {
    variant = 'playwright';
    pageMap = new Map();
    nextPageNum = 1;
    context;
    browser;
    opts;
    constructor(browser, context, opts) {
        this.browser = browser;
        this.context = context;
        this.opts = opts;
    }
    /** Get or create the active page; optionally navigate to url. */
    async openPage(url) {
        // Reuse active page if one exists
        let record;
        for (const rec of this.pageMap.values()) {
            if (rec.active) {
                record = rec;
                break;
            }
        }
        if (!record) {
            const page = await this.context.newPage();
            const id = `page-${this.nextPageNum++}`;
            record = { page, active: true };
            this.pageMap.set(id, record);
        }
        else {
            record.active = true;
        }
        if (url) {
            await record.page.goto(url);
        }
        return new PlaywrightPage(record.page, this.activeId(), this.opts.workspaceDir);
    }
    /** Always create a new retained page; optionally navigate to url. */
    async presentPage(url) {
        const page = await this.context.newPage();
        const id = `page-${this.nextPageNum++}`;
        // Deactivate others
        for (const rec of this.pageMap.values())
            rec.active = false;
        this.pageMap.set(id, { page, active: true });
        if (url) {
            await page.goto(url);
        }
        return new PlaywrightPage(page, id, this.opts.workspaceDir);
    }
    /** List all open pages. */
    async pages() {
        const refs = [];
        for (const [id, rec] of this.pageMap) {
            refs.push({
                id,
                url: rec.page.url(),
                title: await rec.page.title(),
                active: rec.active,
            });
        }
        return refs;
    }
    /** Switch the active page. */
    async switchPage(pageId) {
        for (const [id, rec] of this.pageMap) {
            rec.active = id === pageId;
        }
    }
    /** Close a page by id. */
    async closePage(pageId) {
        const rec = this.pageMap.get(pageId);
        if (rec) {
            await rec.page.close();
            this.pageMap.delete(pageId);
        }
    }
    /** Whether the session is headless. */
    isHeadless() {
        return this.opts.headless;
    }
    /** Close context + browser. */
    async close() {
        await this.context.close();
        await this.browser.close();
    }
    activeId() {
        for (const [id, rec] of this.pageMap) {
            if (rec.active)
                return id;
        }
        return '';
    }
}
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
/**
 * Create a Playwright-backed ControlLink.
 *
 * Launches managed Chromium via the `playwright` npm package.
 * If `opts.backend === 'chrome'`, still launches managed Chromium here —
 * the CDP-based Chrome backend is a separate implementation.
 */
export function createPlaywrightControlLink() {
    return {
        async connect(opts) {
            const browser = await chromium.launch({
                headless: opts.headless,
                executablePath: opts.executablePath,
            });
            const context = await browser.newContext();
            return new PlaywrightSession(browser, context, opts);
        },
    };
}
