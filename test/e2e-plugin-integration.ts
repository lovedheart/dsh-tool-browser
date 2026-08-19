/**
 * P7 DSH-runtime integration: exercise the REAL plugin entry (apply →
 * registerBrowserTool → defineTool) with a faithful ctx mock (the shape Cordis
 * hands a plugin), then drive the registered tool through its own validation,
 * execute, render (model text), and presentation cards — offline via data: URL.
 * Run: npx tsx test/e2e-plugin-integration.ts
 */
import * as plugin from '../src/index.ts';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import type { BrowserToolConfig } from '../src/config.ts';

// --- faithful ctx mock (only the seams the plugin touches) -------------------
let registered: any = null;
let sections: any[] = [];
const disposers: Array<() => void> = [];
// Faithful to the REAL Cordis ctx the plugin now touches: `tools`,
// `systemPrompt`, and the auto-mixed `effect` (no inject). It deliberately has
// NO `session`/`workspace` seam — the plugin must not read those (the runtime
// proxy rejects undeclared props); session id now comes from exec.agent.session.
const ctxTarget = {
  tools: { register: (t: unknown) => { registered = t; } },
  systemPrompt: { section: (s: any) => { sections.push(s); } },
  // Cordis auto-mixes `effect` onto ctx (mixin fiber ["runtime","effect"]);
  // no inject declaration required.
  effect: (fn: () => unknown, _label?: string) => {
    disposers.push(() => {
      const c = fn();
      if (typeof c === 'function') (c as () => void)();
    });
  },
};
// Mirror the REAL Cordis ctx proxy: any property access that is not one of the
// declared seams above throws "without inject". This is what bit the plugin in
// the live harness (ctx.addDispose / ctx.session / ctx.workspace). A plain
// object mock would silently return undefined for those and hide the bug.
const ctx: any = new Proxy(ctxTarget, {
  get(t, prop) {
    if (typeof prop === 'symbol' || prop === 'then' || prop === 'prototype') return (t as any)[prop];
    if (!(prop in t)) {
      throw new Error(`cannot get property "${String(prop)}" without inject`);
    }
    return (t as any)[prop];
  },
});
// dispatch exec: the real ToolRuntime passes { signal, agent } where
// agent.session.id is the stable per-conversation identity.
const exec = { signal: new AbortController().signal, agent: { session: { id: 'int-session' } } };

const config: BrowserToolConfig = {
  enabled: true,
  backend: 'playwright',
  headless: true,
  executablePath: undefined,
  cdpUrl: undefined,
  execTimeoutMs: 120_000,
  idleTtlMs: 60_000,
  maxOutputChars: 100_000,
};

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}

// 1. plugin metadata + apply
check('plugin name', plugin.name === 'tool-browser', plugin.name);
check('plugin inject', plugin.inject.includes('tools') && plugin.inject.includes('systemPrompt'), JSON.stringify(plugin.inject));
// Config must satisfy standard-schema v1 (Cordis calls Config["~standard"].validate).
const std = (plugin.Config as any)['~standard'];
check('plugin Config is standard-schema v1', typeof std?.validate === 'function', std ? 'ok' : 'missing ~standard');
const validated = std.validate({ enabled: true });
check('Config validates + applies defaults', validated.value.backend === 'playwright' && validated.value.execTimeoutMs === 120_000, JSON.stringify(validated.value).slice(0, 80));
plugin.apply(ctx, config);
check('apply registers a tool', !!registered && registered.name === 'browser', registered?.name);
check('apply registers systemPrompt section', sections.length === 1 && sections[0].name === 'tool:browser', sections[0]?.name);
check('apply wires teardown dispose', disposers.length === 1, String(disposers.length));

// 2. presentCall shape (pending card)
const pc = registered.presentCall({ code: 'browser = await Browser.connect()' });
check('presentCall generic/execute', pc?.card === 'generic' && pc?.kind === 'execute', JSON.stringify(pc?.kind));

// 3. drive the tool through defineTool's own validation + execute
const r1 = await registered.execute({ code: `
  browser = await Browser.connect();
  page = await browser.open("data:text/html,<title>Plugin E2E</title><h1>Integrated</h1>");
  obs = await page.snapshot();
  return { seen: obs.text.includes("Integrated") };
` }, exec);
check('execute returns ExecResult', r1 && typeof r1 === 'object' && 'requestId' in r1, String(r1?.requestId));
check('no error on plugin e2e open', r1.error === undefined, r1.error ? JSON.stringify(r1.error) : '');
check('plugin e2e sees page', JSON.parse(r1.value || 'null')?.seen === true, r1.value);
// Regression guard: the real runtime validates the execute() return against
// output.schema inside createSuccessResult (ToolRuntime dispatch), which these
// direct .execute() calls bypass. requestId MUST be declared or every successful
// call throws ToolOutputError in the live harness.
const outViolations = validateJsonSchemaValue(registered.output.schema, r1, 'value');
check('ExecResult satisfies output.schema (dispatch-path)', outViolations.length === 0, JSON.stringify(outViolations));

// 4. model-facing render (the text the model reads)
const blocks = registered.output.render({ code: '' }, r1);
const modelText = blocks.map((b: any) => b.text).join('');
check('render produces model text', modelText.includes('true'), modelText.slice(0, 60));
const meta = registered.output.presentationMeta({ code: '' }, r1);
check('presentationMeta isError=false on success', meta?.isError === false, JSON.stringify(meta));

// 5. stateful: second call reuses the session
const r2 = await registered.execute({ code: `return { still: typeof page !== "undefined" };` }, exec);
check('stateful across tool calls', JSON.parse(r2.value || 'null')?.still === true, r2.value);

// 6. governed error path through the real tool
const r3 = await registered.execute({ code: `await page.nope();` }, exec);
check('plugin e2e surfaces governed error', r3.error != null, r3.error?.category);
const errMeta = registered.output.presentationMeta({ code: '' }, r3);
check('presentationMeta isError=true on error', errMeta?.isError === true, JSON.stringify(errMeta));
const errText = registered.output.render({ code: '' }, r3).map((b: any) => b.text).join('');
check('error rendered as teaching text', /^\[/.test(errText) || errText.includes('['), errText.slice(0, 50));

// 7. arg validation (empty code rejected by defineTool)
let threw = false;
try { await registered.execute({ code: '   ' }, exec); } catch { threw = true; }
check('empty code rejected by defineTool validation', threw, '');

// 8. teardown via dispose (effect-scoped)
disposers.forEach((d) => d());
check('dispose ran without throwing', true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
