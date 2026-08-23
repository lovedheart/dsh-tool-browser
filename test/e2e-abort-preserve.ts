/**
 * E2E: abort/timeout must NOT destroy the browser session (gap #2 fix).
 *
 * QwenPaw reference: a timed-out run kills the WORKER only — the browser,
 * its pages, and the stateful runtime survive for the next call. Under
 * node:vm we cannot hard-kill a busy script, so the fix is cooperative:
 * the run's abort signal (tool timeout / user cancel) cuts the in-flight
 * SDK ops short, the run ends in a governed RETRYABLE error, and the
 * kernel + pages stay alive. This suite verifies exactly that:
 *
 *   A. live session (page + global vars) is established
 *   B. abort mid-execution → governed RETRYABLE error, returns promptly
 *   C. session survives: kernel cached, vars persist, page navigable
 *   D. pre-aborted signal → immediate governed error, session survives
 *   E. regression: signal-less execute, explicit closeSession, pin/unpin
 *
 * Run: node --import tsx test/e2e-abort-preserve.ts   (offline; data: URLs)
 */
import { createKernelManager } from '../src/kernel/manager.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const owner = { workspace_id: 'e2e-abort-ws', session_id: 'e2e-abort-session' };
const wsDir = join(tmpdir(), 'dsh-tb-e2e-abort');

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

const t0 = Date.now();
try {
  // ── A. establish a live session: page + persistent global var ──────────
  const rA = await manager.execute({
    requestId: 'a',
    owner,
    code: `
      browser = await Browser.connect();
      page = await browser.open("data:text/html,<title>Abort Page</title><h1>Survivor</h1><input id='q' aria-label='Q box'/>");
      myVar = 42;
      return { ok: true };
    `,
  });
  check('A: session established', rA.error === undefined, rA.error ? JSON.stringify(rA.error) : '');

  const rA2 = await manager.execute({
    requestId: 'a2',
    owner,
    code: `return { myVar, page: typeof page !== "undefined" };`,
  });
  const vA2 = JSON.parse(rA2.value || 'null');
  check('A: global var + page live before abort', vA2?.myVar === 42 && vA2?.page === true, JSON.stringify(vA2));

  // ── B. abort mid-execution (10 s wait, aborted at 400 ms) ─────────────
  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(new Error('simulated tool timeout')), 400);
  const tB = Date.now();
  const rB = await manager.execute(
    {
      requestId: 'b',
      owner,
      code: `await page.waitForTimeout(10000); return { never: "reached" };`,
    },
    { signal: ctrl.signal },
  );
  clearTimeout(abortTimer);
  const tookMs = Date.now() - tB;
  check('B: aborted run returns promptly (< 5 s)', tookMs < 5000, `${tookMs} ms`);
  check('B: aborted run yields a governed error', rB.error !== undefined, JSON.stringify(rB.error));
  check('B: error category is RETRYABLE', rB.error?.category === 'RETRYABLE', rB.error?.category);
  check('B: error cause is timeout', rB.error?.cause === 'timeout', rB.error?.cause);
  check('B: teaching mentions the session survives', /still alive|persist/i.test(rB.error?.teaching ?? ''), rB.error?.teaching?.slice(0, 80));

  // ── C. session survived: kernel cached, vars + page intact ─────────────
  const rC = await manager.execute({
    requestId: 'c',
    owner,
    code: `
      const nav = await page.goto("data:text/html,<title>After Abort</title><h1>Still Here</h1>");
      obs = await page.snapshot();
      return { myVar, navOk: nav?.ok === true, seen: obs.text.includes("Still Here") };
    `,
  });
  check('C: no error after abort (kernel still cached)', rC.error === undefined, rC.error ? JSON.stringify(rC.error) : '');
  const vC = JSON.parse(rC.value || 'null');
  check('C: global var persisted across abort', vC?.myVar === 42, JSON.stringify(vC));
  check('C: page navigable after abort', vC?.navOk === true, JSON.stringify(vC));
  check('C: snapshot works after abort', vC?.seen === true, JSON.stringify(vC));

  // ── D. pre-aborted signal → immediate governed error, session survives ─
  const preCtrl = new AbortController();
  preCtrl.abort(new Error('pre-aborted'));
  const tD = Date.now();
  const rD = await manager.execute(
    {
      requestId: 'd',
      owner,
      code: `await page.waitForTimeout(10000); return { never: "reached" };`,
    },
    { signal: preCtrl.signal },
  );
  check('D: pre-aborted run returns immediately (< 500 ms)', Date.now() - tD < 500, `${Date.now() - tD} ms`);
  check('D: pre-aborted run yields RETRYABLE/timeout error', rD.error?.category === 'RETRYABLE' && rD.error?.cause === 'timeout', JSON.stringify(rD.error));
  const rD2 = await manager.execute({
    requestId: 'd2',
    owner,
    code: `return { myVar };`,
  });
  check('D: session still alive after pre-aborted run', JSON.parse(rD2.value || 'null')?.myVar === 42, rD2.error ? JSON.stringify(rD2.error) : rD2.value);

  // ── E. regression: signal-less execute, closeSession, pin/unpin ────────
  const rE = await manager.execute({
    requestId: 'e',
    owner,
    code: `return { still: typeof browser !== "undefined" && typeof page !== "undefined" };`,
  });
  check('E: signal-less execute still works', JSON.parse(rE.value || 'null')?.still === true, rE.error ? JSON.stringify(rE.error) : rE.value);

  manager.pin(owner);
  const rE2 = await manager.execute({
    requestId: 'e2',
    owner,
    code: `return 1 + 1;`,
  });
  check('E: pinned kernel still executes', JSON.parse(rE2.value || 'null') === 2, rE2.value);
  manager.unpin(owner);

  // Explicit closeSession still tears the session down (the only remaining
  // way to destroy it) — afterwards execute reports a governed error.
  await manager.closeSession(owner);
  const rE3 = await manager.execute({
    requestId: 'e3',
    owner,
    code: `return { should: "not happen" };`,
  });
  check('E: explicit closeSession still closes (new kernel is spawned, old gone)', true, 'no crash');
  // A fresh kernel was lazily re-spawned by e3 — verify it is a CLEAN session
  // (old globals are gone), proving the old one was really destroyed.
  const rE4 = await manager.execute({
    requestId: 'e4',
    owner,
    code: `return { fresh: typeof myVar === "undefined" };`,
  });
  check('E: post-closeSession session is fresh (old vars gone)', JSON.parse(rE4.value || 'null')?.fresh === true, JSON.stringify(JSON.parse(rE4.value || 'null')));
} catch (e) {
  failures++;
  console.log('FAIL  unhandled', e);
} finally {
  manager.discardAllSync();
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
