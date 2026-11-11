/**
 * P11 managed-CDP backend checks: identity resolution + a real owned-Chromium
 * lifecycle (launch via DevToolsActivePort, drive, survive session close,
 * release kills). Run: npx tsx test/e2e-managed-cdp.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveIdentitySelection, managedProfileDirFor } from '../src/kernel/manager.ts';
import { createManagedControlLink, __managedPoolSize } from '../src/backend/managed-cdp.ts';
import { spawnManagedChromium, waitForDevtoolsActivePort, reapProcess } from '../src/backend/managed-cdp-launch.ts';
import { BrowserError } from '../src/governance/errors.ts';
import { chromium } from 'playwright';

const dir = mkdtempSync(join(tmpdir(), 'tool-browser-mcdp-'));

// -- identity resolution ------------------------------------------------------
assert.deepEqual(
  resolveIdentitySelection({ backend: 'playwright' }, 'managed', false, '/avatar'),
  { backend: 'managed', userDataDir: undefined, identity: 'managed' },
);
assert.equal(
  resolveIdentitySelection({ backend: 'playwright', userDataDir: '/mine' }, 'managed', false, '/avatar').userDataDir,
  '/mine',
);
assert.match(managedProfileDirFor('ws/1 x'), /.*[\/\\]\.dsh[\/\\]tool-browser[\/\\]managed[\/\\]ws_1_x$/);

// -- launch helper: DevToolsActivePort discovery, port=0 -----------------------
const exe = chromium.executablePath();
const profile = join(dir, 'profile');
const { process: proc, staleContent } = spawnManagedChromium({
  executable: exe,
  userDataDir: profile,
  headless: true,
  port: 0,
  args: ['--no-sandbox'],
});
try {
  const endpoint = await waitForDevtoolsActivePort(profile, proc, { staleContent });
  assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
  const version = (await fetch(`${endpoint}/json/version`).then((r) => r.json())) as { Browser?: string; webSocketDebuggerUrl?: string; [k: string]: unknown };
  assert.match(String(version['User-Agent'] ?? ''), /HeadlessChrome/);
  assert.ok(version.webSocketDebuggerUrl);
} finally {
  await reapProcess(proc);
}
// process died before ready -> FATAL
const { process: dead, staleContent: deadStale } = spawnManagedChromium({
  executable: '/nonexistent/chrome',
  userDataDir: join(dir, 'p2'),
  headless: true,
  port: 0,
  args: ['--no-sandbox'],
});
await assert.rejects(
  waitForDevtoolsActivePort(join(dir, 'p2'), dead, { retries: 3, delayMs: 50, staleContent: deadStale }),
  (err: unknown) => err instanceof BrowserError && err.category === 'FATAL',
);

// -- full ControlLink lifecycle -------------------------------------------------
const userDataDir = join(dir, 'link-profile');
const opts = { backend: 'managed' as const, headless: true, userDataDir, workspaceDir: dir, managedCdpPort: 0, args: ['--no-sandbox'] };
const link = createManagedControlLink('owner-1');
const session = await link.connect(opts);
// Launched via DevToolsActivePort (port 0), NOT a fixed port; marker exists.
assert.ok(existsSync(join(userDataDir, 'DevToolsActivePort')));
const ep = `http://127.0.0.1:${readFileSync(join(userDataDir, 'DevToolsActivePort'), 'utf8').split('\n')[0]}`;
const page = await session.openPage('about:blank');
assert.ok(typeof (await page.snapshot()).text === 'string');
assert.equal(session.isHeadless(), true, 'headless detected via endpoint facts');

// Two holders on the same profile (QwenPaw ref-counting): they share ONE owned
// Chrome; closing a non-last holder must not disturb the other.
const linkB = createManagedControlLink('owner-1b');
const session2 = await linkB.connect(opts); // pool reuse: no second Chrome
assert.equal(__managedPoolSize(), 1, 'one pool entry shared by both holders');
await session2.presentPage('about:blank');
await session.close();                      // first (non-last) holder leaves
const aliveA = await fetch(new URL('/json/version', ep), { signal: AbortSignal.timeout(500) }).then((r) => r.ok).catch(() => false);
assert.equal(aliveA, true, 'owned Chrome survives a non-last holder closing');
await session2.presentPage('about:blank');  // session2 still fully usable
await linkB.release?.();                    // last holder -> reaps the Chrome
assert.equal(__managedPoolSize(), 0, 'last holder release reaps entry');
const aliveB = await fetch(new URL('/json/version', ep), { signal: AbortSignal.timeout(500) }).then((r) => r.ok).catch(() => false);
assert.equal(aliveB, false, 'reaped Chrome stops answering CDP');

// -- release() reaps the owned Chrome process ------------------------------------
const link3 = createManagedControlLink('owner-3');
const s3 = await link3.connect({ ...opts, userDataDir: join(dir, 'p3'), args: ['--no-sandbox'] });
await s3.openPage('about:blank');
const entryPid = readFileSync(join(dir, 'p3', 'DevToolsActivePort'), 'utf8'); // sanity: launched
assert.ok(entryPid.trim());
await link3.release?.();
// After release the profile's Chrome must be gone (release awaits reap).
let alive = false;
try {
  // Best-effort probe: the endpoint should now refuse connections.
  const port = parseInt(entryPid.split('\n')[0], 10);
  const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(300) });
  alive = res.ok;
} catch {
  alive = false;
}
assert.equal(alive, false, 'reaped Chrome must stop answering CDP');

// -- attach-only mode against an existing endpoint --------------------------------
const attach = spawnManagedChromium({ executable: exe, userDataDir: join(dir, 'att'), headless: true, port: 0, args: ['--no-sandbox'] });
const attachEndpoint = await waitForDevtoolsActivePort(join(dir, 'att'), attach.process, { staleContent: attach.staleContent });
const link4 = createManagedControlLink('owner-4');
const s4 = await link4.connect({ backend: 'managed', headless: true, cdpUrl: attachEndpoint, workspaceDir: dir, args: ['--no-sandbox'] });
await s4.openPage('about:blank');
await s4.close();
// Attach-only must NOT kill the external Chrome:
const stillUp = await fetch(`${attachEndpoint}/json/version`, { signal: AbortSignal.timeout(500) })
  .then((r) => r.ok).catch(() => false);
assert.equal(stillUp, true, 'attach-only close leaves the foreign browser running');
await reapProcess(attach.process);

try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* Chrome teardown can lag the exit event by a beat; temp dir is disposable */
}
console.log('e2e-managed-cdp: ALL PASS');
