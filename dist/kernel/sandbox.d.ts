/**
 * In-process sandbox for the model's async JavaScript. Ported from QwenPaw's
 * worker that runs `browser(code)` with the Browser SDK injected as a global.
 *
 * Statefulness comes from a single persistent `vm.Context` per Sandbox: top-level
 * `var`/assignments land on the context global object, so `browser`, `page`, etc.
 * survive across successive `run()` calls (the QwenPaw "stateful session" feel).
 * The persistent Kernel (kernel.ts) holds the BackendSession + Browser, so the
 * browser itself stays connected between calls. We deliberately use node:vm (not
 * worker_threads) to keep execution in-process.
 */
import vm from 'node:vm';
/** A pending handoff recorded when the model calls `browser.handoff(...)`. */
export interface HandoffSignal {
    readonly reason: string;
    readonly instructions: string;
}
/** Result of one sandbox run. */
export interface SandboxRunResult {
    /** The resolved value, stringified for the model ('' when undefined). */
    value: string;
    /** Captured stdout from print(). */
    stdout: string;
    /** Present when the model called browser.handoff() during this run. */
    handoff?: HandoffSignal;
}
/**
 * Run async JavaScript in a fresh context with the given globals injected.
 * Convenience wrapper around {@link Sandbox} for one-shot use: each printed line is
 * also forwarded to the caller's `print` sink (stdout is captured regardless).
 */
export declare function runInSandbox(code: string, globals: {
    Browser: unknown;
    print: (s: string) => void;
}): Promise<SandboxRunResult>;
/**
 * One persistent VM context bound to a single Browser SDK instance. Holds one
 * reusable `vm.Context` so variables persist across runs; resets the stdout buffer
 * per run.
 */
export declare class Sandbox {
    /** The persistent VM context; exposed for tests/introspection. */
    readonly context: vm.Context;
    private stdoutBuf;
    private handoff;
    private printSink;
    constructor(browser: unknown);
    /**
     * Record a handoff issued by the Browser SDK during the current run. The
     * kernel wires the Browser instance to this method (per-sandbox), so handoff
     * signals can never leak across concurrently cached sessions.
     */
    recordHandoff(reason: string, instructions: string): void;
    /** Install an optional per-run stdout sink (used by runInSandbox). */
    setPrintSink(sink: ((s: string) => void) | undefined): void;
    /**
     * Execute one program in the persistent context. The body is wrapped in an async
     * IIFE so it can `await` and use a top-level `return`. Top-level assignments still
     * target the persistent context global object, so they persist across runs.
     * Errors propagate to the caller (converted via governance.toBrowserError).
     *
     * When `signal` is provided it is published as the current run signal for the
     * duration of the run so SDK/backend operations can observe it cooperatively
     * (see `run-context.ts`); on abort the run ends in a governed error and the
     * session survives.
     */
    run(code: string, signal?: AbortSignal): Promise<SandboxRunResult>;
}
