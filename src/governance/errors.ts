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
export type ErrorCategory =
  | 'RETRYABLE' // transient: bridge dropped, page navigated away, timeout — retry may succeed
  | 'FATAL' // not recoverable in-session: bad config, missing backend
  | 'ASK_HUMAN' // needs a human: captcha/login/2FA, or handoff attempted headless
  | 'API_MISUSE' // the model called the SDK wrong (surfaced with teaching)
  | 'INTERNAL'; // unexpected plugin defect

/** Fine-grained cause tag for logging/diagnostics (not always model-visible). */
export type ErrorCause =
  | 'bridge_disconnected'
  | 'api_misuse'
  | 'navigation_failed'
  | 'locator_not_found'
  | 'strict_mode_violation'
  | 'timeout'
  | 'state_stale' // a page/tab/session handle no longer exists (QwenPaw parity)
  | 'headless_handoff'
  | 'config_invalid'
  | 'internal';

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
export class BrowserError extends Error {
  readonly category: ErrorCategory;
  readonly reason: string;
  readonly detail: string;
  readonly suggested_action: string;
  readonly cause: ErrorCause;

  constructor(fields: BrowserErrorFields) {
    super(fields.reason);
    this.name = 'BrowserError';
    this.category = fields.category;
    this.reason = fields.reason;
    this.detail = fields.detail ?? '';
    this.suggested_action = fields.suggested_action ?? '';
    this.cause = fields.cause ?? 'internal';
  }

  /**
   * Project to the wire/kernel error dict (QwenPaw-compatible keys). Values are
   * lossless JSON scalars so the dict satisfies the tool output's JsonValue shape.
   */
  toWire(): Record<string, string> {
    const out: Record<string, string> = {
      category: this.category,
      cause: this.cause,
      reason: this.reason,
    };
    if (this.detail) out.detail = this.detail;
    if (this.suggested_action) out.teaching = this.suggested_action;
    return out;
  }
}

/** Whether an error reflects a disconnected Chrome/CDP bridge (triggers self-test). */
export function isBridgeDisconnected(err: unknown): boolean {
  return err instanceof BrowserError && err.cause === 'bridge_disconnected';
}
