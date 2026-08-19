/**
 * Concrete Page implementation — wraps a BackendPage.
 * Ported from QwenPaw's `browser/sdk/page.py` Page class.
 */
import { createLocatorFactory } from "./locator.js";
/** Concrete Page bound to one BackendPage handle. */
export class PageImpl {
    id;
    mouse;
    keyboard;
    backend;
    locatorFactory = createLocatorFactory();
    constructor(backendPage) {
        this.backend = backendPage;
        this.id = backendPage.id;
        const bp = backendPage;
        this.mouse = {
            click: (x, y) => bp.input('mouse', 'click', { x, y }),
            press: (key) => bp.input('mouse', 'press', { key }),
            wheel: (deltaX, deltaY) => bp.input('mouse', 'wheel', { delta_x: deltaX ?? 0, delta_y: deltaY ?? 0 }),
        };
        this.keyboard = {
            click: (x, y) => bp.input('keyboard', 'click', { x, y }),
            press: (key) => bp.input('keyboard', 'press', { key }),
            wheel: (deltaX, deltaY) => bp.input('keyboard', 'wheel', { delta_x: deltaX ?? 0, delta_y: deltaY ?? 0 }),
        };
    }
    // ── navigation ──────────────────────────────────────────────────────
    /** Navigate to url. */
    async goto(url) {
        return this.backend.goto(url);
    }
    /** Navigate back in history. */
    async goBack() {
        return this.backend.goBack();
    }
    /** Navigate forward in history. */
    async goForward() {
        return this.backend.goForward();
    }
    /** Reload the current page. */
    async reload() {
        return this.backend.reload();
    }
    /** Retain this page across response cycles for the current chat. */
    async keep() {
        // No-op at the SDK level; the kernel handles pinning.
    }
    // ── waiting ─────────────────────────────────────────────────────────
    /** Wait for a fixed duration (capped at 30 s). */
    async waitForTimeout(ms) {
        await new Promise((r) => setTimeout(r, Math.min(ms, 30_000)));
    }
    /** Wait for the page to reach a load state. */
    async waitForLoadState(state, timeoutMs) {
        await this.backend.waitForLoadState(state ?? 'load', timeoutMs);
    }
    // ── perception ──────────────────────────────────────────────────────
    /** Capture a screenshot; returns { path }. */
    async screenshot() {
        return this.backend.screenshot();
    }
    /** Perceive page text (+ optional query match count). */
    async snapshot(query) {
        return this.backend.snapshot(query);
    }
    /** Report current url/title/load_state. */
    async currentSurface() {
        return this.backend.currentSurface();
    }
    // ── locating (semantic first) ───────────────────────────────────────
    /** Locate by ARIA role and optional accessible name. */
    getByRole(role, opts) {
        const spec = { kind: 'role', role, name: opts?.name };
        return this.locatorFactory.create(this.backend.locator(spec));
    }
    /** Locate by visible text content. */
    getByText(text) {
        const spec = { kind: 'text', text };
        return this.locatorFactory.create(this.backend.locator(spec));
    }
    /** Locate by associated label text. */
    getByLabel(text) {
        const spec = { kind: 'label', text };
        return this.locatorFactory.create(this.backend.locator(spec));
    }
    /** Locate by placeholder text. */
    getByPlaceholder(text) {
        const spec = { kind: 'placeholder', text };
        return this.locatorFactory.create(this.backend.locator(spec));
    }
    /** Locate by CSS selector. */
    locator(css) {
        const spec = { kind: 'css', selector: css };
        return this.locatorFactory.create(this.backend.locator(spec));
    }
    /** Scope into an iframe by selector. */
    frameLocator(selector) {
        return this.locatorFactory.create(this.backend.frameLocator(selector));
    }
}
/** Factory that binds a Page to a backend page handle. */
export function createPageFactory() {
    return {
        create(backendPage) {
            return new PageImpl(backendPage);
        },
    };
}
