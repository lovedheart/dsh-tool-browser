/**
 * Lazy, off-the-critical-path provisioning of the Playwright-managed Chromium.
 * Ported from QwenPaw `browser/runtime/managed_playwright.py` (commit
 * "move managed Chromium install off startup critical path").
 *
 * Problem it solves: when the plugin's `playwright` package is newer than the
 * browser cache (e.g. after a dependency bump), `chromium.launch()` dies with
 * "Executable doesn't exist ... chromium_headless_shell-XXXX" — a dead end for
 * the model. Instead we detect the missing binary BEFORE launching, kick off a
 * one-shot background `playwright install chromium`, and raise a RETRYABLE
 * error that tells the model exactly how long to wait before retrying
 * `Browser.connect()`.
 *
 * Module-level state (single install task per process, like QwenPaw):
 *   - `installDone`      in-flight dedupe flag for the one-shot install
 *   - `installProcess`   the live installer child (alive-check after a crash)
 *   - `lastError`        last installer diagnostic, surfaced on the next retry
 *   - `lastFailureAt`    drives the failure cooldown
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
/** Seconds to wait before retrying after a failed install attempt. */
export const FAILURE_COOLDOWN_SECONDS = 60;
/** Seconds to report while an install is in flight (poll interval). */
export const IN_FLIGHT_RETRY_SECONDS = 15;
/** Kill the installer if it runs longer than this. */
const INSTALL_TIMEOUT_MS = 600_000;
let installDone = true;
let installProcess = null;
let lastError = '';
let lastFailureAt = 0;
/** Test hook: force the "cache ready" answer (null = real filesystem check). */
let readyOverride = null;
export function __setReadyOverride(fn) {
    readyOverride = fn;
}
/** Test hook: replace the installer command (e.g. a fake installer script). */
let cliPathOverride = null;
export function __setCliPathOverride(p) {
    cliPathOverride = p;
}
/** Test hook: clear in-flight/cooldown state between scenarios. */
export function __resetManagedChromiumState() {
    installDone = true;
    installProcess = null;
    lastError = '';
    lastFailureAt = 0;
}
/**
 * Whether the current Playwright driver's exact Chromium build is on disk.
 * `executablePath()` only computes the expected path, so also stat it.
 */
export function managedChromiumReady() {
    if (readyOverride)
        return readyOverride();
    try {
        return existsSync(chromium.executablePath());
    }
    catch {
        return false;
    }
}
/** Resolve `node_modules/playwright/cli.js` for the installed driver. */
function playwrightCliPath() {
    if (cliPathOverride)
        return cliPathOverride;
    const pkgJson = require.resolve('playwright/package.json');
    return path.join(path.dirname(pkgJson), 'cli.js');
}
/** Trim installer output to its tail, like QwenPaw's _trim_output. */
function trimOutput(text) {
    const t = text.trim();
    return t.length > 4000 ? t.slice(-4000) : t;
}
function stopInstallProcess(p) {
    if (p.exitCode !== null || p.signalCode !== null)
        return;
    try {
        p.kill('SIGTERM');
        setTimeout(() => {
            try {
                if (p.exitCode === null && p.signalCode === null)
                    p.kill('SIGKILL');
            }
            catch {
                /* already gone */
            }
        }, 5_000).unref();
    }
    catch {
        /* already gone */
    }
}
/** Run one `playwright install chromium` (or the fake installer in tests). */
async function downloadChromium() {
    const cli = playwrightCliPath();
    // A .js path is the real driver CLI (run via node); anything else is a test
    // stub — run it through the shell so a plain script path works unchanged.
    const child = cli.endsWith('.js')
        ? spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn(cli, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    installProcess = child;
    let output = '';
    child.stdout?.on('data', (d) => (output += d));
    child.stderr?.on('data', (d) => (output += d));
    const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            stopInstallProcess(child);
            reject(new Error('Playwright Chromium download timed out'));
        }, INSTALL_TIMEOUT_MS);
        timer.unref();
        child.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.once('close', (c) => {
            clearTimeout(timer);
            resolve(c);
        });
    }).finally(() => {
        if (installProcess === child)
            installProcess = null;
    });
    if (code !== 0) {
        const detail = trimOutput(output);
        throw new Error('Playwright Chromium download failed' + (detail ? `: ${detail}` : ''));
    }
    if (!managedChromiumReady()) {
        throw new Error('Playwright Chromium download did not create its cache');
    }
}
async function downloadAndRecord() {
    try {
        await downloadChromium();
        lastError = '';
        lastFailureAt = 0;
    }
    catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        lastFailureAt = Date.now();
    }
    finally {
        installDone = true;
    }
}
function cooldownRemaining() {
    if (!lastFailureAt)
        return 0;
    return Math.max(0, FAILURE_COOLDOWN_SECONDS - (Date.now() - lastFailureAt) / 1000);
}
function installProcessAlive() {
    const p = installProcess;
    if (!p)
        return false;
    if (p.exitCode !== null || p.signalCode !== null) {
        installProcess = null;
        return false;
    }
    return true;
}
/**
 * Ensure one background Chromium install is running; return immediately.
 * Mirrors QwenPaw `ensure_managed_chromium()`: `[ready, detail, retryAfter]`.
 * When not ready, `retryAfter` is the seconds the caller should wait
 * (short poll while in flight, remaining cooldown after a failure).
 */
export async function ensureManagedChromium() {
    if (managedChromiumReady())
        return [true, '', 0];
    if (!installDone)
        return [false, '', IN_FLIGHT_RETRY_SECONDS];
    if (installProcessAlive()) {
        return [false, lastError || 'previous install process still running', IN_FLIGHT_RETRY_SECONDS];
    }
    const cooling = cooldownRemaining();
    if (cooling > 0) {
        return [false, lastError || 'install failed', Math.max(1, Math.ceil(cooling))];
    }
    installDone = false;
    const task = downloadAndRecord();
    // Give the spawn / immediate-failure path a moment to settle before we
    // report, so a broken installer surfaces its error on THIS call.
    await Promise.race([task, new Promise((r) => setTimeout(r, 25))]);
    if (managedChromiumReady())
        return [true, '', 0];
    if (!installDone)
        return [false, '', IN_FLIGHT_RETRY_SECONDS];
    if (lastFailureAt) {
        return [false, lastError || 'install failed', Math.max(1, Math.ceil(cooldownRemaining()))];
    }
    return [false, '', 1];
}
