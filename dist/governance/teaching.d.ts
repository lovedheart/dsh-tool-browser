/**
 * Teaching-style error rendering, ported from QwenPaw's worker helpers
 * (`_api_misuse_teaching`, `_name_error_teaching`, `render_error_text`).
 *
 * The goal: when the model's browser code fails, the returned text teaches the
 * correct API shape rather than just dumping a stack. Pure functions over an
 * {@link BrowserError} (or unknown throw) + optional stdout.
 */
import { BrowserError } from './errors.ts';
/** Render a governed error into stable model-facing text. */
export declare function renderErrorText(error: BrowserError, stdout?: string): string;
/** Map a raw thrown value to a governed {@link BrowserError}. */
export declare function toBrowserError(err: unknown): BrowserError;
/**
 * Locator-failure "ladder" guidance (QwenPaw `_BLOCK_LADDER`): step down one rung,
 * don't jump. Returned when a semantic locator fails so the model degrades
 * predictably.
 */
export declare function locatorLadderTeaching(): string;
