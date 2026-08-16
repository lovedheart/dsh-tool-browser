/**
 * Kernel contracts — the stateful execution core. Ported from QwenPaw's
 * `browser/execution/kernel.py` (KernelRuntime / BrowserKernelManager) and the
 * wire ExecRequest/ExecResult shapes.
 *
 * A {@link Kernel} is one connected Browser session for one Owner
 * (workspace+session). The {@link KernelManager} caches kernels per Owner,
 * enforces idle TTL, pins handoff-pending kernels, and tears them down on
 * session/workspace close. The model's `code` runs inside a Kernel via the
 * sandbox, so variables/pages persist across `browser(code)` calls.
 */

import type { Owner } from '../sdk/contracts.ts';

/** One browser program submitted by the model. */
export interface ExecRequest {
  readonly requestId: string;
  /** Module-level async JavaScript; may `return` a value or `print()`. */
  readonly code: string;
  readonly owner: Owner;
}

/** Outcome of one exec, mirroring QwenPaw ExecResult. */
export interface ExecResult {
  readonly requestId: string;
  /** The returned value, stringified for the model (or '' ). */
  readonly value: string;
  /** Captured stdout from print(). */
  readonly stdout: string;
  /** Governed error dict (BrowserError.toWire()) on failure, else undefined. */
  readonly error?: Record<string, string>;
  /** Handoff signal { reason, instructions } when browser.handoff() was called. */
  readonly handoff?: { reason: string; instructions: string };
}

/**
 * One stateful browser session. Runs model code with the Browser SDK in scope.
 * Implementations live in the worker/sandbox; this is the contract the tool sees.
 */
export interface Kernel {
  readonly owner: Owner;
  /** Execute one program; the SDK global `Browser` is pre-injected. */
  execute(req: ExecRequest): Promise<ExecResult>;
  /** Pin against idle reclamation (set while a human owns the browser post-handoff). */
  pin(): void;
  unpin(): void;
  /** Close all pages and release the backend session. */
  close(): Promise<void>;
}

/** Lifecycle manager caching Kernels per Owner. */
export interface KernelManager {
  /** Get-or-create the kernel for an owner (spawns backend on first use). */
  get(owner: Owner): Promise<Kernel>;
  /**
   * Execute one program. A resumed run on a pinned (handoff-pending) kernel
   * unpins it; if `opts.pinAfterHandoff` is set and this run ends in a handoff,
   * the kernel is re-pinned against idle reclamation.
   */
  execute(req: ExecRequest, opts?: { pinAfterHandoff?: boolean }): Promise<ExecResult>;
  /** Reclaim idle (unpinned) kernels older than idleTtlMs. */
  discardIdle(): Promise<void>;
  pin(owner: Owner): void;
  unpin(owner: Owner): void;
  /** Close one session's kernel (chat archived/deleted). */
  closeSession(owner: Owner): Promise<void>;
  /** Close every kernel for a workspace. */
  closeWorkspace(workspaceId: string): Promise<void>;
  /** Synchronous teardown at process exit. */
  discardAllSync(): void;
  dispose(): Promise<void>;
}
