/**
 * Cooperative cancellation for one sandboxed browser run.
 *
 * The host's tool timeoutMs only aborts the dispatch Promise — it cannot kill a
 * busy node:vm thread (review 🔴#1). Instead of destroying the whole session on
 * timeout/abort (old behavior: closeSession → all pages gone, state lost), the
 * SDK now consults the run's signal at its boundaries: when the signal aborts,
 * the in-flight Playwright operation rejects with an {@link AbortError}, the
 * run ends in a governed RETRYABLE error, and the browser session survives for
 * the next call.
 *
 * This mirrors QwenPaw's "kill the worker, keep the browser" semantics under
 * the node:vm constraint (no hard preemption — a synchronous `while(true)` in
 * model code still blocks the main thread; that is the remaining known risk).
 */
import { BrowserError } from "../governance/errors.js";
/** Error thrown at SDK boundaries when the run's signal aborts. */
export class AbortError extends Error {
    name = 'BrowserAbortError';
    constructor(message = 'run aborted (tool timeout or user cancel)') {
        super(message);
    }
}
/**
 * Reject with an {@link AbortError} when `signal` aborts before `op` settles.
 * The op itself is NOT cancelled — only our wait is — which is exactly what we
 * want: the call returns a teachable error to the model while the Playwright
 * operation may quietly settle in the background.
 */
export function raceAbort(op, signal) {
    if (!signal)
        return op;
    if (signal.aborted)
        return Promise.reject(new AbortError());
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            reject(new AbortError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        op.then((value) => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, (err) => {
            signal.removeEventListener('abort', onAbort);
            reject(err);
        });
    });
}
/**
 * Normalize an AbortError (or any post-abort throw) into the governed wire
 * error the model sees. RETRYABLE category: page state is intact, a shorter
 * follow-up call should succeed.
 */
export function abortBrowserError(err) {
    return new BrowserError({
        category: 'RETRYABLE',
        cause: 'timeout',
        reason: err instanceof Error ? err.message : 'run aborted',
        detail: 'The call was cut short by the per-call budget (tool timeout or user cancel).',
        suggested_action: 'Your browser session is still alive — open pages, state, and the `browser`/`page` ' +
            'variables persist. Retry with a smaller step: break the action into a shorter script, ' +
            'or pass an explicit timeoutMs to the wait/locator call.',
    });
}
