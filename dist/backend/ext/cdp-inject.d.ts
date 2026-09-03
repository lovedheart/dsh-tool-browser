/**
 * Page-side injection engine for the CDP-over-Chrome-extension backend.
 *
 * Ported concept from QwenPaw cdp_verbs.py; implemented DOM-side for DSH.
 *
 * The extension backend has no Playwright objects inside the page: every
 * locator operation must be translated into a self-contained snippet of
 * JavaScript evaluated in the page context via
 * `Runtime.evaluate({ returnByValue: true, awaitPromise: true })`. This module
 * compiles a declarative {@link LocatorSpec} into such snippets and provides
 * the per-verb ACT / READ fragments that run against the resolved element(s).
 *
 * Host composition shape (chrome-extension.ts):
 *   `(function(){ const el = <buildLocatorExpression(spec)>;
 *      if (!el) throw Error('LOCATOR_NOT_FOUND');
 *      return (<ACT fragment>)(el); })()`
 * with `awaitPromise: true` (fragments may return a Promise, e.g. waitFor).
 *
 * Conventions:
 *   - {@link buildLocatorExpression} evaluates to a single Element or null
 *     (first match; multi-match ambiguity is tolerated, not thrown, matching
 *     the lenient behavior of the Playwright wrapper, and recorded on
 *     `globalThis.__dshAmbiguousLocator` for diagnostics);
 *   - {@link buildLocatorListExpression} evaluates to an Element[] — used by
 *     count/allTextContents reads;
 *   - every action/read fragment returns `JSON.stringify(payload)`, so the
 *     host can uniformly JSON.parse the evaluation result;
 *   - a missing element throws `Error` whose message contains the fixed
 *     marker {@link LOCATOR_NOT_FOUND}; the host maps that marker to a
 *     governed `BrowserError` (category RETRYABLE, cause `locator_not_found`).
 *
 * The generated code has no external dependencies: plain DOM APIs plus a
 * small ARIA-heuristic table (implicit roles + accessible names).
 */
import type { LocatorSpec } from '../ports.ts';
/** Fixed marker in thrown messages so the host can map to a governed error. */
export declare const LOCATOR_NOT_FOUND = "LOCATOR_NOT_FOUND";
/** Fixed marker for in-page waits that gave up. */
export declare const LOCATOR_TIMEOUT = "LOCATOR_TIMEOUT";
/**
 * Build an IIFE snippet evaluating to a single Element or `null` (first
 * match; ambiguity tolerated and recorded, matching the Playwright wrapper's
 * lenient behavior). `base` is reserved for a future frame-scope prefix and
 * is currently ignored.
 */
export declare function buildLocatorExpression(spec: LocatorSpec, base?: string): string;
/** Build an IIFE snippet evaluating to an Element[] (possibly empty). */
export declare function buildLocatorListExpression(spec: LocatorSpec): string;
/**
 * Action fragments. Zero-arg verbs are plain function-string constants;
 * parameterized verbs are functions returning a function string with the
 * argument inlined as a literal. Each fragment is a `(el) => ...` expression
 * whose result is `JSON.stringify({ ok, evidence })` (or a Promise thereof,
 * for waitFor — the host evaluates with awaitPromise: true).
 */
export declare const ACT: {
    click: string;
    dblclick: string;
    hover: string;
    scroll: string;
    focus: string;
    blur: string;
    clear: string;
    fill: (value: string) => string;
    type: (text: string) => string;
    press: (key: string) => string;
    check: string;
    uncheck: string;
    setChecked: (b: boolean) => string;
    selectOption: (values: string[]) => string;
    waitFor: (state?: "visible" | "hidden" | "attached" | "detached", timeoutMs?: number) => string;
};
/**
 * Read fragments. Each is a `(el) => ...` fragment returning
 * `JSON.stringify(value)`; count/allTextContents/isVisible/isEnabled/
 * boundingBox accept a single element, an element array, or null.
 */
export declare const READ: {
    count: string;
    allTextContents: string;
    innerText: string;
    textContent: string;
    getAttribute: (name: string) => string;
    inputValue: string;
    isVisible: string;
    isEnabled: string;
    boundingBox: string;
};
/**
 * Compose a locator spec with an {@link ACT} verb into one host-shaped
 * expression: resolves the first matching element (throwing a
 * LOCATOR_NOT_FOUND-marked Error on a miss) and runs the action fragment with
 * `(el)`. Parameterized ACT entries take `arg` and bake it into the fragment.
 */
export declare function buildActionExpression(spec: LocatorSpec, verb: string, arg?: unknown): string;
/**
 * Compose a locator spec with a {@link READ} verb into one JSON expression.
 * count/allTextContents receive the full element list; all other reads get
 * the first element (arrays tolerated by every read fragment).
 */
export declare function buildReadExpression(spec: LocatorSpec, verb: string, arg?: unknown): string;
