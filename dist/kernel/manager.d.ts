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
/**
 * Resolve a config-level `headless` value ('auto' | true | false) to a concrete
 * boolean, mirroring QwenPaw's launch_resolve: headless inside a container
 * (`/.dockerenv`) or when no display server is reachable, headed otherwise.
 */
export declare function resolveHeadless(value: boolean | 'auto'): boolean;
/** Configuration for {@link createKernelManager}. */
export interface ManagerConfig {
    readonly backend: 'playwright' | 'chrome';
    /** true | false | 'auto' — 'auto' is resolved at connect time. */
    readonly headless: boolean | 'auto';
    readonly executablePath?: string;
    readonly cdpUrl?: string;
    /** Extra Chromium launch flags (playwright backend only). */
    readonly args?: string[];
    /** Proxy server URL (playwright backend only). */
    readonly proxy?: string;
    /** Viewport for new contexts (playwright backend only). */
    readonly viewport?: {
        width: number;
        height: number;
    };
    /** Persistent profile dir (playwright backend only). */
    readonly userDataDir?: string;
    /** Reclaim an idle (unpinned) kernel after this many ms. */
    readonly idleTtlMs: number;
    /** Resolve the workspace dir for screenshots/overflow at connect time. */
    readonly workspaceDir: () => string;
}
/**
 * Create a {@link KernelManager}. Kernels are created lazily per owner and cached.
 */
export declare function createKernelManager(cfg: ManagerConfig): KernelManager;
