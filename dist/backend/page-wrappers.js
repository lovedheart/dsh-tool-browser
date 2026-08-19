/**
 * Shared page + locator wrappers for Playwright-based backends.
 *
 * Both the managed-Chromium Playwright backend (`playwright.ts`) and the
 * user-Chrome-over-CDP backend (`chrome-cdp.ts`) drive the same Playwright
 * `Page` / `Locator` / `FrameLocator` objects. To avoid duplicating ~360 lines
 * of wrapper logic across the two backends, the shared {@link PlaywrightPage}
 * and {@link PlaywrightLocator} classes live here and are imported by both.
 */
import * as path from 'node:path';
import { BrowserError } from "../governance/errors.js";
// ---------------------------------------------------------------------------
// Aria-snapshot parsing
// ---------------------------------------------------------------------------
/**
 * Parse a Playwright `ariaSnapshot({ mode: 'ai' })` string into flat
 * {@link ObservedElement} records.
 *
 * The ai-mode tree is line-oriented: 2-space indent per level, `- ` bullet per
 * node, the first token is the ARIA role, an optional quoted string is the
 * accessible name, a trailing `: text` is the node's visible text, and
 * `[ref=eN]` tags carry a stable element id. Meta continuation lines
 * (`/url: ...`, `/placeholder: ...`) are attributes of the preceding node and
 * are skipped. Lines like `- text: Foo` use the keyword `text` itself as the
 * "role".
 *
 * Empty structural wrappers (no name, no text, no ref) are dropped to keep the
 * element list compact; named/labelled nodes and all ref-tagged containers are
 * kept.
 */
export function parseAriaSnapshot(tree) {
    const ref = /\[ref=([A-Za-z0-9_-]+)\]/;
    const elements = [];
    for (const raw of tree.split('\n')) {
        const line = raw.replace(/\s+$/, '');
        if (!line.trim())
            continue;
        let i = 0;
        while (i < line.length && line[i] === ' ')
            i++;
        let body = line.slice(i);
        if (!body.startsWith('-'))
            continue; // not a node line
        body = body.slice(1).replace(/^\s+/, '');
        if (!body || body.startsWith('/'))
            continue; // meta continuation line
        // 1. Role = first token. A pseudo-role may carry a trailing colon
        //    (e.g. `text: Foo` → role `text`); the colon is part of the token.
        const rm = body.match(/^(\S+)/);
        let role = rm ? rm[1] : '';
        let rest = rm ? body.slice(rm[0].length).trim() : body;
        if (role.endsWith(':'))
            role = role.slice(0, -1); // `text:` pseudo-role
        // 2. Optional quoted accessible name, immediately after the role.
        let name = '';
        const nm = rest.match(/^"(.*)"\s*(.*)$/);
        if (nm) {
            name = nm[1];
            rest = nm[2];
        }
        // 3. Strip leading bracketed attributes (`[level=1]`, `[ref=e12]`, ...).
        rest = rest.replace(/^\s*(?:\[[^\]]*\]\s*)*/, '');
        // 4. Optional trailing `: text` payload.
        let text = '';
        if (rest.startsWith(':')) {
            text = rest.slice(1).trim();
        }
        else if (rest) {
            text = rest; // e.g. `text: Foo` already split at the token boundary
        }
        const refMatch = body.match(ref);
        const refId = refMatch ? refMatch[1] : undefined;
        if (!name && !text && !refId)
            continue; // drop empty anonymous wrappers
        elements.push({ role, name, text, ...(refId ? { ref_id: refId } : {}) });
    }
    return elements;
}
// ---------------------------------------------------------------------------
// BackendLocator wrapper
// ---------------------------------------------------------------------------
/**
 * Wraps a Playwright `Locator` / `FrameLocator` into the backend's
 * {@link BackendLocator} interface. Read-only composition helpers; each
 * action returns a short evidence line.
 */
