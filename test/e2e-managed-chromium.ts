/**
 * Managed-Chromium gate + CDP discovery checks (no downloads, no network).
 * Ports QwenPaw `test_playwright_adapter_gate.py` / `test_managed_playwright.py`
 * semantics for the TS port; run via
 * `node --import tsx test/e2e-managed-chromium.ts`.
 */
import assert from 'node:assert/strict';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  ensureManagedChromium,
  managedChromiumReady,
  IN_FLIGHT_RETRY_SECONDS,
  __setReadyOverride,
  __setCliPathOverride,
  __resetManagedChromiumState,
} from '../src/backend/managed-chromium.ts';
import { discoverCdpUrl, fetchCdpVersion } from '../src/backend/cdp-discovery.ts';
import { createPlaywrightControlLink } from '../src/backend/playwright.ts';
import { BrowserError } from '../src/governance/errors.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'tool-browser-mc-'));

// -- ready path: the real driver's Chromium is on disk in this dev env ------
assert.equal(managedChromiumReady(), true, 'dev env should have driver-matched chromium');
assert.deepEqual(await ensureManagedChromium(), [true, '', 0]);

// -- failure path: installer command blows up -> detail + cooldown -----------
const failScript = path.join(dir, 'fail.sh');
writeFileSync(failScript, '#!/bin/sh\necho boom >&2\nexit 3\n');
execSync(`chmod +x ${failScript}`);
__resetManagedChromiumState();
__setReadyOverride(() => false);
__setCliPathOverride(failScript);
let [ready, detail, retry] = await ensureManagedChromium();
assert.equal(ready, false);
assert.match(detail, /download failed/);
assert.match(detail, /boom/);
assert.ok(retry >= 1, `retry after failure: ${retry}`);
assert.ok(retry <= 60);
// second call inside the cooldown: no new spawn, same diagnostic
[ready, detail, retry] = await ensureManagedChromium();
assert.equal(ready, false);
assert.match(detail, /boom/);

// -- success path: installer "succeeds" and the cache appears ----------------
const okScript = path.join(dir, 'ok.sh');
writeFileSync(okScript, '#!/bin/sh\nexit 0\n');
execSync(`chmod +x ${okScript}`);
__resetManagedChromiumState();
let fakeReady = false;
__setCliPathOverride(okScript);
__setReadyOverride(() => fakeReady);
[ready] = await ensureManagedChromium();
if (!ready) {
  await new Promise((r) => setTimeout(r, 100)); // let the stub exit
  fakeReady = true;
}
assert.deepEqual(await ensureManagedChromium(), [true, '', 0], 'ready after successful install');

// -- connect() gate: missing binary -> RETRYABLE with retry guidance ---------
__resetManagedChromiumState();
fakeReady = false;
const link = createPlaywrightControlLink();
await assert.rejects(
  link.connect({ headless: true, workspaceDir: dir } as never),
  (err: unknown) => {
    assert.ok(err instanceof BrowserError, `expected BrowserError, got ${err}`);
    assert.equal(err.category, 'RETRYABLE');
    assert.match(err.suggested_action, /retry Browser\.connect\(\)/);
    return true;
  },
);
// an explicit executablePath bypasses the gate (QwenPaw parity): with ready
// forced false, the gate's error would say "Managed Playwright Chromium" —
// the launch ENOENT must surface instead.
await assert.rejects(
  link.connect({ headless: true, workspaceDir: dir, executablePath: '/nonexistent/chrome' } as never),
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    assert.ok(!/is downloading in the background/.test(msg), 'gate must not run for explicit binary');
    return true;
  },
);
__setReadyOverride(null);
__setCliPathOverride(null);
__resetManagedChromiumState();

// -- CDP discovery ------------------------------------------------------------
const exe = chromium.executablePath();
const port = 9333; // outside the default 9222-9232 window
const proc: ChildProcess = spawn(
  exe,
  [`--remote-debugging-port=${port}`, '--headless=new', '--no-sandbox', '--no-first-run', 'about:blank'],
  { stdio: 'ignore' },
);
try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    await new Promise((r) => setTimeout(r, 250));
    version = await fetchCdpVersion(port);
  }
  assert.ok(version, 'chrome should serve /json/version');
  assert.match(version!.webSocketDebuggerUrl!, /ws:\/\//);
  // a quiet range finds nothing
  assert.equal(await discoverCdpUrl(9534, 9536), null);
  // a range including the live port finds it
  assert.equal(await discoverCdpUrl(port, port), `http://127.0.0.1:${port}`);
} finally {
  proc.kill();
  await new Promise((r) => proc.once('exit', r));
}
// endpoint gone -> probe returns null again
assert.equal(await fetchCdpVersion(port), null);
void IN_FLIGHT_RETRY_SECONDS;

console.log('e2e-managed-chromium: ALL PASS');
