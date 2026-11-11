/**
 * Managed-CDP backend for the ControlLink port — the `managed` identity
 * (QwenPaw `browser/engine: managed_cdp` parity).
 *
 * This is the middle persona between `avatar` and `user`:
 *   - a dedicated, plugin-OWNED Chrome profile dir (sign-ins survive across
 *     sessions, like `avatar`), but
 *   - driven over raw CDP (`connectOverCDP`) instead of Playwright's owned
 *     launch, so a per-session `close()` disconnects the client without
 *     killing the browser (QwenPaw: "a CDP-attached browser is the user's —
 *     never kill it on session close").
 *   - an explicit `release()` (workspace/session teardown, plugin dispose)
 *     reaps the owned Chrome when no sessions remain on it.
 *
 * Ported pieces: launch/DevToolsActivePort discovery (`launch.py`), per-owner
 * session/page maps + incognito browser contexts (`adapter.py`), connect-time
 * headless detection via `Browser.getVersion`.
 */
import { chromium } from 'playwright';
import { BrowserError } from "../governance/errors.js";
import { PlaywrightPage } from "./page-wrappers.js";
import { managedChromiumReady } from "./managed-chromium.js";
import { spawnManagedChromium, waitForDevtoolsActivePort, reapProcess, } from "./managed-cdp-launch.js";
const pool = new Map();
const launches = new Map();
export function __managedPoolSize() {
    return pool.size;
}
async function acquire(opts, key) {
    const existing = pool.get(key);
    if (existing) {
        // Crash recovery (QwenPaw restart parity): an owned Chrome that has
        // already exited must not poison the next connect — drop the dead entry
        // and relaunch. An attach-only entry (no process) is always "alive".
        const dead = existing.process &&
            (existing.process.exitCode !== null || existing.process.signalCode !== null);
        if (!dead)
            return existing;
        pool.delete(key);
        if (existing.process)
            await reapProcess(existing.process);
    }
    const inflight = launches.get(key);
    if (inflight)
        return inflight;
    const launch = (async () => {
        if (opts.cdpUrl) {
            // Attach-only mode: caller-provided endpoint, we do NOT own a process.
            return { process: null, endpoint: opts.cdpUrl, holders: new Set() };
        }
        const executable = opts.executablePath ?? (await resolveChromiumPath());
        const { process, staleContent } = spawnManagedChromium({
            executable,
            userDataDir: opts.userDataDir,
            headless: opts.headless,
            port: opts.managedCdpPort ?? 0, // 0: Chrome picks a free port; DevToolsActivePort reports it
            args: managedArgs(opts),
        });
        let endpoint;
        try {
            endpoint = await waitForDevtoolsActivePort(opts.userDataDir, process, { staleContent });
        }
        catch (err) {
            reapProcess(process);
            throw err;
        }
        return { process, endpoint, holders: new Set() };
    })();
    launches.set(key, launch);
    try {
        const entry = await launch;
        pool.set(key, entry);
        return entry;
    }
    finally {
        launches.delete(key);
    }
}
/** Drop one holder; reap the owned Chrome when the endpoint goes unused. */
async function releaseHolder(key, holderId) {
    const entry = pool.get(key);
    if (!entry)
        return;
    entry.holders.delete(holderId);
    if (entry.holders.size > 0)
        return;
    pool.delete(key);
    // Each holder owns its own CDP connection (QwenPaw per-owner transport), so
    // there is no shared client to disconnect here — only the process, once the
    // last holder is gone.
    if (entry.process)
        await reapProcess(entry.process);
}
/** Extra flags for a standalone managed Chrome (never inherit the user's). */
function managedArgs(opts) {
    const args = [...(opts.args ?? [])];
    if (opts.proxy && !args.some((a) => a.startsWith('--proxy-server'))) {
        args.push(`--proxy-server=${opts.proxy}`);
    }
    return args;
}
/**
 * Executable for the managed Chrome: driver-matched Playwright Chromium when
 * its cache is on disk, else a system browser from PATH (Google Chrome →
 * Chromium), else a RETRYABLE pointing at the background installer (QwenPaw
 * discovery-hierarchy parity, minus the Windows registry probe).
 */
