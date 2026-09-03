/**
 * Concrete {@link Kernel} — one connected Browser session for one Owner. Ported
 * from QwenPaw's `KernelRuntime`. Runs model code in the sandbox (Browser SDK
 * injected) and projects the outcome into an {@link ExecResult}.
 */

import type { Owner } from '../sdk/contracts.ts';
import type { ExecRequest, ExecResult, Kernel } from './types.ts';
import { Sandbox, type HandoffSignal, type SandboxRunResult } from './sandbox.ts';
import { toBrowserError } from '../governance/teaching.ts';
import { AbortError, abortBrowserError, raceAbort } from './run-control.ts';
import type { BackendSession } from '../backend/ports.ts';

/**
 * One stateful browser session. Holds the BackendSession + a persistent Sandbox so
 * variables and pages survive across `execute()` calls for the same owner.
 */
export class KernelImpl implements Kernel {
  readonly owner: Owner;

  private readonly backendSession: BackendSession;
  private readonly sandbox: Sandbox;
  private pinned = false;
  private pinnedAt: number | undefined;
  private closed = false;

  constructor(owner: Owner, backendSession: BackendSession, sandbox: Sandbox) {
    this.owner = owner;
    this.backendSession = backendSession;
    this.sandbox = sandbox;
  }

  /**
   * Execute one program. The sandbox's persistent context already has `Browser`
   * injected, so top-level `browser`/`page` bindings persist across calls.
   */
  async execute(req: ExecRequest): Promise<ExecResult> {
    if (this.closed) {
      return {
        requestId: req.requestId,
        value: '',
        stdout: '',
        error: toBrowserError(
          new Error('kernel closed'),
        ).toWire(),
      };
    }

    // Already aborted when the run starts (e.g. the host cancelled the turn
    // before dispatch reached us): do not execute the code at all — running
    // a cancelled turn's script would only add side effects after the fact.
    if (req.signal?.aborted) {
      return {
        requestId: req.requestId,
        value: '',
        stdout: '',
        error: abortBrowserError(new AbortError()).toWire(),
      };
    }

    try {
      // Run-level race: even if the model awaits something the SDK does not
      // instrument, the budget abort ends the run promptly. The session is
      // NEVER closed here — abort ends the run, not the browser (QwenPaw's
      // "kill the worker, keep the browser" under the node:vm constraint).
      //
      // The inner sandbox promise outlives the race on abort (the vm script
      // cannot be hard-killed; it ends at the next SDK boundary). Attach a
      // no-op catch so its late rejection is never an unhandled rejection;
      // the race is what surfaces the error to the caller.
      const inner = this.sandbox.run(req.code, req.signal);
      inner.catch(() => {
        /* absorbed: raceAbort is the surface that reports this */
      });
      const { value, stdout, handoff } = (await raceAbort(
        inner,
        req.signal,
      )) as SandboxRunResult;
      return {
        requestId: req.requestId,
        value,
        stdout,
        ...(handoff ? { handoff } : {}),
      };
    } catch (err) {
      // AbortError → governed RETRYABLE timeout teaching; other throws keep
      // the existing governance path.
      const be = err instanceof Error && err.name === 'BrowserAbortError'
        ? abortBrowserError(err)
        : toBrowserError(err);
      return {
        requestId: req.requestId,
        value: '',
        stdout: '',
        error: be.toWire(),
      };
    }
  }

  /** Pin against idle reclamation (set while a human owns the browser post-handoff). */
  pin(): void {
    this.pinned = true;
    this.pinnedAt = Date.now();
  }

  /** Release the pin so idle reclamation may reclaim this kernel. */
  unpin(): void {
    this.pinned = false;
    this.pinnedAt = undefined;
  }

  /** Whether this kernel is currently pinned. */
  isPinned(): boolean {
    return this.pinned;
  }

  /** Whether close() was called (manager then evicts and re-creates). */
  isClosed(): boolean {
    return this.closed;
  }

  /** Mark closed without re-tearing the session (facade browser.close() path). */
  markClosed(): void {
    this.closed = true;
  }

  /** Timestamp of the most recent pin() call, if any. */
  getPinnedAt(): number | undefined {
    return this.pinnedAt;
  }

  /** Close all pages and release the backend session. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.backendSession.close();
    } catch {
      // Best-effort teardown; ignore close failures at shutdown.
    }
  }
}

export type { HandoffSignal };
