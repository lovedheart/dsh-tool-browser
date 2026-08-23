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
import { BrowserError } from '../governance/errors.ts';
/** Error thrown at SDK boundaries when the run's signal aborts. */
export declare class AbortError extends Error {
    readonly name = "BrowserAbortError";
    constructor(message?: string);
}
/**
 * Reject with an {@link AbortError} when `signal` aborts before `op` settles.
 * The op itself is NOT cancelled — only our wait is — which is exactly what we
 * want: the call returns a teachable error to the model while the Playwright
 * operation may quietly settle in the background.
 */
export declare function raceAbort(op: Promise<unknown>, signal: AbortSignal | undefined): Promise<unknown>;
/**
 * Normalize an AbortError (or any post-abort throw) into the governed wire
 * error the model sees. RETRYABLE category: page state is intact, a shorter
 * follow-up call should succeed.
 */
export declare function abortBrowserError(err: unknown): BrowserError;
