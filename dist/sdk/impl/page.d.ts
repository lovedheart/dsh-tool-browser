/**
 * Concrete Page implementation — wraps a BackendPage.
 * Ported from QwenPaw's `browser/sdk/page.py` Page class.
 */
import type { CurrentSurface, Observation } from '../contracts.ts';
import type { InputSurface, Page, PageFactory } from '../page.ts';
import type { LocatorView } from '../locator.ts';
import type { BackendPage } from '../../backend/ports.ts';
/** Concrete Page bound to one BackendPage handle. */
export declare class PageImpl implements Page {
    readonly id: string;
    readonly mouse: InputSurface;
    readonly keyboard: InputSurface;
    private readonly backend;
    private readonly locatorFactory;
    constructor(backendPage: BackendPage);
    /** Navigate to url. */
    goto(url: string): Promise<Record<string, unknown>>;
    /** Navigate back in history. */
    goBack(): Promise<Record<string, unknown>>;
    /** Navigate forward in history. */
    goForward(): Promise<Record<string, unknown>>;
    /** Reload the current page. */
    reload(): Promise<Record<string, unknown>>;
    /** Retain this page across response cycles for the current chat. */
    keep(): Promise<void>;
    /**
     * Wait for a fixed duration (capped at 30 s). Cooperative with the run's
     * abort signal: a budget abort cuts the wait short (AbortError) instead of
     * letting it run to the cap.
     */
    waitForTimeout(ms: number): Promise<void>;
    /** Wait for the page to reach a load state. */
    waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle', timeoutMs?: number): Promise<void>;
    /** Capture a screenshot; returns { path }. */
    screenshot(): Promise<{
        path: string;
    }>;
    /** Perceive page text (+ optional query match count). */
    snapshot(query?: string): Promise<Observation>;
    /** Report current url/title/load_state. */
    currentSurface(): Promise<CurrentSurface>;
    /** Locate by ARIA role and optional accessible name. */
    getByRole(role: string, opts?: {
        name?: string;
    }): LocatorView;
    /** Locate by visible text content. */
    getByText(text: string): LocatorView;
    /** Locate by associated label text. */
    getByLabel(text: string): LocatorView;
    /** Locate by placeholder text. */
    getByPlaceholder(text: string): LocatorView;
    /** Locate by CSS selector. */
    locator(css: string): LocatorView;
    /** Scope into an iframe by selector. */
    frameLocator(selector: string): LocatorView;
}
/** Factory that binds a Page to a backend page handle. */
export declare function createPageFactory(): PageFactory;
