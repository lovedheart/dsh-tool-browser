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
    /** 'playwright' = managed Chromium; 'chrome' = user's real browser over CDP. */
    backend: z<"playwright" | "chrome", "playwright" | "chrome">;
    /** Headless launch. handoff() requires headed (false). */
    headless: z<boolean, boolean>;
    /** Optional custom browser binary path (playwright backend). */
    executablePath: z<string | undefined, string | undefined>;
    /** For backend=chrome: the user browser's CDP endpoint (e.g. http://127.0.0.1:9222). */
    cdpUrl: z<string | undefined, string | undefined>;
    /** Cooperative per-call budget in ms (enforced by dsh-tool-call-timeout-policy). */
    execTimeoutMs: z<number, number>;
    /** Reclaim an idle (unpinned) kernel after this many ms. */
    idleTtlMs: z<number, number>;
    /** Cap on rendered tool output before overflow spill to a workspace file. */
    maxOutputChars: z<number, number>;
}>, Schemastery.ObjectT<{
    /** Register the browser tool. */
    enabled: z<boolean, boolean>;
    /** 'playwright' = managed Chromium; 'chrome' = user's real browser over CDP. */
    backend: z<"playwright" | "chrome", "playwright" | "chrome">;
    /** Headless launch. handoff() requires headed (false). */
    headless: z<boolean, boolean>;
    /** Optional custom browser binary path (playwright backend). */
    executablePath: z<string | undefined, string | undefined>;
    /** For backend=chrome: the user browser's CDP endpoint (e.g. http://127.0.0.1:9222). */
    cdpUrl: z<string | undefined, string | undefined>;
    /** Cooperative per-call budget in ms (enforced by dsh-tool-call-timeout-policy). */
    execTimeoutMs: z<number, number>;
    /** Reclaim an idle (unpinned) kernel after this many ms. */
    idleTtlMs: z<number, number>;
    /** Cap on rendered tool output before overflow spill to a workspace file. */
    maxOutputChars: z<number, number>;
}>>;
export type BrowserToolConfig = {
    enabled: boolean;
    backend: 'playwright' | 'chrome';
    headless: boolean;
    executablePath?: string;
    cdpUrl?: string;
    execTimeoutMs: number;
    idleTtlMs: number;
    maxOutputChars: number;
};
