/**
 * Plugin config schema (schemastery standard-schema). Validated by Cordis before
 * the plugin starts; values flow into apply(ctx, config). Mirrors the keys
 * declared in cordis.patch.yml.
 *
 * schemastery has no `.enum()`/`.optional()`; enums are `z.union` of `z.const`,
 * optional fields are a union with `z.const(undefined)`.
 */
import z from '@deepseek-ai/schemastery';

const backendEnum = z.union([z.const('playwright'), z.const('chrome')]);
const optionalString = z.union([z.string(), z.const(undefined)]);

export const Config = z.object({
  /** Register the browser tool. */
  enabled: z.boolean().default(true),
  /** 'playwright' = managed Chromium; 'chrome' = user's real browser over CDP. */
  backend: backendEnum.default('playwright'),
  /** Headless launch. handoff() requires headed (false). */
  headless: z.boolean().default(true),
  /** Optional custom browser binary path (playwright backend). */
  executablePath: optionalString,
  /** For backend=chrome: the user browser's CDP endpoint (e.g. http://127.0.0.1:9222). */
  cdpUrl: optionalString,
  /** Cooperative per-call budget in ms (enforced by dsh-tool-call-timeout-policy). */
  execTimeoutMs: z.number().default(120_000),
  /** Reclaim an idle (unpinned) kernel after this many ms. */
  idleTtlMs: z.number().default(600_000),
  /** Cap on rendered tool output before overflow spill to a workspace file. */
  maxOutputChars: z.number().default(100_000),
});

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