export class PlaywrightLocator {
    loc;
    workspaceDir;
    id;
    constructor(loc, workspaceDir, id) {
        this.loc = loc;
        this.workspaceDir = workspaceDir;
        this.id = id;
    }
    // -- compose / scope ------------------------------------------------------
    getByRole(role, name) {
        const l = this.loc.getByRole(role, name ? { name } : {});
        return new PlaywrightLocator(l, this.workspaceDir, this.id);
    }
    getByText(text) {
        const l = this.loc.getByText(text);
        return new PlaywrightLocator(l, this.workspaceDir, this.id);
    }
    getByLabel(text) {
        const l = this.loc.getByLabel(text);
        return new PlaywrightLocator(l, this.workspaceDir, this.id);
    }
    getByPlaceholder(text) {
        const l = this.loc.getByPlaceholder(text);
        return new PlaywrightLocator(l, this.workspaceDir, this.id);
    }
    filter(opts) {
        const l = this.loc.filter(opts);
        return new PlaywrightLocator(l, this.workspaceDir, this.id);
    }
    nth(i) {
        const l = this.loc.nth(i);
        return new PlaywrightLocator(l, this.workspaceDir, this.id);
    }
    get first() {
        const l = this.loc.first();
        return new PlaywrightLocator(l, this.workspaceDir, this.id);
    }
    get last() {
        const l = this.loc.last();
        return new PlaywrightLocator(l, this.workspaceDir, this.id);
    }
    // -- read -----------------------------------------------------------------
    async count() {
        return this.loc.count();
    }
    async innerText() {
        return this.loc.innerText();
    }
    async textContent() {
        return this.loc.textContent();
    }
    async allTextContents() {
        return this.loc.allTextContents();
    }
    async getAttribute(name) {
        return this.loc.getAttribute(name);
    }
    async inputValue() {
        return this.loc.inputValue();
    }
    async isVisible() {
        return this.loc.isVisible();
    }
    async isEnabled() {
        return this.loc.isEnabled();
    }
    async boundingBox() {
        return this.loc.boundingBox();
    }
    // -- act ------------------------------------------------------------------
    async click() {
        await this.loc.click();
        return { evidence: 'clicked' };
    }
    async fill(value) {
        await this.loc.fill(value);
        return { evidence: `filled "${value}"` };
    }
    async type(text) {
        await this.loc.pressSequentially(text);
        return { evidence: `typed "${text}"` };
    }
    async press(key) {
        await this.loc.press(key);
        return { evidence: `pressed "${key}"` };
    }
    async check() {
        await this.loc.check();
        return { evidence: 'checked' };
    }
    async uncheck() {
        await this.loc.uncheck();
        return { evidence: 'unchecked' };
    }
    async setChecked(b) {
        if (b)
            await this.loc.check();
        else
            await this.loc.uncheck();
        return { evidence: b ? 'checked' : 'unchecked' };
    }
    async selectOption(...values) {
        if (values.length === 0) {
            throw new BrowserError({
                category: 'API_MISUSE',
                cause: 'api_misuse',
                reason: 'selectOption requires at least one value.',
                suggested_action: 'Call selectOption(value) or selectOption(v1, v2, ...) for a multi-select.',
            });
        }
        // Playwright accepts an array of options for multi-select; a single-element
        // array selects one. (A multi-value call on a non-multiple <select> throws
        // from Playwright, which is the correct behavior.)
        await this.loc.selectOption(values.map((v) => ({ value: v })));
        return { evidence: `selected "${values.join('", "')}"` };
    }
    async hover() {
        await this.loc.hover();
        return { evidence: 'hovered' };
    }
    async dblclick() {
        await this.loc.dblclick();
        return { evidence: 'double-clicked' };
    }
    async scroll() {
        await this.loc.evaluate((el) => el.scrollIntoView());
        return { evidence: 'scrolled into view' };
    }
    async focus() {
        await this.loc.focus();
        return { evidence: 'focused' };
    }
    async blur() {
        await this.loc.blur();
        return { evidence: 'blurred' };
    }
    async clear() {
        await this.loc.fill('');
        return { evidence: 'cleared' };
    }
    async waitFor(state, timeoutMs) {
        await this.loc.waitFor({ state, timeout: timeoutMs });
    }
    async screenshot() {
        const ts = Date.now();
        const file = path.join(this.workspaceDir, `browser_shot_${this.id}_loc_${ts}.png`);
        await this.loc.screenshot({ path: file });
        return { path: file };
    }
}
// ---------------------------------------------------------------------------
// BackendPage wrapper
// ---------------------------------------------------------------------------
/**
 * Wraps a Playwright `Page` into the backend's {@link BackendPage} interface.
 * Both backends (managed Chromium and CDP-attached Chrome) use this, so the
 * navigation, snapshot, screenshot, input and locator-resolution logic is
 * identical across them.
 */
