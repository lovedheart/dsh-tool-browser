/**
 * E2E minimal closed loop: open → snapshot → act → verify, driving the real
 * KernelManager + Playwright backend against a local data: URL (no network).
 * Run: node --experimental-strip-types test/e2e-minloop.ts
 */
import { createKernelManager } from '../src/kernel/manager.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const owner = { workspace_id: 'e2e-ws', session_id: 'e2e-session' };
const wsDir = join(tmpdir(), 'dsh-tb-e2e');

const manager = createKernelManager({
  backend: 'playwright',
  headless: true,
  idleTtlMs: 60_000,
  workspaceDir: () => wsDir,
});

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}

try {
  // 1. connect + open a page with an input and a button
  const r1 = await manager.execute({
    requestId: 'r1',
    owner,
    code: `
      browser = await Browser.connect();
      page = await browser.open("data:text/html,<title>Test Page</title><h1>Hello E2E</h1><input id='q' aria-label='Search box'/><button id='go' aria-label='Go button'>Go</button><p id='out'></p>");
      obs = await page.snapshot();
      print("LEN=" + obs.text.length);
      return { hasHello: obs.text.includes("Hello E2E"), title: (await page.currentSurface()).title };
    `,
  });
  check('no error on open', r1.error === undefined, r1.error ? JSON.stringify(r1.error) : '');
  const v1 = JSON.parse(r1.value || 'null');
  check('snapshot sees page text', v1?.hasHello === true, JSON.stringify(v1));
  // structured elements from the aria tree (ai-mode snapshot)
  const r1b = await manager.execute({
    requestId: 'r1b',
    owner,
    code: `
      obs2 = await page.snapshot();
      return { elements: (obs2.elements || []).map(e => e.role + ":" + e.name) };
    `,
  });
  const v1b = JSON.parse(r1b.value || 'null');
  check('snapshot returns structured elements', Array.isArray(v1b?.elements) && v1b.elements.length > 0, JSON.stringify(v1b));
  check('elements carry roles (button/input present)', (v1b?.elements || []).some((e: string) => e.startsWith('button')) && (v1b?.elements || []).some((e: string) => e.startsWith('textbox')), JSON.stringify(v1b?.elements));
  check('currentSurface title', v1?.title === 'Test Page', v1?.title);

  // 2. act: fill the input, click the button, verify the page reacted
  const r2 = await manager.execute({
    requestId: 'r2',
    owner,
    code: `
      // stateful: browser & page persist from the previous call
      await page.getByLabel("Search box").fill("hello world");
      ev = await page.getByRole("button", { name: "Go button" }).click();
      // simulate the button writing back (no JS handler on data: url, so assert value persists)
      val = await page.getByLabel("Search box").inputValue();
      return { ev: ev.evidence, val };
    `,
  });
  check('no error on act', r2.error === undefined, r2.error ? JSON.stringify(r2.error) : '');
  const v2 = JSON.parse(r2.value || 'null');
  check('fill persisted (stateful session)', v2?.val === 'hello world', JSON.stringify(v2));
  check('click returned evidence', typeof v2?.ev === 'string' && v2.ev.length > 0, v2?.ev);

  // 3. statefulness across a 3rd call: variables still live
  const r3 = await manager.execute({
    requestId: 'r3',
    owner,
    code: `return { stillConnected: typeof browser !== "undefined" && typeof page !== "undefined" };`,
  });
  const v3 = JSON.parse(r3.value || 'null');
  check('variables persist across calls', v3?.stillConnected === true, JSON.stringify(v3));

  // 4. governed error: strict-mode / API misuse path (call a non-existent page method)
  const r4 = await manager.execute({
    requestId: 'r4',
    owner,
    code: `await page.thisMethodDoesNotExist();`,
  });
  check('missing method yields governed error', r4.error !== undefined, r4.error ? r4.error.reason : '');
  check('error has category', r4.error?.category !== undefined, r4.error?.category);

  // 5. handoff in headless → governed ASK_HUMAN error
  const r5 = await manager.execute({
    requestId: 'r5',
    owner,
    code: `await browser.handoff("captcha", "please solve");`,
  });
  check('headless handoff errors (ASK_HUMAN)', r5.error?.category === 'ASK_HUMAN', r5.error?.category);

  await manager.closeSession(owner);
} catch (e) {
  failures++;
  console.log('FAIL  unhandled', e);
} finally {
  manager.discardAllSync();
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
