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
 * Stringify a resolved value for the model. undefined → '', strings pass through,
 * objects → JSON, everything else → String(). Circular refs fall back to String().
 */
function stringifyValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Run async JavaScript in a fresh context with the given globals injected.
 * Convenience wrapper around {@link Sandbox} for one-shot use: each printed line is
 * also forwarded to the caller's `print` sink (stdout is captured regardless).
 */
export async function runInSandbox(
  code: string,
  globals: { Browser: unknown; print: (s: string) => void },
): Promise<SandboxRunResult> {
  const sandbox = new Sandbox(globals.Browser);
  // Tee prints into the caller-provided sink for the duration of this run.
  sandbox.setPrintSink((s) => globals.print(s));
  return sandbox.run(code);
}

/**
 * One persistent VM context bound to a single Browser SDK instance. Holds one
 * reusable `vm.Context` so variables persist across runs; resets the stdout buffer
 * per run.
 */
export class Sandbox {
  /** The persistent VM context; exposed for tests/introspection. */
  readonly context: vm.Context;

  private stdoutBuf = '';
  private handoff: HandoffSignal | undefined;
  private printSink: ((s: string) => void) | undefined;

  constructor(browser: unknown) {
    // Build the context with a self-referential `print` that reads the current
    // buffer/sink off the same context object at call time.
    const sandbox = this;
    this.context = vm.createContext({
      Browser: browser,
      print: function (s: unknown): void {
        const line = s === undefined ? '' : String(s);
        sandbox.stdoutBuf += line + '\n';
        if (sandbox.printSink) sandbox.printSink(line);
      },
    });
  }

  /**
   * Record a handoff issued by the Browser SDK during the current run. The
   * kernel wires the Browser instance to this method (per-sandbox), so handoff
   * signals can never leak across concurrently cached sessions.
   */
  recordHandoff(reason: string, instructions: string): void {
    this.handoff = { reason, instructions: instructions ?? '' };
  }

  /** Install an optional per-run stdout sink (used by runInSandbox). */
  setPrintSink(sink: ((s: string) => void) | undefined): void {
    this.printSink = sink;
  }

  /**
   * Execute one program in the persistent context. The body is wrapped in an async
   * IIFE so it can `await` and use a top-level `return`. Top-level assignments still
   * target the persistent context global object, so they persist across runs.
   * Errors propagate to the caller (converted via governance.toBrowserError).
   */
  async run(code: string): Promise<SandboxRunResult> {
    this.stdoutBuf = '';
    this.handoff = undefined;

    const wrapped = `(async () => {\n${code}\n})()`;
    // No vm timeout: the tool layer enforces a cooperative per-call budget.
    const result = await vm.runInContext(wrapped, this.context);

    return {
      value: stringifyValue(result),
      stdout: this.stdoutBuf,
      ...(this.handoff ? { handoff: this.handoff } : {}),
    };
  }
}
