/**
 * Shared page + locator wrappers for Playwright-based backends.
 *
 * Both the managed-Chromium Playwright backend (`playwright.ts`) and the
 * user-Chrome-over-CDP backend (`chrome-cdp.ts`) drive the same Playwright
 * `Page` / `Locator` / `FrameLocator` objects. To avoid duplicating ~360 lines
 * of wrapper logic across the two backends, the shared {@link PlaywrightPage}
 * and {@link PlaywrightLocator} classes live here and are imported by both.
 */
import type { FrameLocator, Locator, Page } from 'playwright';
import type { BackendLocator, BackendPage, LocatorSpec } from './ports.ts';
import type { CurrentSurface, Observation, ObservedElement } from '../sdk/contracts.ts';
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
export declare function parseAriaSnapshot(tree: string): ObservedElement[];
/**
 * Wraps a Playwright `Locator` / `FrameLocator` into the backend's
 * {@link BackendLocator} interface. Read-only composition helpers; each
 * action returns a short evidence line.
 */
export declare class PlaywrightLocator implements BackendLocator {
    private readonly loc;
    private readonly workspaceDir;
    private readonly id;
    constructor(loc: Locator | FrameLocator, workspaceDir: string, id: string);
    getByRole(role: string, name?: string): BackendLocator;
    getByText(text: string): BackendLocator;
    getByLabel(text: string): BackendLocator;
    getByPlaceholder(text: string): BackendLocator;
    filter(opts: {
        hasText?: string;
    }): BackendLocator;
    nth(i: number): BackendLocator;
    get first(): BackendLocator;
    get last(): BackendLocator;
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
/**
 * Wraps a Playwright `Page` into the backend's {@link BackendPage} interface.
 * Both backends (managed Chromium and CDP-attached Chrome) use this, so the
 * navigation, snapshot, screenshot, input and locator-resolution logic is
 * identical across them.
 */
export declare class PlaywrightPage implements BackendPage {
    readonly id: string;
    readonly page: Page;
    private readonly workspaceDir;
    constructor(page: Page, id: string, workspaceDir: string);
    /** Navigate to url; returns raw navigation facts. */
    goto(url: string): Promise<Record<string, unknown>>;
    /** Go back in history. */
    goBack(): Promise<Record<string, unknown>>;
    /** Go forward in history. */
    goForward(): Promise<Record<string, unknown>>;
    /** Reload the current page. */
    reload(): Promise<Record<string, unknown>>;
    /** Wait for a load state. */
    waitForLoadState(state: string, timeoutMs?: number): Promise<void>;
    /** Perceive: page text (+ optional query match count) + structured elements. */
    snapshot(query?: string): Promise<Observation>;
    /** Current surface info. */
    currentSurface(): Promise<CurrentSurface>;
    /** Screenshot to a PNG in the workspace; returns { path }. */
    screenshot(): Promise<{
        path: string;
    }>;
    /** Coordinate/keyboard input. */
    input(kind: 'mouse' | 'keyboard', verb: 'click' | 'press' | 'wheel', opts: {
        x?: number;
        y?: number;
        key?: string;
        delta_x?: number;
        delta_y?: number;
    }): Promise<Record<string, unknown>>;
    /** Resolve a locator spec to a backend locator handle. */
    locator(spec: LocatorSpec): BackendLocator;
    /** Create a frame locator wrapper. */
    frameLocator(selector: string): BackendLocator;
    /** Close this page. */
    close(): Promise<void>;
}
