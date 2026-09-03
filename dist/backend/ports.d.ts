/**
 * ControlLink port — the seam between the Browser SDK and a concrete browser
 * backend (Playwright managed Chromium, or a user's real Chrome over CDP).
 * Ported from QwenPaw's `browser/runtime/ports.py` + `control_link/*`.
 *
 * The SDK (facade/page/locator) programs against this interface only; the
 * backend implements it. This keeps the two backends swappable and lets tests
 * inject a fake link.
 */
import type { Observation, CurrentSurface, PageRef } from '../sdk/contracts.ts';
/** A live page handle owned by one backend session. Opaque to the SDK. */
export interface BackendPage {
    readonly id: string;
    /** Navigate to url; returns raw navigation facts. */
    goto(url: string): Promise<Record<string, unknown>>;
    goBack(): Promise<Record<string, unknown>>;
    goForward(): Promise<Record<string, unknown>>;
    reload(): Promise<Record<string, unknown>>;
    waitForLoadState(state: string, timeoutMs?: number): Promise<void>;
    /** Perceive: page text (+ optional query match count). */
    snapshot(query?: string): Promise<Observation>;
    currentSurface(): Promise<CurrentSurface>;
    /** Screenshot to a PNG in the workspace; returns { path }. */
    screenshot(): Promise<{
        path: string;
    }>;
    /** Coordinate/keyboard input. kind: 'mouse' | 'keyboard'. */
    input(kind: 'mouse' | 'keyboard', verb: 'click' | 'press' | 'wheel', opts: {
        x?: number;
        y?: number;
        key?: string;
        delta_x?: number;
        delta_y?: number;
    }): Promise<Record<string, unknown>>;
    /**
     * Resolve a locator spec to a backend locator handle. The SDK's LocatorView
     * wraps this; specs are built by chaining getByRole / locator / filter / nth.
     */
    locator(spec: LocatorSpec): BackendLocator;
    frameLocator(selector: string): BackendLocator;
    close(): Promise<void>;
}
/** A chainable locator handle (backend-side). Mirrors QwenPaw LocatorView ops. */
export interface BackendLocator {
    getByRole(role: string, name?: string): BackendLocator;
    getByText(text: string): BackendLocator;
    getByLabel(text: string): BackendLocator;
    getByPlaceholder(text: string): BackendLocator;
    filter(opts: {
        hasText?: string;
    }): BackendLocator;
    nth(i: number): BackendLocator;
    readonly first: BackendLocator;
    readonly last: BackendLocator;
    count(): Promise<number>;
    innerText(): Promise<string>;
    textContent(): Promise<string | null>;
    allTextContents(): Promise<string[]>;
    getAttribute(name: string): Promise<string | null>;
    inputValue(): Promise<string>;
    isVisible(): Promise<boolean>;
    isEnabled(): Promise<boolean>;
    boundingBox(): Promise<{
        x: number;
        y: number;
        width: number;
        height: number;
    } | null>;
    click(): Promise<{
        evidence: string;
    }>;
    fill(value: string): Promise<{
        evidence: string;
    }>;
    type(text: string): Promise<{
        evidence: string;
    }>;
    press(key: string): Promise<{
        evidence: string;
    }>;
    check(): Promise<{
        evidence: string;
    }>;
    uncheck(): Promise<{
        evidence: string;
    }>;
    setChecked(b: boolean): Promise<{
        evidence: string;
    }>;
    selectOption(...values: string[]): Promise<{
        evidence: string;
    }>;
    hover(): Promise<{
        evidence: string;
    }>;
    dblclick(): Promise<{
        evidence: string;
    }>;
    scroll(): Promise<{
        evidence: string;
    }>;
    focus(): Promise<{
        evidence: string;
    }>;
    blur(): Promise<{
        evidence: string;
    }>;
    clear(): Promise<{
        evidence: string;
    }>;
    waitFor(state: 'visible' | 'hidden' | 'attached' | 'detached', timeoutMs?: number): Promise<void>;
    screenshot(): Promise<{
        path: string;
    }>;
}
/** Declarative locator spec the SDK compiles from its chained calls. */
export interface LocatorSpec {
    kind: 'role' | 'text' | 'label' | 'placeholder' | 'css' | 'frame';
    role?: string;
    name?: string;
    text?: string;
    selector?: string;
    filters?: {
        hasText?: string;
    }[];
    nth?: number;
    first?: boolean;
    last?: boolean;
}
/** Launch/connect options for a backend. */
export interface BackendOptions {
    readonly backend: 'playwright' | 'chrome' | 'chrome-extension';
    /**
     * Already-resolved headless flag. Callers (the KernelManager) resolve a
     * config-level 'auto' to a concrete boolean before constructing this, so the
     * backends only ever see `true`/`false`.
     */
    readonly headless: boolean;
    readonly executablePath?: string;
    readonly cdpUrl?: string;
    /** Extra Chromium launch flags (playwright backend only). */
    readonly args?: string[];
    /** Proxy server, e.g. 'http://127.0.0.1:7890' (playwright backend only). */
    readonly proxy?: string;
    /** Viewport for new contexts (playwright backend only). */
    readonly viewport?: {
        width: number;
        height: number;
    };
    /** Persistent profile dir (playwright backend only; enables persistent context). */
    readonly userDataDir?: string;
    /** Workspace dir where screenshots / overflow output are written. */
    readonly workspaceDir: string;
}
/** A connected backend session owning pages for one Owner. */
export interface BackendSession {
    readonly variant: string;
    openPage(url?: string): Promise<BackendPage>;
    presentPage(url?: string): Promise<BackendPage>;
    pages(): Promise<PageRef[]>;
    switchPage(pageId: string): Promise<void>;
    closePage(pageId: string): Promise<void>;
    isHeadless(): boolean;
    close(): Promise<void>;
}
/** Factory the KernelManager calls to bring up a backend session. */
export interface ControlLink {
    connect(opts: BackendOptions): Promise<BackendSession>;
    /** Diagnostics for bridge_disconnected self-test rendering. */
    selfTest?(): Promise<Record<string, unknown>>;
}
