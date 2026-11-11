/**
 * KernelManager — caches one {@link Kernel} per Owner, enforces idle TTL, pins
 * handoff-pending kernels, and tears them down on session/workspace close. Ported
 * from QwenPaw's `BrowserKernelManager`.
 *
 * Backends are brought up lazily on first use: the control link and Browser SDK
 * factory are imported dynamically so the plugin loads even when a backend is not
 * yet installed.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserError } from '../governance/errors.ts';
import type { Owner } from '../sdk/contracts.ts';
import type { BrowserHooks } from '../sdk/facade.ts';
import type { ControlLink } from '../backend/ports.ts';
import type { ExecRequest, ExecResult, Kernel, KernelManager } from './types.ts';
import { KernelImpl } from './kernel.ts';
import { Sandbox } from './sandbox.ts';

/**
 * Resolve a config-level `headless` value ('auto' | true | false) to a concrete
 * boolean, mirroring QwenPaw's launch_resolve: headless inside a container
 * (`/.dockerenv`) or when no display server is reachable, headed otherwise.
 */
export function resolveHeadless(value: boolean | 'auto'): boolean {
  if (value !== 'auto') return value;
  if (process.platform !== 'linux') return false; // native desktop → headed
  if (existsSync('/.dockerenv')) return true; // container → headless
  return !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY; // no display server → headless
}

/** Outcome of mapping a requested identity onto a concrete backend choice. */
export interface IdentitySelection {
  readonly backend: 'playwright' | 'chrome' | 'chrome-extension';
  readonly userDataDir?: string;
  /** The concrete identity in effect ('auto' never survives resolution). */
  readonly identity: 'user' | 'avatar' | 'guest';
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
export function resolveIdentitySelection(
  cfg: Pick<ManagerConfig, 'backend' | 'userDataDir'>,
  identity: 'auto' | 'user' | 'avatar' | 'guest' | undefined,
  bridgeConnected: boolean,
  avatarProfileDir: string,
): IdentitySelection {
  switch (identity ?? 'auto') {
    case 'user':
      if (!bridgeConnected) {
        throw new BrowserError({
          category: 'ASK_HUMAN',
          cause: 'bridge_disconnected',
          reason: 'identity "user" needs your real Chrome: connect the DSH browser extension '
            + '(dsh-chrome) — or switch to identity "avatar" (persistent standalone profile) / "guest".',
          suggested_action: 'ask_human',
        });
      }
      return { backend: 'chrome-extension', userDataDir: cfg.userDataDir, identity: 'user' };
    case 'avatar':
      return { backend: 'playwright', userDataDir: cfg.userDataDir ?? avatarProfileDir, identity: 'avatar' };
    case 'guest':
      return { backend: 'playwright', userDataDir: undefined, identity: 'guest' };
    default: // 'auto'
      if (bridgeConnected) return { backend: 'chrome-extension', userDataDir: cfg.userDataDir, identity: 'user' };
      return {
        backend: cfg.backend,
        userDataDir: cfg.userDataDir,
        identity: cfg.backend === 'playwright' ? 'guest' : 'user',
      };
  }
}

/** Per-workspace persistent profile dir for the 'avatar' identity. */
export function avatarProfileDirFor(workspaceId: string): string {
  const safe = workspaceId.replace(/[^A-Za-z0-9._-]+/g, '_');
  return join(homedir(), '.dsh', 'tool-browser', 'avatar', safe);
}

/** Configuration for {@link createKernelManager}. */
export interface ManagerConfig {
  readonly backend: 'playwright' | 'chrome' | 'chrome-extension';
  /**
   * QwenPaw-ported identity layer: 'user' forces the real Chrome, 'avatar' a
   * persistent standalone profile, 'guest' an ephemeral one; 'auto' (default)
   * picks 'user' when the extension bridge is connected and otherwise defers
   * to `backend`.
   */
  readonly identity?: 'auto' | 'user' | 'avatar' | 'guest';
  /** true | false | 'auto' — 'auto' is resolved at connect time. */
  readonly headless: boolean | 'auto';
  readonly executablePath?: string;
  readonly cdpUrl?: string;
  /** Extra Chromium launch flags (playwright backend only). */
  readonly args?: string[];
  /** Proxy server URL (playwright backend only). */
  readonly proxy?: string;
  /** Viewport for new contexts (playwright backend only). */
  readonly viewport?: { width: number; height: number };
  /** Persistent profile dir (playwright backend only). */
  readonly userDataDir?: string;
  /** Reclaim an idle (unpinned) kernel after this many ms. */
  readonly idleTtlMs: number;
  /** Resolve the workspace dir for screenshots/overflow at connect time. */
  readonly workspaceDir: () => string;
}

interface CacheEntry {
  kernel: KernelImpl;
  lastUsed: number;
  pinned: boolean;
}

/** Stable cache key for one owner (workspace + session). */
function ownerKey(owner: Owner): string {
  return `${owner.workspace_id}/${owner.session_id}`;
}

/**
 * Create a {@link KernelManager}. Kernels are created lazily per owner and cached.
 */
export function createKernelManager(cfg: ManagerConfig): KernelManager {
  const cache = new Map<string, CacheEntry>();

  async function get(owner: Owner): Promise<Kernel> {
    const key = ownerKey(owner);
    const existing = cache.get(key);
    if (existing && !existing.kernel.isClosed()) {
      existing.lastUsed = Date.now();
      return existing.kernel;
    }
    if (existing) cache.delete(key); // browser.close() was called: start fresh

    // Lazily import the control link + Browser SDK factory so the plugin can load
    // before those modules are present/installed.
    const { createBrowserFactory } = await import('../sdk/impl/browser.ts');

    // Identity resolution (QwenPaw port): only consult the bridge when it can
    // matter, and degrade gracefully when the bridge module was never mounted
    // (non-web deployments never import it).
    let bridgeConnected = false;
    if ((cfg.identity ?? 'auto') === 'auto' || cfg.identity === 'user') {
      try {
        const m = await import('../backend/ext/bridge.ts');
        bridgeConnected = m.nmBridge.status().connected === true;
      } catch {
        /* bridge not mounted: treat as disconnected */
      }
    }
    const sel = resolveIdentitySelection(cfg, cfg.identity, bridgeConnected, avatarProfileDirFor(owner.workspace_id));

    let link: ControlLink;
    if (sel.backend === 'chrome') {
      link = (await import('../backend/chrome-cdp.ts')).createChromeControlLink();
    } else if (sel.backend === 'chrome-extension') {
      link = (await import('../backend/chrome-extension.ts')).createChromeExtensionControlLink({
        ownerId: owner.session_id,
        workspaceId: owner.workspace_id,
      });
    } else {
      link = (await import('../backend/playwright.ts')).createPlaywrightControlLink();
    }
    const headless = resolveHeadless(cfg.headless);
    const session = await link.connect({
      backend: sel.backend,
      headless,
      executablePath: cfg.executablePath,
      cdpUrl: cfg.cdpUrl,
      args: cfg.args,
      proxy: cfg.proxy,
      viewport: cfg.viewport,
      userDataDir: sel.userDataDir,
      workspaceDir: cfg.workspaceDir(),
    });

    // The browser and sandbox reference each other (sandbox needs the browser
    // for the vm context; the browser reports handoffs to the sandbox). A
    // mutable ref resolves the construction cycle; it is set before any model
    // code can run.
    let sandboxRef: Sandbox | undefined;
    let kernelRef: KernelImpl | undefined;
    const hooks: BrowserHooks = {
      onHandoff: (reason, instructions) => sandboxRef?.recordHandoff(reason, instructions),
      identity: sel.identity,
      onClose: () => kernelRef?.markClosed(),
      owner,
    };
    const browser = createBrowserFactory().create(session, hooks);
    const sandbox = new Sandbox(browser);
    sandboxRef = sandbox;
    const kernel = new KernelImpl(owner, session, sandbox);
    kernelRef = kernel;

    cache.set(key, { kernel, lastUsed: Date.now(), pinned: false });
    return kernel;
  }

  async function execute(
    req: ExecRequest,
    opts?: { pinAfterHandoff?: boolean; signal?: AbortSignal },
  ): Promise<ExecResult> {
    // Reclaim idle kernels first (mirrors QwenPaw BrowserKernelManager.execute).
    await discardIdle();
    const kernel = await get(req.owner);
    const key = ownerKey(req.owner);
    const entry = cache.get(key);
    if (entry) {
      entry.lastUsed = Date.now();
      // A resumed run implies the human handoff step is complete: release the
      // pin so the idle TTL applies again (otherwise a handoff'd session is
      // pinned forever and its browser process leaks).
      if (entry.pinned) {
        entry.pinned = false;
        kernel.unpin();
      }
    }
    // Attach the per-run abort signal (tool timeout / user cancel). An aborted
    // run ends in a governed RETRYABLE error; the kernel + pages survive.
    const result = await kernel.execute({ ...req, signal: opts?.signal });
    // Re-pin only when the caller opts in (headed deployments, where a human
    // genuinely takes over the browser); in headless mode handoff is an error
    // and there is nothing to hold open.
    if (result.handoff && opts?.pinAfterHandoff) {
      const e2 = cache.get(key);
      if (e2) {
        e2.pinned = true;
        kernel.pin();
      }
    }
    return result;
  }

  async function discardIdle(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of [...cache.entries()]) {
      if (!entry.pinned && now - entry.lastUsed > cfg.idleTtlMs) {
        cache.delete(key);
        await entry.kernel.close().catch(() => undefined);
      }
    }
  }

