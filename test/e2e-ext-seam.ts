/**
 * P0 seam test: the 'chrome-extension' backend option is wired through config →
 * manager dispatch → a governed (not thrown-crash) error until P4 implements it.
 * Run: npx tsx test/e2e-ext-seam.ts
 */
import { createKernelManager } from '../src/kernel/manager.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}

const manager = createKernelManager({
  backend: 'chrome-extension',
  headless: true,
  idleTtlMs: 60_000,
  workspaceDir: () => join(tmpdir(), 'dsh-tb-ext-seam'),
});

// Connect happens in manager.get() — the stub's BrowserError propagates out of
// execute() (connect-time failure, before any code runs).
let err: Record<string, string> | undefined;
try {
  await manager.execute({
    requestId: 'x1',
    owner: { workspace_id: 'ext-seam-ws', session_id: 'ext-seam-session' },
    code: `browser = await Browser.connect(); return {};`,
  });
} catch (e) {
  err = e as Record<string, string>;
}
check('connect yields a governed error', err !== undefined, String(err));
check(
  'error is governed RETRYABLE/bridge_disconnected (extension not connected)',
  err?.['category'] === 'RETRYABLE' && err?.['cause'] === 'bridge_disconnected',
  `${err?.['name']}/${err?.['category']}/${err?.['cause']}`,
);
// The other backends still dispatch (config enum didn't break them).
const pm = createKernelManager({
  backend: 'playwright',
  headless: true,
  idleTtlMs: 60_000,
  workspaceDir: () => join(tmpdir(), 'dsh-tb-ext-seam'),
});
const r2 = await pm.execute({
  requestId: 'x2',
  owner: { workspace_id: 'ext-seam-ws', session_id: 'pw-ok' },
  code: `browser = await Browser.connect(); page = await browser.open("data:text/html,<b>ok</b>"); return { ok: true };`,
});
check('playwright backend unaffected', r2.error === undefined, JSON.stringify(r2.error ?? {}));
await pm.dispose();

await manager.dispose();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
