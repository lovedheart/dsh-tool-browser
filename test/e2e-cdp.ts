/**
 * P5 CDP-backend e2e: launch a real Chromium with --remote-debugging-port,
 * then drive it through the chrome backend (chromium.connectOverCDP). Verifies
 * the user-real-browser path works end to end (open → snapshot → act → verify).
 * Run: npx tsx test/e2e-cdp.ts
 */
import { chromium } from 'playwright';
import { createKernelManager } from '../src/kernel/manager.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CDP_PORT = 9333;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const owner = { workspace_id: 'cdp-ws', session_id: 'cdp-session' };

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}

// Launch a standalone Chromium exposing a CDP endpoint (simulates the user's browser).
const realBrowser = await chromium.launch({
  headless: true,
  args: [`--remote-debugging-port=${CDP_PORT}`],
});

const manager = createKernelManager({
  backend: 'chrome', // <-- exercise the CDP backend
  headless: true,
  cdpUrl: CDP_URL,
  idleTtlMs: 60_000,
  workspaceDir: () => join(tmpdir(), 'dsh-tb-cdp'),
});

try {
  const r1 = await manager.execute({
    requestId: 'c1',
    owner,
    code: `
      browser = await Browser.connect();
      page = await browser.open("data:text/html,<title>CDP Test</title><h1>Hello CDP</h1><button aria-label='Btn'>B</button>");
      obs = await page.snapshot();
      st = await browser.sessionStatus();
      return { hasCdp: obs.text.includes("Hello CDP"), variant: st.variant, connected: st.connected };
    `,
  });
  check('no error on CDP open', r1.error === undefined, r1.error ? JSON.stringify(r1.error) : '');
  const v1 = JSON.parse(r1.value || 'null');
  check('CDP snapshot sees page', v1?.hasCdp === true, JSON.stringify(v1));
  check('session variant is chrome', v1?.variant === 'chrome', v1?.variant);

  const r2 = await manager.execute({
    requestId: 'c2',
    owner,
    code: `
      await page.getByRole("button", { name: "Btn" }).click();
      return { ok: true };
    `,
  });
  check('no error on CDP act', r2.error === undefined, r2.error ? JSON.stringify(r2.error) : '');
  check('CDP act succeeded', JSON.parse(r2.value || 'null')?.ok === true, r2.value);

  await manager.closeSession(owner);
  check('closeSession disconnect (no throw)', true);
} catch (e) {
  failures++;
  console.log('FAIL  unhandled', e);
} finally {
  manager.discardAllSync();
  await realBrowser.close().catch(() => {});
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
