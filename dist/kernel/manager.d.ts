/**
 * KernelManager — caches one {@link Kernel} per Owner, enforces idle TTL, pins
 * handoff-pending kernels, and tears them down on session/workspace close. Ported
 * from QwenPaw's `BrowserKernelManager`.
 *
 * Backends are brought up lazily on first use: the control link and Browser SDK
 * factory are imported dynamically so the plugin loads even when a backend is not
 * yet installed.
 */
import type { KernelManager } from './types.ts';
/** Configuration for {@link createKernelManager}. */
export interface ManagerConfig {
    readonly backend: 'playwright' | 'chrome';
    readonly headless: boolean;
    readonly executablePath?: string;
    readonly cdpUrl?: string;
    /** Reclaim an idle (unpinned) kernel after this many ms. */
    readonly idleTtlMs: number;
    /** Resolve the workspace dir for screenshots/overflow at connect time. */
    readonly workspaceDir: () => string;
}
/**
 * Create a {@link KernelManager}. Kernels are created lazily per owner and cached.
 */
export declare function createKernelManager(cfg: ManagerConfig): KernelManager;
