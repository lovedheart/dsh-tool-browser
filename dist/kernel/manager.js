/**
 * KernelManager — caches one {@link Kernel} per Owner, enforces idle TTL, pins
 * handoff-pending kernels, and tears them down on session/workspace close. Ported
 * from QwenPaw's `BrowserKernelManager`.
 *
 * Backends are brought up lazily on first use: the control link and Browser SDK
 * factory are imported dynamically so the plugin loads even when a backend is not
 * yet installed.
 */
import { KernelImpl } from "./kernel.js";
import { Sandbox } from "./sandbox.js";
/** Stable cache key for one owner (workspace + session). */
function ownerKey(owner) {
    return `${owner.workspace_id}/${owner.session_id}`;
}
/**
 * Create a {@link KernelManager}. Kernels are created lazily per owner and cached.
 */
export function createKernelManager(cfg) {
    const cache = new Map();
    async function get(owner) {
        const key = ownerKey(owner);
        const existing = cache.get(key);
        if (existing) {
            existing.lastUsed = Date.now();
            return existing.kernel;
        }
        // Lazily import the control link + Browser SDK factory so the plugin can load
        // before those modules are present/installed.
        const { createBrowserFactory } = await import("../sdk/impl/browser.js");
        const link = cfg.backend === 'chrome'
            ? (await import("../backend/chrome-cdp.js")).createChromeControlLink()
            : (await import("../backend/playwright.js")).createPlaywrightControlLink();
        const session = await link.connect({
            backend: cfg.backend,
            headless: cfg.headless,
            executablePath: cfg.executablePath,
            cdpUrl: cfg.cdpUrl,
            identity: 'auto',
            workspaceDir: cfg.workspaceDir(),
        });
        // The browser and sandbox reference each other (sandbox needs the browser
        // for the vm context; the browser reports handoffs to the sandbox). A
        // mutable ref resolves the construction cycle; it is set before any model
        // code can run.
        let sandboxRef;
        const hooks = {
            onHandoff: (reason, instructions) => sandboxRef?.recordHandoff(reason, instructions),
            owner,
        };
        const browser = createBrowserFactory().create(session, hooks);
        const sandbox = new Sandbox(browser);
        sandboxRef = sandbox;
        const kernel = new KernelImpl(owner, session, sandbox);
        cache.set(key, { kernel, lastUsed: Date.now(), pinned: false });
        return kernel;
    }
    async function execute(req, opts) {
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
        const result = await kernel.execute(req);
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
    async function discardIdle() {
        const now = Date.now();
        for (const [key, entry] of [...cache.entries()]) {
            if (!entry.pinned && now - entry.lastUsed > cfg.idleTtlMs) {
                cache.delete(key);
                await entry.kernel.close().catch(() => undefined);
            }
        }
    }
    function pin(owner) {
        const entry = cache.get(ownerKey(owner));
        if (entry) {
            entry.pinned = true;
            entry.kernel.pin();
        }
    }
    function unpin(owner) {
        const entry = cache.get(ownerKey(owner));
        if (entry) {
            entry.pinned = false;
            entry.kernel.unpin();
        }
    }
    async function closeSession(owner) {
        const key = ownerKey(owner);
        const entry = cache.get(key);
        if (entry) {
            cache.delete(key);
            await entry.kernel.close().catch(() => undefined);
        }
    }
    async function closeWorkspace(workspaceId) {
        const prefix = `${workspaceId}/`;
        for (const [key, entry] of [...cache.entries()]) {
            if (key.startsWith(prefix)) {
                cache.delete(key);
                await entry.kernel.close().catch(() => undefined);
            }
        }
    }
    function discardAllSync() {
        for (const [key, entry] of [...cache.entries()]) {
            cache.delete(key);
            // Best-effort synchronous teardown: fire close without awaiting.
            void entry.kernel.close().catch(() => undefined);
        }
    }
    async function dispose() {
        for (const [key, entry] of [...cache.entries()]) {
            cache.delete(key);
            await entry.kernel.close().catch(() => undefined);
        }
    }
    return { get, execute, discardIdle, pin, unpin, closeSession, closeWorkspace, discardAllSync, dispose };
}
