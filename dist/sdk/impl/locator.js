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
import { raceAbort } from "../../kernel/run-control.js";
import { currentRunSignal } from "../../kernel/run-context.js";
/**
 * Run a backend op under the current run's abort signal (cooperative cancel).
 * On abort the op's wait rejects with an AbortError — the run ends in a
 * governed RETRYABLE error and the model's continuation stops, while the
 * browser session survives. Outside a run (tests) the signal is undefined and
 * this is a pass-through.
 */
function op(p) {
    return raceAbort(p, currentRunSignal());
}
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
        return op(this.backend.count());
    }
    /** Inner text of the (single) matched element. */
    async innerText() {
        return op(this.backend.innerText());
    }
    /** Text content of the (single) matched element, or null. */
    async textContent() {
        return op(this.backend.textContent());
    }
    /** Text content of all matched elements. */
    async allTextContents() {
        return op(this.backend.allTextContents());
    }
    /** Value of an attribute on the (single) matched element, or null. */
    async getAttribute(name) {
        return op(this.backend.getAttribute(name));
    }
    /** Current input value of the (single) matched element. */
    async inputValue() {
        return op(this.backend.inputValue());
    }
    /** Whether the (single) matched element is visible. */
    async isVisible() {
        return op(this.backend.isVisible());
    }
    /** Whether the (single) matched element is enabled. */
    async isEnabled() {
        return op(this.backend.isEnabled());
    }
    /** Viewport bounding box of the (single) matched element, or null. */
    async boundingBox() {
        return op(this.backend.boundingBox());
    }
    // ── act (await; returns { evidence }) ───────────────────────────────
    /** Click the (single) matched element. */
    async click() {
        return guardStrict(op(this.backend.click()));
    }
    /** Fill an input/textarea with a value. */
    async fill(value) {
        return guardStrict(op(this.backend.fill(value)));
    }
    /** Type text character-by-character into an input. */
    async type(text) {
        return guardStrict(op(this.backend.type(text)));
    }
    /** Press a key while focused on the element. */
    async press(key) {
        return guardStrict(op(this.backend.press(key)));
    }
    /** Check a checkbox/radio. */
    async check() {
        return guardStrict(op(this.backend.check()));
    }
    /** Uncheck a checkbox/radio. */
    async uncheck() {
        return guardStrict(op(this.backend.uncheck()));
    }
    /** Set checked state explicitly. */
    async setChecked(b) {
        return guardStrict(op(this.backend.setChecked(b)));
    }
    /** Select option(s) in a <select>. */
    async selectOption(...values) {
        return guardStrict(op(this.backend.selectOption(...values)));
    }
    /** Hover over the element. */
    async hover() {
        return guardStrict(op(this.backend.hover()));
    }
    /** Double-click the element. */
    async dblclick() {
        return guardStrict(op(this.backend.dblclick()));
    }
    /** Scroll the element into view. */
    async scroll() {
        return guardStrict(op(this.backend.scroll()));
    }
    /** Focus the element. */
    async focus() {
        return guardStrict(op(this.backend.focus()));
    }
    /** Blur (unfocus) the element. */
    async blur() {
        return guardStrict(op(this.backend.blur()));
    }
    /** Clear an input's value. */
    async clear() {
        return guardStrict(op(this.backend.clear()));
    }
    /** Wait for the element to reach a state. */
    async waitFor(state, timeoutMs) {
        return op(this.backend.waitFor(state, timeoutMs));
    }
    /** Screenshot the element; returns { path }. */
    async screenshot() {
        return op(this.backend.screenshot());
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
