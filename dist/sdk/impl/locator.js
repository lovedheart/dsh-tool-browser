/**
 * Concrete LocatorView implementation — wraps a BackendLocator.
 * Ported from QwenPaw's `browser/runtime/locator.py` LocatorView class.
 *
 * Strict-mode teaching: action methods that can resolve to multiple elements
 * are wrapped so a "strict mode violation" from the backend is re-thrown as a
 * governed BrowserError with locator-ladder teaching.
 */
import { BrowserError } from "../../governance/errors.js";
import { locatorLadderTeaching } from "../../governance/teaching.js";
/**
 * If the backend rejects with a strict-mode violation, re-throw as a governed
 * BrowserError carrying the locator-ladder teaching. Otherwise pass through.
 */
async function guardStrict(promise) {
    try {
        return await promise;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/strict mode violation/i.test(message)) {
            throw new BrowserError({
                category: 'API_MISUSE',
                cause: 'strict_mode_violation',
                reason: 'Locator resolved to more than one element (strict mode).',
                suggested_action: locatorLadderTeaching(),
            });
        }
        throw err;
    }
}
/** Concrete LocatorView bound to one BackendLocator handle. */
export class LocatorViewImpl {
    backend;
    factory;
    constructor(backendLocator, factory) {
        this.backend = backendLocator;
        this.factory = factory;
    }
    // ── compose / scope (chainable) ─────────────────────────────────────
    /** Narrow by ARIA role and optional accessible name. */
    getByRole(role, opts) {
        return this.factory.create(this.backend.getByRole(role, opts?.name));
    }
    /** Narrow by visible text content. */
    getByText(text) {
        return this.factory.create(this.backend.getByText(text));
    }
    /** Narrow by associated label text. */
    getByLabel(text) {
        return this.factory.create(this.backend.getByLabel(text));
    }
    /** Narrow by placeholder text. */
    getByPlaceholder(text) {
        return this.factory.create(this.backend.getByPlaceholder(text));
    }
    /** Filter by contained text. */
    filter(opts) {
        return this.factory.create(this.backend.filter(opts));
    }
    /** Select the i-th match (0-based). */
    nth(i) {
        return this.factory.create(this.backend.nth(i));
    }
    /** The first match. */
    get first() {
        return this.factory.create(this.backend.first);
    }
    /** The last match. */
    get last() {
        return this.factory.create(this.backend.last);
    }
    // ── read (await) ────────────────────────────────────────────────────
    /** Number of matching elements. */
    async count() {
        return this.backend.count();
    }
    /** Inner text of the (single) matched element. */
    async innerText() {
        return this.backend.innerText();
    }
    /** Text content of the (single) matched element, or null. */
    async textContent() {
        return this.backend.textContent();
    }
    /** Text content of all matched elements. */
    async allTextContents() {
        return this.backend.allTextContents();
    }
    /** Value of an attribute on the (single) matched element, or null. */
    async getAttribute(name) {
        return this.backend.getAttribute(name);
    }
    /** Current input value of the (single) matched element. */
    async inputValue() {
        return this.backend.inputValue();
    }
    /** Whether the (single) matched element is visible. */
    async isVisible() {
        return this.backend.isVisible();
    }
    /** Whether the (single) matched element is enabled. */
    async isEnabled() {
        return this.backend.isEnabled();
    }
    /** Viewport bounding box of the (single) matched element, or null. */
    async boundingBox() {
        return this.backend.boundingBox();
    }
    // ── act (await; returns { evidence }) ───────────────────────────────
    /** Click the (single) matched element. */
    async click() {
        return guardStrict(this.backend.click());
    }
    /** Fill an input/textarea with a value. */
    async fill(value) {
        return guardStrict(this.backend.fill(value));
    }
    /** Type text character-by-character into an input. */
    async type(text) {
        return guardStrict(this.backend.type(text));
    }
    /** Press a key while focused on the element. */
    async press(key) {
        return guardStrict(this.backend.press(key));
    }
    /** Check a checkbox/radio. */
    async check() {
        return guardStrict(this.backend.check());
    }
    /** Uncheck a checkbox/radio. */
    async uncheck() {
        return guardStrict(this.backend.uncheck());
    }
    /** Set checked state explicitly. */
    async setChecked(b) {
        return guardStrict(this.backend.setChecked(b));
    }
    /** Select option(s) in a <select>. */
    async selectOption(...values) {
        return guardStrict(this.backend.selectOption(...values));
    }
    /** Hover over the element. */
    async hover() {
        return guardStrict(this.backend.hover());
    }
    /** Double-click the element. */
    async dblclick() {
        return guardStrict(this.backend.dblclick());
    }
    /** Scroll the element into view. */
    async scroll() {
        return guardStrict(this.backend.scroll());
    }
    /** Focus the element. */
    async focus() {
        return guardStrict(this.backend.focus());
    }
    /** Blur (unfocus) the element. */
    async blur() {
        return guardStrict(this.backend.blur());
    }
    /** Clear an input's value. */
    async clear() {
        return guardStrict(this.backend.clear());
    }
    /** Wait for the element to reach a state. */
    async waitFor(state, timeoutMs) {
        return this.backend.waitFor(state, timeoutMs);
    }
    /** Screenshot the element; returns { path }. */
    async screenshot() {
        return this.backend.screenshot();
    }
}
/** Factory that binds a LocatorView to a backend locator handle. */
export function createLocatorFactory() {
    const factory = {
        create(backendLocator) {
            return new LocatorViewImpl(backendLocator, factory);
        },
    };
    return factory;
}
