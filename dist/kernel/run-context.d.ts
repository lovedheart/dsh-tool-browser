/**
 * Per-run execution context shared between the sandbox (writer) and the browser
 * backend (reader).
 *
 * The kernel runs model code in a persistent node:vm context; the SDK and the
 * Playwright backend are plain in-process objects created outside that context.
 * To let an in-flight Playwright operation observe the run's abort signal
 * (tool timeout / user cancel) without threading a parameter through the entire
 * model-facing API, the sandbox publishes the current run's signal here while a
 * run is active. This is a single-threaded, per-process seam: runs on different
 * cached sessions are serialized by the tool layer (isConcurrencySafe=false),
 * and a signal only aborts its OWN run — at worst another run's op rejects with
 * a transient RETRYABLE error, never a wrong-browser action.
 */
/** Signal of the currently executing sandbox run (undefined outside a run). */
export declare function currentRunSignal(): AbortSignal | undefined;
/** Install/clear the signal for the duration of one sandbox run. */
export declare function setCurrentRunSignal(signal: AbortSignal | undefined): void;