export class PlaywrightPage {
    id;
    page;
    workspaceDir;
    constructor(page, id, workspaceDir) {
        this.page = page;
        this.id = id;
        this.workspaceDir = workspaceDir;
    }
    /** Navigate to url; returns raw navigation facts. */
    async goto(url) {
        try {
            await this.page.goto(url);
            return { url: this.page.url(), ok: true };
        }
        catch (e) {
            throw new BrowserError({
                category: 'RETRYABLE',
                cause: 'navigation_failed',
                reason: `Navigation to ${url} failed`,
                detail: e instanceof Error ? e.message : String(e),
                suggested_action: 'Check the URL and retry, or navigate to a different page.',
            });
        }
    }
    /** Go back in history. */
    async goBack() {
        try {
            await this.page.goBack();
            return { url: this.page.url(), ok: true };
        }
        catch (e) {
            throw new BrowserError({
                category: 'RETRYABLE',
                cause: 'navigation_failed',
                reason: 'goBack failed',
                detail: e instanceof Error ? e.message : String(e),
            });
        }
    }
    /** Go forward in history. */
    async goForward() {
        try {
            await this.page.goForward();
            return { url: this.page.url(), ok: true };
        }
        catch (e) {
            throw new BrowserError({
                category: 'RETRYABLE',
                cause: 'navigation_failed',
                reason: 'goForward failed',
                detail: e instanceof Error ? e.message : String(e),
            });
        }
    }
    /** Reload the current page. */
    async reload() {
        try {
            await this.page.reload();
            return { url: this.page.url(), ok: true };
        }
        catch (e) {
            throw new BrowserError({
                category: 'RETRYABLE',
                cause: 'navigation_failed',
                reason: 'reload failed',
                detail: e instanceof Error ? e.message : String(e),
            });
        }
    }
    /** Wait for a load state. */
    async waitForLoadState(state, timeoutMs) {
        // Pass the timeout through only when the caller set one, so Playwright's
        // default (30s) applies otherwise rather than `undefined`.
        await this.page.waitForLoadState(state, timeoutMs !== undefined ? { timeout: timeoutMs } : {});
    }
    /** Perceive: page text (+ optional query match count) + structured elements. */
    async snapshot(query) {
        let text = '';
        try {
            text = await this.page.locator('body').innerText();
        }
        catch {
            text = '';
        }
        // Structured elements from the accessibility tree. Playwright 1.62 removed
        // `page.accessibility.snapshot()`; the modern API is `page.ariaSnapshot`
        // with `mode: 'ai'`, which emits a line-oriented tree tagged with stable
        // `[ref=eN]` ids (the analogue of QwenPaw's `ObservedElement.ref_id`).
        // Best-effort: if it throws (older runtime / mid-navigation) we still
        // return the text observation.
        let elements;
        try {
            const tree = await this.page.ariaSnapshot({ mode: 'ai' });
            elements = parseAriaSnapshot(tree);
        }
        catch {
            elements = undefined;
        }
        if (query !== undefined) {
            const q = query.toLowerCase();
            const match_count = text
                .split('\n')
                .filter((line) => line.toLowerCase().includes(q)).length;
            return { text, elements, match_count };
        }
        return { text, elements };
    }
    /** Current surface info. */
    async currentSurface() {
        // Map document.readyState onto the SDK's load_state vocabulary. This is a
        // best-effort live probe (evaluate can fail mid-navigation); fall back to
        // 'load' rather than letting currentSurface() throw.
        let load_state = 'load';
        try {
            // The callback runs in the browser context (document exists there), but it
            // is type-checked against the node lib, so read the global defensively.
            const readyState = await this.page.evaluate(() => globalThis.document?.readyState ?? 'complete');
            load_state =
                readyState === 'complete' ? 'load'
                    : readyState === 'interactive' ? 'domcontentloaded'
                        : 'loading';
        }
        catch {
            // keep the 'load' default
        }
        return {
            url: this.page.url(),
            title: await this.page.title(),
            load_state,
        };
    }
    /** Screenshot to a PNG in the workspace; returns { path }. */
    async screenshot() {
        const ts = Date.now();
        const file = path.join(this.workspaceDir, `browser_shot_${this.id}_${ts}.png`);
        await this.page.screenshot({ path: file });
        return { path: file };
    }
    /** Coordinate/keyboard input. */
    async input(kind, verb, opts) {
        if (kind === 'mouse' && verb === 'click') {
            await this.page.mouse.click(opts.x ?? 0, opts.y ?? 0);
            return { evidence: `mouse.click(${opts.x ?? 0}, ${opts.y ?? 0})`, ok: true, kind, verb };
        }
        else if (kind === 'mouse' && verb === 'wheel') {
            await this.page.mouse.wheel(opts.delta_x ?? 0, opts.delta_y ?? 0);
            return { evidence: `mouse.wheel(${opts.delta_x ?? 0}, ${opts.delta_y ?? 0})`, ok: true, kind, verb };
        }
        else if (kind === 'keyboard' && verb === 'press') {
            await this.page.keyboard.press(opts.key ?? '');
            return { evidence: `keyboard.press("${opts.key ?? ''}")`, ok: true, kind, verb };
        }
        // Unsupported combination (e.g. mouse.press or keyboard.click): surface it
        // as a governed error instead of a silent no-op, so the model learns the
        // correct call rather than believing the action happened.
        throw new BrowserError({
            category: 'API_MISUSE',
            cause: 'api_misuse',
            reason: `Unsupported input combination: ${kind}.${verb}`,
            suggested_action: 'Use page.mouse.click(x, y), page.mouse.wheel(dx, dy), or ' +
                'page.keyboard.press(key).',
        });
    }
    /** Resolve a locator spec to a backend locator handle. */
    locator(spec) {
        let loc;
        switch (spec.kind) {
            case 'css':
                loc = this.page.locator(spec.selector);
                break;
            case 'role':
                loc = this.page.getByRole(spec.role, spec.name ? { name: spec.name } : {});
                break;
            case 'text':
                loc = this.page.getByText(spec.text);
                break;
            case 'label':
                loc = this.page.getByLabel(spec.text);
                break;
            case 'placeholder':
                loc = this.page.getByPlaceholder(spec.text);
                break;
            default:
                throw new BrowserError({
                    category: 'API_MISUSE',
                    cause: 'api_misuse',
                    reason: `Unsupported locator kind: ${spec.kind}`,
                });
        }
        // Apply filters in order
        if (spec.filters) {
            for (const f of spec.filters) {
                loc = loc.filter(f);
            }
        }
        if (spec.nth !== undefined)
            loc = loc.nth(spec.nth);
        if (spec.first)
            loc = loc.first();
        if (spec.last)
            loc = loc.last();
        return new PlaywrightLocator(loc, this.workspaceDir, this.id);
    }
    /** Create a frame locator wrapper. */
    frameLocator(selector) {
        const fl = this.page.frameLocator(selector);
        return new PlaywrightLocator(fl, this.workspaceDir, this.id);
    }
    /** Close this page. */
    async close() {
        await this.page.close();
    }
}
