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
/** Outcome of mapping a requested identity onto a concrete backend choice. */
export interface IdentitySelection {
    readonly backend: 'playwright' | 'chrome' | 'chrome-extension' | 'managed';
    readonly userDataDir?: string;
    /** The concrete identity in effect ('auto' never survives resolution). */
    readonly identity: 'user' | 'avatar' | 'guest' | 'managed';
    /** identity 'managed': debug port for the owned Chrome (0 = auto). */
    readonly managedCdpPort?: number;
}
/**
 * Maps QwenPaw's identity model onto this plugin's backends (ported from
 * QwenPaw `browser.identity`):
 *   user   -> the real Chrome via the extension bridge (needs it connected);
 *   avatar -> standalone browser on a persistent profile dir (sign-ins survive);
 *   guest  -> standalone incognito (no profile dir);
 *   auto   -> 'user' when the bridge is connected, otherwise the configured
 *             backend stands ('chrome'/'chrome-extension' imply user; 'playwright'
 *             implies guest) — fully backward-compatible with pre-identity configs.
 * Pure function (bridge state passed in) so tests don't need a browser.
 */
export declare function resolveIdentitySelection(cfg: Pick<ManagerConfig, 'backend' | 'userDataDir'>, identity: 'auto' | 'user' | 'avatar' | 'guest' | 'managed' | undefined, bridgeConnected: boolean, avatarProfileDir: string): IdentitySelection;
/** Per-workspace persistent profile dir for the 'avatar' identity. */
export declare function avatarProfileDirFor(workspaceId: string): string;
/** Per-workspace persistent profile dir for the 'managed' identity
 * (QwenPaw managed_cdp's `~/.qwenpaw/browser/cdp/chrome-profile` analogue). */
export declare function managedProfileDirFor(workspaceId: string): string;
/** Configuration for {@link createKernelManager}. */
export interface ManagerConfig {
    readonly backend: 'playwright' | 'chrome' | 'chrome-extension' | 'managed';
    /**
     * QwenPaw-ported identity layer: 'user' forces the real Chrome, 'avatar' a
     * persistent standalone profile, 'guest' an ephemeral one; 'auto' (default)
     * picks 'user' when the extension bridge is connected and otherwise defers
     * to `backend`.
     */
    readonly identity?: 'auto' | 'user' | 'avatar' | 'guest' | 'managed';
    /** identity 'managed': debug port for the owned Chrome (0 = Chrome picks one). */
    readonly managedCdpPort?: number;
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
