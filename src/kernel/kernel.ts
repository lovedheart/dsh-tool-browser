/**
 * Concrete {@link Kernel} — one connected Browser session for one Owner. Ported
 * from QwenPaw's `KernelRuntime`. Runs model code in the sandbox (Browser SDK
 * injected) and projects the outcome into an {@link ExecResult}.
 */

import type { Owner } from '../sdk/contracts.ts';
import type { ExecRequest, ExecResult, Kernel } from './types.ts';
import { Sandbox, type HandoffSignal } from './sandbox.ts';
import { toBrowserError } from '../governance/teaching.ts';
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

    try {
      const { value, stdout, handoff } = await this.sandbox.run(req.code);
      return {
        requestId: req.requestId,
        value,
        stdout,
        ...(handoff ? { handoff } : {}),
      };
    } catch (err) {
      // Propagate governed errors; convert unknown throws via toBrowserError.
      const be = toBrowserError(err);
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
