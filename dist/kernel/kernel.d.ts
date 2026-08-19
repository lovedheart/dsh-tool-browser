/**
 * Concrete {@link Kernel} — one connected Browser session for one Owner. Ported
 * from QwenPaw's `KernelRuntime`. Runs model code in the sandbox (Browser SDK
 * injected) and projects the outcome into an {@link ExecResult}.
 */
import type { Owner } from '../sdk/contracts.ts';
import type { ExecRequest, ExecResult, Kernel } from './types.ts';
import { Sandbox, type HandoffSignal } from './sandbox.ts';
import type { BackendSession } from '../backend/ports.ts';
/**
 * One stateful browser session. Holds the BackendSession + a persistent Sandbox so
 * variables and pages survive across `execute()` calls for the same owner.
 */
export declare class KernelImpl implements Kernel {
    readonly owner: Owner;
    private readonly backendSession;
    private readonly sandbox;
    private pinned;
    private pinnedAt;
    private closed;
    constructor(owner: Owner, backendSession: BackendSession, sandbox: Sandbox);
    /**
     * Execute one program. The sandbox's persistent context already has `Browser`
     * injected, so top-level `browser`/`page` bindings persist across calls.
     */
    execute(req: ExecRequest): Promise<ExecResult>;
    /** Pin against idle reclamation (set while a human owns the browser post-handoff). */
    pin(): void;
    /** Release the pin so idle reclamation may reclaim this kernel. */
    unpin(): void;
    /** Whether this kernel is currently pinned. */
    isPinned(): boolean;
    /** Timestamp of the most recent pin() call, if any. */
    getPinnedAt(): number | undefined;
    /** Close all pages and release the backend session. Idempotent. */
    close(): Promise<void>;
}
export type { HandoffSignal };
