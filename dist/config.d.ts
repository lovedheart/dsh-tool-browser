/**
 * Plugin config schema (schemastery standard-schema). Validated by Cordis before
 * the plugin starts; values flow into apply(ctx, config). Mirrors the keys
 * declared in cordis.patch.yml.
 *
 * schemastery has no `.enum()`/`.optional()`; enums are `z.union` of `z.const`,
 * optional fields are a union with `z.const(undefined)`.
 */
import z from '@deepseek-ai/schemastery';
export declare const Config: z<Schemastery.ObjectS<{
    /** Register the browser tool. */
    enabled: z<boolean, boolean>;
    /**
     * 'playwright' = managed Chromium; 'chrome' = user's real browser over CDP
     * (needs Chrome launched with --remote-debugging-port); 'chrome-extension' =
     * user's real Chrome driven via the DSH browser extension + Native Messaging
     * (no debug-port flag; needs a one-time extension setup).
     */
    backend: z<"playwright" | "chrome" | "chrome-extension", "playwright" | "chrome" | "chrome-extension">;
    /**
     * Headless launch. 'auto' resolves at connect time: headless inside a
     * container (/.dockerenv) or when no display server is reachable, headed
     * otherwise (mirrors QwenPaw's `headless: auto`). handoff() requires a
     * headed session.
     */
    headless: z<boolean | "auto", boolean | "auto">;
    /** Optional custom browser binary path (playwright backend). */
    executablePath: z<string | undefined, string | undefined>;
    /** For backend=chrome: the user browser's CDP endpoint (e.g. http://127.0.0.1:9222). */
    cdpUrl: z<string | undefined, string | undefined>;
    /**
     * Extra Chromium launch flags (playwright backend), e.g. ['--no-sandbox'].
     * Ignored by the chrome (CDP-attach) backend.
     */
    args: z<string[], string[]>;
    /**
     * Proxy server for the browser, e.g. 'http://127.0.0.1:7890'
     * (playwright backend only; mirrors QwenPaw `proxy`).
     */
    proxy: z<string | undefined, string | undefined>;
    /**
     * Viewport size for new contexts (playwright backend only). When unset,
     * Playwright's default applies.
     */
    viewport: z<({
        width?: number | null | undefined;
        height?: number | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict) | undefined, Schemastery.ObjectT<{
        width: z<number, number>;
        height: z<number, number>;
    }> | undefined>;
    /**
     * Persistent profile dir (playwright backend). When set the session uses
     * `chromium.launchPersistentContext` so cookies/logins survive across
     * restarts; otherwise a fresh ephemeral context is created.
     */
    userDataDir: z<string | undefined, string | undefined>;
    /** Cooperative per-call budget in ms (enforced by dsh-tool-call-timeout-policy). */
    execTimeoutMs: z<number, number>;
    /** Reclaim an idle (unpinned) kernel after this many ms. */
    idleTtlMs: z<number, number>;
    /** Cap on rendered tool output before overflow spill to a workspace file. */
    maxOutputChars: z<number, number>;
    /**
     * chrome-extension backend: auto-close Chrome tabs created by DSH whose
     * owning session is gone when the bridge reconnects. Default false —
     * orphans are only flagged (safer for the user's browsing).
     */
    closeOrphanTabs: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    /** Register the browser tool. */
    enabled: z<boolean, boolean>;
    /**
     * 'playwright' = managed Chromium; 'chrome' = user's real browser over CDP
     * (needs Chrome launched with --remote-debugging-port); 'chrome-extension' =
     * user's real Chrome driven via the DSH browser extension + Native Messaging
     * (no debug-port flag; needs a one-time extension setup).
     */
    backend: z<"playwright" | "chrome" | "chrome-extension", "playwright" | "chrome" | "chrome-extension">;
    /**
     * Headless launch. 'auto' resolves at connect time: headless inside a
     * container (/.dockerenv) or when no display server is reachable, headed
     * otherwise (mirrors QwenPaw's `headless: auto`). handoff() requires a
     * headed session.
     */
    headless: z<boolean | "auto", boolean | "auto">;
    /** Optional custom browser binary path (playwright backend). */
    executablePath: z<string | undefined, string | undefined>;
    /** For backend=chrome: the user browser's CDP endpoint (e.g. http://127.0.0.1:9222). */
    cdpUrl: z<string | undefined, string | undefined>;
    /**
     * Extra Chromium launch flags (playwright backend), e.g. ['--no-sandbox'].
     * Ignored by the chrome (CDP-attach) backend.
     */
    args: z<string[], string[]>;
    /**
     * Proxy server for the browser, e.g. 'http://127.0.0.1:7890'
     * (playwright backend only; mirrors QwenPaw `proxy`).
     */
    proxy: z<string | undefined, string | undefined>;
    /**
     * Viewport size for new contexts (playwright backend only). When unset,
     * Playwright's default applies.
     */
    viewport: z<({
        width?: number | null | undefined;
        height?: number | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict) | undefined, Schemastery.ObjectT<{
        width: z<number, number>;
        height: z<number, number>;
    }> | undefined>;
    /**
     * Persistent profile dir (playwright backend). When set the session uses
     * `chromium.launchPersistentContext` so cookies/logins survive across
     * restarts; otherwise a fresh ephemeral context is created.
     */
    userDataDir: z<string | undefined, string | undefined>;
    /** Cooperative per-call budget in ms (enforced by dsh-tool-call-timeout-policy). */
    execTimeoutMs: z<number, number>;
    /** Reclaim an idle (unpinned) kernel after this many ms. */
    idleTtlMs: z<number, number>;
    /** Cap on rendered tool output before overflow spill to a workspace file. */
    maxOutputChars: z<number, number>;
    /**
     * chrome-extension backend: auto-close Chrome tabs created by DSH whose
     * owning session is gone when the bridge reconnects. Default false —
     * orphans are only flagged (safer for the user's browsing).
     */
    closeOrphanTabs: z<boolean, boolean>;
}>>;
export type BrowserToolConfig = {
    enabled: boolean;
    backend: 'playwright' | 'chrome' | 'chrome-extension';
    /** 'auto' resolves at connect time (container/no-display → headless). */
    headless: boolean | 'auto';
    executablePath?: string;
    cdpUrl?: string;
    args: string[];
    proxy?: string;
    viewport?: {
        width: number;
        height: number;
    };
    userDataDir?: string;
    execTimeoutMs: number;
    idleTtlMs: number;
    maxOutputChars: number;
    closeOrphanTabs: boolean;
};