  function pin(owner: Owner): void {
    const entry = cache.get(ownerKey(owner));
    if (entry) {
      entry.pinned = true;
      entry.kernel.pin();
    }
  }

  function unpin(owner: Owner): void {
    const entry = cache.get(ownerKey(owner));
    if (entry) {
      entry.pinned = false;
      entry.kernel.unpin();
    }
  }

  async function closeSession(owner: Owner): Promise<void> {
    const key = ownerKey(owner);
    const entry = cache.get(key);
    if (entry) {
      cache.delete(key);
      await entry.kernel.close().catch(() => undefined);
    }
  }

  async function closeWorkspace(workspaceId: string): Promise<void> {
    const prefix = `${workspaceId}/`;
    for (const [key, entry] of [...cache.entries()]) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
        await entry.kernel.close().catch(() => undefined);
      }
    }
  }

  function discardAllSync(): void {
    for (const [key, entry] of [...cache.entries()]) {
      cache.delete(key);
      // Best-effort synchronous teardown: fire close without awaiting.
      void entry.kernel.close().catch(() => undefined);
    }
  }

  async function dispose(): Promise<void> {
    for (const [key, entry] of [...cache.entries()]) {
      cache.delete(key);
      await entry.kernel.close().catch(() => undefined);
    }
  }

  return { get, execute, discardIdle, pin, unpin, closeSession, closeWorkspace, discardAllSync, dispose };
}
