/**
 * Plugin config schema (schemastery standard-schema). Validated by Cordis before
 * the plugin starts; values flow into apply(ctx, config). Mirrors the keys
 * declared in cordis.patch.yml.
 *
 * schemastery has no `.enum()`/`.optional()`; enums are `z.union` of `z.const`,
 * optional fields are a union with `z.const(undefined)`.
 */
import z from '@deepseek-ai/schemastery';
const backendEnum = z.union([
    z.const('playwright'),
    z.const('chrome'),
    z.const('chrome-extension'),
]);
const optionalString = z.union([z.string(), z.const(undefined)]);
/** String list, e.g. extra Chromium launch flags (mirrors QwenPaw `args`). */
const stringList = z.array(z.string());
/** Viewport dimensions (mirrors QwenPaw `viewport = {width, height}`). */
const viewportShape = z.object({ width: z.number(), height: z.number() });
const optionalViewport = z.union([viewportShape, z.const(undefined)]);
/** Headless launch; 'auto' = headless in containers or when no display server is found. */
const headlessEnum = z.union([z.const(true), z.const(false), z.const('auto')]);
export const Config = z.object({
    /** Register the browser tool. */
    enabled: z.boolean().default(true),
    /**
     * 'playwright' = managed Chromium; 'chrome' = user's real browser over CDP
     * (needs Chrome launched with --remote-debugging-port); 'chrome-extension' =
     * user's real Chrome driven via the DSH browser extension + Native Messaging
     * (no debug-port flag; needs a one-time extension setup).
     */
    backend: backendEnum.default('playwright'),
    /**
     * Headless launch. 'auto' resolves at connect time: headless inside a
     * container (/.dockerenv) or when no display server is reachable, headed
     * otherwise (mirrors QwenPaw's `headless: auto`). handoff() requires a
     * headed session.
     */
    headless: headlessEnum.default(true),
    /** Optional custom browser binary path (playwright backend). */
    executablePath: optionalString,
    /** For backend=chrome: the user browser's CDP endpoint (e.g. http://127.0.0.1:9222). */
    cdpUrl: optionalString,
    /**
     * Extra Chromium launch flags (playwright backend), e.g. ['--no-sandbox'].
     * Ignored by the chrome (CDP-attach) backend.
     */
    args: stringList.default([]),
    /**
     * Proxy server for the browser, e.g. 'http://127.0.0.1:7890'
     * (playwright backend only; mirrors QwenPaw `proxy`).
     */
    proxy: optionalString,
    /**
     * Viewport size for new contexts (playwright backend only). When unset,
     * Playwright's default applies.
     */
    viewport: optionalViewport,
    /**
     * Persistent profile dir (playwright backend). When set the session uses
     * `chromium.launchPersistentContext` so cookies/logins survive across
     * restarts; otherwise a fresh ephemeral context is created.
     */
    userDataDir: optionalString,
    /** Cooperative per-call budget in ms (enforced by dsh-tool-call-timeout-policy). */
    execTimeoutMs: z.number().default(120_000),
    /** Reclaim an idle (unpinned) kernel after this many ms. */
    idleTtlMs: z.number().default(600_000),
    /** Cap on rendered tool output before overflow spill to a workspace file. */
    maxOutputChars: z.number().default(100_000),
});
