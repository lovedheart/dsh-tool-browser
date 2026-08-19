/**
 * Governed browser error model, ported from QwenPaw's
 * `browser/governance/error_codes.py` + `browser/errors.py`.
 *
 * Every failure surfaced to the model is normalized into a {@link BrowserError}
 * so `output.render` can produce the stable `[category] reason / detail /
 * teaching` text shape. Categories drive both the model-facing teaching and any
 * deployment-level policy (e.g. ASK_HUMAN routes to a handoff prompt).
 */
/** Coarse failure class; stable string values are model-visible in render text. */
export type ErrorCategory = 'RETRYABLE' | 'FATAL' | 'ASK_HUMAN' | 'API_MISUSE' | 'INTERNAL';
/** Fine-grained cause tag for logging/diagnostics (not always model-visible). */
export type ErrorCause = 'bridge_disconnected' | 'api_misuse' | 'navigation_failed' | 'locator_not_found' | 'strict_mode_violation' | 'timeout' | 'headless_handoff' | 'config_invalid' | 'internal';
export interface BrowserErrorFields {
    /** Stable category (see {@link ErrorCategory}). */
    readonly category: ErrorCategory;
    /** One-line human/model-readable reason. */
    readonly reason: string;
    /** Optional extra detail (stack-ish facts, element info). */
    readonly detail?: string;
    /** Concrete suggested next action for the model. */
    readonly suggested_action?: string;
    /** Fine-grained cause tag. */
    readonly cause?: ErrorCause;
}
/**
 * Normalized browser failure. Carries a `.toWire()` projection matching QwenPaw's
 * `ExecResult.error` dict so the kernel/wire layer and the tool render share one
 * shape.
 */
export declare class BrowserError extends Error {
    readonly category: ErrorCategory;
    readonly reason: string;
    readonly detail: string;
    readonly suggested_action: string;
    readonly cause: ErrorCause;
    constructor(fields: BrowserErrorFields);
    /**
     * Project to the wire/kernel error dict (QwenPaw-compatible keys). Values are
     * lossless JSON scalars so the dict satisfies the tool output's JsonValue shape.
     */
    toWire(): Record<string, string>;
}
/** Whether an error reflects a disconnected Chrome/CDP bridge (triggers self-test). */
export declare function isBridgeDisconnected(err: unknown): boolean;
