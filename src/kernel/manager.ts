/**
 * KernelManager — caches one {@link Kernel} per Owner, enforces idle TTL, pins
 * handoff-pending kernels, and tears them down on session/workspace close. Ported
 * from QwenPaw's `BrowserKernelManager`.
 *
 * Backends are brought up lazily on first use: the control link and Browser SDK
 * factory are imported dynamically so the plugin loads even when a backend is not
 * yet installed.
 */

import type { Owner } from '../sdk/contracts.ts';
import type { ExecRequest, ExecResult, Kernel, KernelManager } from './types.ts';
import { KernelImpl } from './kernel.ts';
import { Sandbox } from './sandbox.ts';

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
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.kernel;
    }

    // Lazily import the control link + Browser SDK factory so the plugin can load
    // before those modules are present/installed.
    const { createBrowserFactory } = await import('../sdk/impl/browser.ts');

    const link = cfg.backend === 'chrome'
      ? (await import('../backend/chrome-cdp.ts')).createChromeControlLink()
      : (await import('../backend/playwright.ts')).createPlaywrightControlLink();
    const session = await link.connect({
      backend: cfg.backend,
      headless: cfg.headless,
      executablePath: cfg.executablePath,
      cdpUrl: cfg.cdpUrl,
      identity: 'auto',
      workspaceDir: cfg.workspaceDir(),
    });

    const browser = createBrowserFactory().create(session);
    const sandbox = new Sandbox(browser);
    const kernel = new KernelImpl(owner, session, sandbox);

    cache.set(key, { kernel, lastUsed: Date.now(), pinned: false });
    return kernel;
  }

  async function execute(req: ExecRequest): Promise<ExecResult> {
    // Reclaim idle kernels first (mirrors QwenPaw BrowserKernelManager.execute).
    await discardIdle();
    const kernel = await get(req.owner);
    const entry = cache.get(ownerKey(req.owner));
    if (entry) entry.lastUsed = Date.now();
    return kernel.execute(req);
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
