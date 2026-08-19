/**
 * Playwright backend for the ControlLink port.
 *
 * Manages a Chromium browser instance via the `playwright` npm package and
 * exposes it through the {@link BackendSession} / {@link BackendPage} /
 * {@link BackendLocator} interfaces defined in `ports.ts`.
 *
 * The shared {@link PlaywrightPage} and {@link PlaywrightLocator} wrappers that
 * translate Playwright's `Page` / `Locator` into the port types live in
 * `./page-wrappers.ts` and are shared with the CDP backend (`chrome-cdp.ts`).
 * This file keeps only the Playwright-specific session + factory.
 */
import type { ControlLink } from './ports.ts';
/**
 * Create a Playwright-backed ControlLink.
 *
 * Launches managed Chromium via the `playwright` npm package.
 * If `opts.backend === 'chrome'`, still launches managed Chromium here —
 * the CDP-based Chrome backend is a separate implementation.
 */
export declare function createPlaywrightControlLink(): ControlLink;
