/**
 * Governed browser error model, ported from QwenPaw's
 * `browser/governance/error_codes.py` + `browser/errors.py`.
 *
 * Every failure surfaced to the model is normalized into a {@link BrowserError}
 * so `output.render` can produce the stable `[category] reason / detail /
 * teaching` text shape. Categories drive both the model-facing teaching and any
 * deployment-level policy (e.g. ASK_HUMAN routes to a handoff prompt).
 */
/**
 * Normalized browser failure. Carries a `.toWire()` projection matching QwenPaw's
 * `ExecResult.error` dict so the kernel/wire layer and the tool render share one
 * shape.
 */
export class BrowserError extends Error {
    category;
    reason;
    detail;
    suggested_action;
    cause;
    constructor(fields) {
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
    toWire() {
        const out = {
            category: this.category,
            cause: this.cause,
            reason: this.reason,
        };
        if (this.detail)
            out.detail = this.detail;
        if (this.suggested_action)
            out.teaching = this.suggested_action;
        return out;
    }
}
/** Whether an error reflects a disconnected Chrome/CDP bridge (triggers self-test). */
export function isBridgeDisconnected(err) {
    return err instanceof BrowserError && err.cause === 'bridge_disconnected';
}