async function resolveChromiumPath() {
    if (managedChromiumReady()) {
        const { chromium: pw } = await import('playwright');
        return pw.executablePath();
    }
    const { existsSync } = await import('node:fs');
    const { delimiter } = await import('node:path');
    for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
        for (const dir of (process.env.PATH ?? '').split(delimiter)) {
            const candidate = `${dir}/${bin}`;
            if (dir && existsSync(candidate))
                return candidate;
        }
    }
    throw new BrowserError({
        category: 'RETRYABLE',
        cause: 'timeout',
        reason: 'No Chromium executable found for the managed backend.',
        suggested_action: 'Wait a moment for the background Chromium install, then retry Browser.connect().',
    });
}
/** Derive the pool key: which profile/endpoint a session belongs to. */
function poolKey(opts) {
    return opts.cdpUrl ?? opts.userDataDir ?? 'managed-default';
}
class ManagedSession {
    browser;
    opts;
    key;
    holderId;
    versionedHeadless;
    variant = 'managed';
    pageMap = new Map();
    nextPageNum = 1;
    context;
    constructor(browser, context, opts, key, holderId, versionedHeadless) {
        this.browser = browser;
        this.opts = opts;
        this.key = key;
        this.holderId = holderId;
        this.versionedHeadless = versionedHeadless;
        this.context = context;
    }
    async openPage(url) {
        let record;
        for (const rec of this.pageMap.values()) {
            if (rec.active) {
                record = rec;
                break;
            }
        }
        if (!record) {
            const page = await this.context.newPage();
            const id = `page-${this.nextPageNum++}`;
            record = { page, active: true };
            this.pageMap.set(id, record);
        }
        else {
            record.active = true;
        }
        if (url)
            await record.page.goto(url);
        return new PlaywrightPage(record.page, this.activeId(), this.opts.workspaceDir);
    }
    async presentPage(url) {
        const page = await this.context.newPage();
        const id = `page-${this.nextPageNum++}`;
        for (const rec of this.pageMap.values())
            rec.active = false;
        this.pageMap.set(id, { page, active: true });
        if (url)
            await page.goto(url);
        return new PlaywrightPage(page, id, this.opts.workspaceDir);
    }
    async pages() {
        const refs = [];
        for (const [id, rec] of this.pageMap) {
            refs.push({ id, url: rec.page.url(), title: await rec.page.title(), active: rec.active });
        }
        return refs;
    }
    async switchPage(pageId) {
        for (const [id, rec] of this.pageMap)
            rec.active = id === pageId;
    }
    async closePage(pageId) {
        const rec = this.pageMap.get(pageId);
        if (rec) {
            await rec.page.close();
            this.pageMap.delete(pageId);
        }
    }
    /** From Browser.getVersion at connect time (QwenPaw connect_cdp parity). */
    isHeadless() {
        return this.versionedHeadless;
    }
    /**
     * Close THIS session: its tabs, then disconnect the CDP client. The
     * managed Chrome process stays alive for the next session (same sign-ins)
     * unless this was the last holder of the profile.
     */
    async close() {
        for (const rec of [...this.pageMap.values()]) {
            await rec.page.close().catch(() => undefined);
        }
        this.pageMap.clear();
        await releaseHolder(this.key, this.holderId);
    }
    activeId() {
        for (const [id, rec] of this.pageMap) {
            if (rec.active)
                return id;
        }
        return '';
    }
}
/**
 * Create a managed-CDP ControlLink: launches/attaches a standalone Chrome on
 * a persistent profile and drives it over CDP.
 *
 * `opts.userDataDir` (set by the manager for identity `managed`) selects the
 * pool key; `opts.cdpUrl` switches to attach-only mode on an existing
 * endpoint. The returned link's `release()` reaps every Chrome this link
 * launched but no longer holds.
 */
export function createManagedControlLink(holderId) {
    // Session ids minted by this link instance, for release() bookkeeping.
    const heldKeys = new Set();
    return {
        async connect(opts) {
            if (!opts.userDataDir && !opts.cdpUrl) {
                throw new BrowserError({
                    category: 'FATAL',
                    cause: 'config_invalid',
                    reason: 'managed backend needs userDataDir (persistent profile) or cdpUrl',
                    suggested_action: 'Set userDataDir in the tool config or use identity: avatar.',
                });
            }
            const key = poolKey(opts);
            const entry = await acquire(opts, key);
            entry.holders.add(holderId);
            heldKeys.add(key);
            // Per-session CDP connection: one holder closing must not drag other
            // sessions' pages down with it (shared-browser pitfall).
            let browser;
            try {
                browser = await chromium.connectOverCDP({ endpointURL: entry.endpoint });
                // QwenPaw connect_cdp parity: detect headless from the CDP endpoint's
                // own facts rather than trusting our launch flag (the endpoint may
                // predate this session in attach-only mode). Chrome 151's /json/version
                // has no headless flag and its `Browser` field omits the "Headless"
                // prefix, so check the User-Agent token first and fall back to the
                // linked Browser.getVersion product string.
                const facts = await fetch(`${entry.endpoint}/json/version`)
                    .then((res) => (res.ok ? res.json() : {}))
                    .then((data) => data['User-Agent'] ?? '')
                    .catch(() => '');
                let headless = facts.includes('HeadlessChrome');
                if (!headless) {
                    // Fallback: a fresh page's navigator.ua still carries the token.
                    headless = await browser
                        .newPage()
                        .then(async (probe) => {
                        const ua = await probe.evaluate(() => navigator.userAgent).catch(() => '');
                        await probe.close().catch(() => undefined);
                        return typeof ua === 'string' && ua.includes('HeadlessChrome');
                    })
                        .catch(() => false);
                }
                const context = browser.contexts()[0] ?? (await browser.newContext({ viewport: opts.viewport }));
                return new ManagedSession(browser, context, opts, key, holderId, headless);
            }
            catch (err) {
                entry.holders.delete(holderId);
                heldKeys.delete(key);
                throw err;
            }
        },
        /** Manager eviction hook: reap everything this link instance started. */
        async release() {
            for (const key of heldKeys) {
                await releaseHolder(key, holderId);
            }
            heldKeys.clear();
        },
    };
}
