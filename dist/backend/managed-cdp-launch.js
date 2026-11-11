/**
 * Owned-Chromium launch helpers for the managed-CDP backend.
 * Ported from QwenPaw `browser/control_link/cdp/launch.py`.
 *
 * The managed Chrome is a plain Chromium launched with `--remote-debugging-port`
 * on a dedicated profile dir; its real listening port (0 = Chrome picks a free
 * one) is discovered by reading Chromium's `DevToolsActivePort` marker file in
 * the profile dir — never by scanning, so parallel launches don't collide.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserError } from "../governance/errors.js";
/** Remove the endpoint marker a previous owned child left behind. Returns its
 * stale content when the file is locked (kept so we can detect the NEW write
 * as a content change instead of mistaking the old one for readiness). */
function clearStaleMarker(marker) {
    try {
        rmSync(marker, { force: true });
        return null;
    }
    catch {
        let stale;
        try {
            stale = readFileSync(marker, 'utf8');
        }
        catch (readErr) {
            throw new BrowserError({
                category: 'FATAL',
                cause: 'config_invalid',
                reason: 'DevToolsActivePort is locked and cannot be read',
                detail: String(readErr),
                suggested_action: 'Close the other Chromium using this profile or use a different userDataDir.',
            });
        }
        return stale;
    }
}
/**
 * Start Chromium with a CDP debugging port on `userDataDir` (mode 0700 — it
 * holds sign-ins). `port = 0` lets Chrome pick a free port; the actual one
 * comes back via {@link waitForDevtoolsActivePort}.
 */
export function spawnManagedChromium(opts) {
    mkdirSync(opts.userDataDir, { recursive: true, mode: 0o700 });
    try {
        chmodSync(opts.userDataDir, 0o700);
    }
    catch {
        /* best-effort: a pre-existing dir may be owned differently */
    }
    const staleContent = clearStaleMarker(join(opts.userDataDir, 'DevToolsActivePort'));
    const proc = spawn(opts.executable, [
        `--remote-debugging-port=${opts.port}`,
        `--user-data-dir=${opts.userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...(opts.headless ? ['--headless=new'] : []),
        ...opts.args,
    ], { stdio: 'ignore', detached: true });
    // Detached: the Chrome must outlive tool-call teardown and be reaped
    // explicitly (process.kill on the group). Ignore the now-harmless SIGPIPE.
    proc.on('error', () => undefined);
    return { process: proc, staleContent };
}
/**
 * Wait for Chromium's `DevToolsActivePort` marker and return the browser
 * endpoint (`http://127.0.0.1:<port>`). QwenPaw parity: exit-before-ready is
 * FATAL, timeout is RETRYABLE.
 */
export async function waitForDevtoolsActivePort(userDataDir, process, opts = {}) {
    const retries = opts.retries ?? 100;
    const delay = opts.delayMs ?? 100;
    const marker = join(userDataDir, 'DevToolsActivePort');
    for (let i = 0; i < retries; i++) {
        if (process.exitCode !== null || process.signalCode !== null) {
            throw new BrowserError({
                category: 'FATAL',
                cause: 'internal',
                reason: 'chromium exited before CDP was ready',
                suggested_action: 'Check the executablePath / profile dir, or fall back to backend: playwright.',
            });
        }
        let content = null;
        try {
            content = readFileSync(marker, 'utf8');
        }
        catch {
            content = null; // in-flight write or not yet created
        }
        if (content !== null && content !== opts.staleContent) {
            const lines = content.split('\n').filter((l) => l.trim() !== '');
            if (lines.length >= 1) {
                const port = parseInt(lines[0], 10);
                if (Number.isFinite(port) && port > 0)
                    return `http://127.0.0.1:${port}`;
            }
        }
        await new Promise((r) => setTimeout(r, delay));
    }
    throw new BrowserError({
        category: 'RETRYABLE',
        cause: 'timeout',
        reason: 'CDP endpoint did not become ready',
        suggested_action: 'Retry Browser.connect() shortly, or check for a stale lock on the profile dir.',
    });
}
/** Terminate an owned Chrome process group (SIGTERM, then SIGKILL after the
 * grace). Resolves when the direct child exits (or the grace elapses). */
export function reapProcess(process, graceMs = 5_000) {
    if (process.exitCode !== null || process.signalCode !== null)
        return Promise.resolve();
    const exited = new Promise((resolve) => process.once('exit', () => resolve()));
    const signal = (sig) => {
        try {
            // Negative pid = process group (the Chrome was spawned detached).
            // Chrome is spawned detached and becomes its own process-group leader,
            // so signal the whole group (negative pid) via the top-level process.kill
            // (the ChildProcess handle's .kill() takes no pid argument). Fall back to
            // a direct signal if the group is already gone.
            if (process.pid) {
                try {
                    process.kill(-process.pid, sig);
                    return;
                }
                catch {
                    /* group gone; signal the child directly below */
                }
            }
            process.kill(sig);
        }
        catch {
            /* already gone */
        }
    };
    signal('SIGTERM');
    return Promise.race([
        exited,
        new Promise((resolve) => {
            const t = setTimeout(() => {
                signal('SIGKILL');
                // Keep waiting for the exit event after the kill, but bounded.
                Promise.race([exited, new Promise((r2) => setTimeout(r2, 2_000).unref())]).then(resolve);
            }, graceMs);
            t.unref();
        }),
    ]);
}
