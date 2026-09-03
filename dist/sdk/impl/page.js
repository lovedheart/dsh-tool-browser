/**
 * Concrete Page implementation — wraps a BackendPage.
 * Ported from QwenPaw's `browser/sdk/page.py` Page class.
 */
import { createLocatorFactory } from "./locator.js";
import { raceAbort } from "../../kernel/run-control.js";
import { currentRunSignal } from "../../kernel/run-context.js";
/** Run a backend op under the current run's abort signal (see locator.ts). */
function op(p) {
    return raceAbort(p, currentRunSignal());
}
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
            click: (x, y) => op(bp.input('mouse', 'click', { x, y })),
            press: (key) => op(bp.input('mouse', 'press', { key })),
            wheel: (deltaX, deltaY) => op(bp.input('mouse', 'wheel', { delta_x: deltaX ?? 0, delta_y: deltaY ?? 0 })),
            drag: (x1, y1, x2, y2, opts) => humanDrag(bp, x1, y1, x2, y2, opts),
        };
        this.keyboard = {
            click: (x, y) => op(bp.input('keyboard', 'click', { x, y })),
            press: (key) => op(bp.input('keyboard', 'press', { key })),
            wheel: (deltaX, deltaY) => op(bp.input('keyboard', 'wheel', { delta_x: deltaX ?? 0, delta_y: deltaY ?? 0 })),
            drag: (x1, y1, x2, y2, opts) => humanDrag(bp, x1, y1, x2, y2, opts),
        };
    }
    // ── navigation ──────────────────────────────────────────────────────
    /** Navigate to url. */
    async goto(url) {
        return op(this.backend.goto(url));
    }
    /** Navigate back in history. */
    async goBack() {
        return op(this.backend.goBack());
    }
    /** Navigate forward in history. */
    async goForward() {
        return op(this.backend.goForward());
    }
    /** Reload the current page. */
    async reload() {
        return op(this.backend.reload());
    }
    /** Retain this page across response cycles for the current chat. */
    async keep() {
        // No-op at the SDK level; the kernel handles pinning.
    }
    // ── waiting ─────────────────────────────────────────────────────────
    /**
     * Wait for a fixed duration (capped at 30 s). Cooperative with the run's
     * abort signal: a budget abort cuts the wait short (AbortError) instead of
     * letting it run to the cap.
     */
    async waitForTimeout(ms) {
        await raceAbort(new Promise((r) => setTimeout(r, Math.min(ms, 30_000))), currentRunSignal());
    }
    /** Wait for the page to reach a load state. */
    async waitForLoadState(state, timeoutMs) {
        await op(this.backend.waitForLoadState(state ?? 'load', timeoutMs));
    }
    // ── perception ──────────────────────────────────────────────────────
    /** Capture a screenshot; returns { path }. */
    async screenshot() {
        return op(this.backend.screenshot());
    }
    /** Perceive page text (+ optional query match count). */
    async snapshot(query) {
        return op(this.backend.snapshot(query));
    }
    /** Report current url/title/load_state. */
    async currentSurface() {
        return op(this.backend.currentSurface());
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
/**
 * A human-like drag: pointer down, eased waypoints with slight lateral jitter
 * and dwell, pointer up. Runs under the current abort signal so a cancelled
 * turn can't leave the mouse stuck down.
 */
async function humanDrag(bp, x1, y1, x2, y2, opts) {
    const steps = Math.max(6, Math.min(40, opts?.steps ?? 24));
    const durationMs = Math.max(120, Math.min(6000, opts?.durationMs ?? 900));
    const stepMs = durationMs / steps;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2); // easeInOutQuad
    await op(bp.input('mouse', 'move', { x: x1, y: y1 }));
    await sleep(40);
    await op(bp.input('mouse', 'down', { x: x1, y: y1 }));
    await sleep(60);
    for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        // lateral wobble peaks mid-drag, ~±1.2px; tiny vertical jitter too.
        const wob = Math.sin((i / steps) * Math.PI) * 1.2;
        const x = x1 + (x2 - x1) * t + (i === steps ? 0 : wob);
        const y = y1 + (y2 - y1) * t + (i === steps ? 0 : wob * 0.4);
        await op(bp.input('mouse', 'move', { x, y }));
        await sleep(stepMs);
    }
    await sleep(80); // settle before release
    await op(bp.input('mouse', 'up', { x: x2, y: y2 }));
    return { evidence: `dragged (${x1},${y1}) -> (${x2},${y2}) in ${steps} steps`, ok: true };
}
