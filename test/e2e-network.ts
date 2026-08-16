/**
 * P7 real-network e2e: open → snapshot → locate → click → re-snapshot → verify.
 * Requires internet. Run: npx tsx test/e2e-network.ts
 */
import { createKernelManager } from '../src/kernel/manager.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const owner = { workspace_id: 'net-ws', session_id: 'net-session' };
const manager = createKernelManager({
  backend: 'playwright',
  headless: true,
  idleTtlMs: 60_000,
  workspaceDir: () => join(tmpdir(), 'dsh-tb-net'),
});

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}

try {
  const r1 = await manager.execute({
    requestId: 'n1',
    owner,
    code: `
      browser = await Browser.connect();
      page = await browser.open("https://example.com");
      await page.waitForLoadState("domcontentloaded");
      obs = await page.snapshot();
      surface = await page.currentSurface();
      // the single link on example.com
      linkCount = await page.getByRole("link").count();
      return { hasExample: obs.text.includes("Example Domain"), url: surface.url, linkCount };
    `,
  });
  check('no error on real open', r1.error === undefined, r1.error ? JSON.stringify(r1.error) : '');
  const v1 = JSON.parse(r1.value || 'null');
  check('snapshot sees live page', v1?.hasExample === true, JSON.stringify(v1));
  check('landed on example.com', v1?.url === 'https://example.com/', v1?.url);
  check('found the link', v1?.linkCount >= 1, 'linkCount=' + v1?.linkCount);

  // click the link (navigates to iana.org) then re-perceive
  const r2 = await manager.execute({
    requestId: 'n2',
    owner,
    code: `
      await page.getByRole("link").first.click();
      await page.waitForLoadState("domcontentloaded");
      s2 = await page.currentSurface();
      obs2 = await page.snapshot();
      return { url: s2.url, hasIANA: obs2.text.toLowerCase().includes("iana") };
    `,
  });
  check('no error on click+navigate', r2.error === undefined, r2.error ? JSON.stringify(r2.error) : '');
  const v2 = JSON.parse(r2.value || 'null');
  check('navigated away from example.com', v2?.url && !v2.url.startsWith('https://example.com'), v2?.url);
  check('re-snapshot sees new page (IANA)', v2?.hasIANA === true, JSON.stringify(v2));

  await manager.closeSession(owner);
} catch (e) {
  failures++;
  console.log('FAIL  unhandled', e);
} finally {
  manager.discardAllSync();
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
