/**
 * Owned-Chromium launch helpers for the managed-CDP backend.
 * Ported from QwenPaw `browser/control_link/cdp/launch.py`.
 *
 * The managed Chrome is a plain Chromium launched with `--remote-debugging-port`
 * on a dedicated profile dir; its real listening port (0 = Chrome picks a free
 * one) is discovered by reading Chromium's `DevToolsActivePort` marker file in
 * the profile dir — never by scanning, so parallel launches don't collide.
 */
import { type ChildProcess } from 'node:child_process';
/**
 * Start Chromium with a CDP debugging port on `userDataDir` (mode 0700 — it
 * holds sign-ins). `port = 0` lets Chrome pick a free port; the actual one
 * comes back via {@link waitForDevtoolsActivePort}.
 */
export declare function spawnManagedChromium(opts: {
    executable: string;
    userDataDir: string;
    headless: boolean;
    port: number;
    args: string[];
}): {
    process: ChildProcess;
    staleContent: string | null;
};
/**
 * Wait for Chromium's `DevToolsActivePort` marker and return the browser
 * endpoint (`http://127.0.0.1:<port>`). QwenPaw parity: exit-before-ready is
 * FATAL, timeout is RETRYABLE.
 */
export declare function waitForDevtoolsActivePort(userDataDir: string, process: ChildProcess, opts?: {
    retries?: number;
    delayMs?: number;
    staleContent?: string | null;
}): Promise<string>;
/** Terminate an owned Chrome process group (SIGTERM, then SIGKILL after the
 * grace). Resolves when the direct child exits (or the grace elapses). */
export declare function reapProcess(process: ChildProcess, graceMs?: number): Promise<void>;
