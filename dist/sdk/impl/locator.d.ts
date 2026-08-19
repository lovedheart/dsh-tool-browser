/**
 * Concrete LocatorView implementation — wraps a BackendLocator.
 * Ported from QwenPaw's `browser/runtime/locator.py` LocatorView class.
 *
 * Strict-mode teaching: action methods that can resolve to multiple elements
 * are wrapped so a "strict mode violation" from the backend is re-thrown as a
 * governed BrowserError with locator-ladder teaching.
 */
import type { LocatorView, LocatorFactory } from '../locator.ts';
import type { BackendLocator } from '../../backend/ports.ts';
/** Concrete LocatorView bound to one BackendLocator handle. */
export declare class LocatorViewImpl implements LocatorView {
    private readonly backend;
    private readonly factory;
    constructor(backendLocator: BackendLocator, factory: LocatorFactory);
    /** Narrow by ARIA role and optional accessible name. */
    getByRole(role: string, opts?: {
        name?: string;
    }): LocatorView;
    /** Narrow by visible text content. */
    getByText(text: string): LocatorView;
    /** Narrow by associated label text. */
    getByLabel(text: string): LocatorView;
    /** Narrow by placeholder text. */
    getByPlaceholder(text: string): LocatorView;
    /** Filter by contained text. */
    filter(opts: {
        hasText?: string;
    }): LocatorView;
    /** Select the i-th match (0-based). */
    nth(i: number): LocatorView;
    /** The first match. */
    get first(): LocatorView;
    /** The last match. */
    get last(): LocatorView;
    /** Number of matching elements. */
    count(): Promise<number>;
    /** Inner text of the (single) matched element. */
    innerText(): Promise<string>;
    /** Text content of the (single) matched element, or null. */
    textContent(): Promise<string | null>;
    /** Text content of all matched elements. */
    allTextContents(): Promise<string[]>;
    /** Value of an attribute on the (single) matched element, or null. */
    getAttribute(name: string): Promise<string | null>;
    /** Current input value of the (single) matched element. */
    inputValue(): Promise<string>;
    /** Whether the (single) matched element is visible. */
    isVisible(): Promise<boolean>;
    /** Whether the (single) matched element is enabled. */
    isEnabled(): Promise<boolean>;
    /** Viewport bounding box of the (single) matched element, or null. */
    boundingBox(): Promise<{
        x: number;
        y: number;
        width: number;
        height: number;
    } | null>;
    /** Click the (single) matched element. */
    click(): Promise<{
        evidence: string;
    }>;
    /** Fill an input/textarea with a value. */
    fill(value: string): Promise<{
        evidence: string;
    }>;
    /** Type text character-by-character into an input. */
    type(text: string): Promise<{
        evidence: string;
    }>;
    /** Press a key while focused on the element. */
    press(key: string): Promise<{
        evidence: string;
    }>;
    /** Check a checkbox/radio. */
    check(): Promise<{
        evidence: string;
    }>;
    /** Uncheck a checkbox/radio. */
    uncheck(): Promise<{
        evidence: string;
    }>;
    /** Set checked state explicitly. */
    setChecked(b: boolean): Promise<{
        evidence: string;
    }>;
    /** Select option(s) in a <select>. */
    selectOption(...values: string[]): Promise<{
        evidence: string;
    }>;
    /** Hover over the element. */
    hover(): Promise<{
        evidence: string;
    }>;
    /** Double-click the element. */
    dblclick(): Promise<{
        evidence: string;
    }>;
    /** Scroll the element into view. */
    scroll(): Promise<{
        evidence: string;
    }>;
    /** Focus the element. */
    focus(): Promise<{
        evidence: string;
    }>;
    /** Blur (unfocus) the element. */
    blur(): Promise<{
        evidence: string;
    }>;
    /** Clear an input's value. */
    clear(): Promise<{
        evidence: string;
    }>;
    /** Wait for the element to reach a state. */
    waitFor(state: 'visible' | 'hidden' | 'attached' | 'detached', timeoutMs?: number): Promise<void>;
    /** Screenshot the element; returns { path }. */
    screenshot(): Promise<{
        path: string;
    }>;
}
/** Factory that binds a LocatorView to a backend locator handle. */
export declare function createLocatorFactory(): LocatorFactory;
