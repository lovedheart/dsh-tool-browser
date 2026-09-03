/**
 * E2E for the CDP-over-extension in-page injection engine
 * (src/backend/ext/cdp-inject.ts). Pure `page.evaluate` — no bridge, no
 * extension. Launches headless Chromium, loads a data-URL fixture with
 * button/input/checkbox/select/text samples, and evaluates the generated
 * locator/action/read snippets directly.
 * Run: npx tsx test/e2e-ext-inject.ts
 */
import { chromium } from 'playwright';
import {
  buildLocatorExpression,
  buildLocatorListExpression,
  buildActionExpression,
  buildReadExpression,
  ACT,
  READ,
} from '../src/backend/ext/cdp-inject.ts';
import type { LocatorSpec } from '../src/backend/ports.ts';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}

const HTML = `data:text/html,<html><body>
<button id="btn" class="primary">Click Me</button>
<input id="name" type="text" placeholder="Your name">
<label for="email">Email</label><input id="email" type="email">
<input id="cb" type="checkbox">
<select id="sel"><option value="a">Apple</option><option value="b">Banana</option></select>
<div class="item">Alpha</div><div class="item">Beta</div><div class="item">Gamma</div>
<div id="hidden" style="display:none">Hidden text</div>
<button disabled id="dis">Off</button>
<script>
window.__clicked = 0;
document.getElementById('btn').addEventListener('click', function(){ window.__clicked++; });
</script>
</body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await page.goto(HTML);

  // -- locator resolution ---------------------------------------------------
  const evalExpr = async (expr: string) => page.evaluate(`(() => { var el = ${expr}; return el ? (el.id || el.tagName) : null; })()`);

  check('role locator (button name)',
    (await evalExpr(buildLocatorExpression({ kind: 'role', role: 'button', name: 'Click Me' }))) === 'btn');
  check('text locator',
    (await evalExpr(buildLocatorExpression({ kind: 'text', text: 'Beta' }))) !== null);
  check('label locator',
    (await evalExpr(buildLocatorExpression({ kind: 'label', text: 'Email' }))) === 'email');
  check('placeholder locator',
    (await evalExpr(buildLocatorExpression({ kind: 'placeholder', text: 'Your name' }))) === 'name');
  check('css locator',
    (await evalExpr(buildLocatorExpression({ kind: 'css', selector: '#sel' }))) === 'sel');
  check('missing locator -> null',
    (await evalExpr(buildLocatorExpression({ kind: 'css', selector: '#nope' }))) === null);

  // -- nth / first / last + count -------------------------------------------
  const nSpec: LocatorSpec = { kind: 'css', selector: '.item' };
  check('count via list expression',
    (await page.evaluate(`(${buildLocatorListExpression(nSpec)}).length`)) === 3);
  const evalText = async (spec: LocatorSpec) =>
    page.evaluate(`(function(){ var el = ${buildLocatorExpression(spec)}; return el ? (el.id || el.tagName) + '|' + (el.textContent || '').trim() : null; })()`) as Promise<string | null>;
  const nth1 = await evalText({ ...nSpec, nth: 1 });
  const first = await evalText({ ...nSpec, first: true });
  const last = await evalText({ ...nSpec, last: true });
  check('nth/first/last', nth1?.endsWith('|Beta') === true && first?.endsWith('|Alpha') === true && last?.endsWith('|Gamma') === true, `${nth1}/${first}/${last}`);

  // -- actions (host-shaped composition) ------------------------------------
  const act = async (expr: string) => JSON.parse(await page.evaluate(expr) as string);
  const clickRes = await act(buildActionExpression({ kind: 'css', selector: '#btn' }, 'click'));
  const clicked = await page.evaluate('window.__clicked');
  check('click fires page handler + evidence', clicked === 1 && /clicked/.test(clickRes.evidence), clickRes.evidence);

  await act(buildActionExpression({ kind: 'css', selector: '#name' }, 'fill', 'hello'));
  const v = await page.evaluate(`(function(){ var el = ${buildLocatorExpression({ kind: 'css', selector: '#name' })}; return el.value; })()`);
  check('fill sets value', v === 'hello', String(v));

  await act(buildActionExpression({ kind: 'css', selector: '#cb' }, 'check'));
  const cb = await page.evaluate(`(function(){ var el = ${buildLocatorExpression({ kind: 'css', selector: '#cb' })}; return !!el.checked; })()`);
  check('check sets checked', cb === true);

  await act(buildActionExpression({ kind: 'css', selector: '#sel' }, 'selectOption', ['b']));
  const sv = await page.evaluate(`(function(){ var el = ${buildLocatorExpression({ kind: 'css', selector: '#sel' })}; return el.value; })()`);
  check('selectOption selects by value', sv === 'b', String(sv));

  const hover = await act(buildActionExpression({ kind: 'css', selector: '#btn' }, 'hover'));
  check('hover evidence', /hovered/.test(hover.evidence), hover.evidence);

  // -- reads ------------------------------------------------------------------
  const read = async (spec: LocatorSpec, verb: string, arg?: unknown) =>
    JSON.parse(await page.evaluate(buildReadExpression(spec, verb, arg)) as string);
  check('READ.isVisible (visible)', (await read({ kind: 'css', selector: '#btn' }, 'isVisible')) === true);
  check('READ.isVisible (hidden)', (await read({ kind: 'css', selector: '#hidden' }, 'isVisible')) === false);
  check('READ.isEnabled (disabled)', (await read({ kind: 'css', selector: '#dis' }, 'isEnabled')) === false);
  check('READ.count via buildReadExpression', (await read(nSpec, 'count')) === 3);
  check('READ.inputValue', (await read({ kind: 'css', selector: '#name' }, 'inputValue')) === 'hello');
  check('READ.boundingBox', (await read({ kind: 'css', selector: '#btn' }, 'boundingBox'))?.width > 0);

  // -- LOCATOR_NOT_FOUND marker -----------------------------------------------
  let marker = false;
  try {
    await page.evaluate(buildActionExpression({ kind: 'css', selector: '#nope' }, 'click'));
  } catch (e) {
    marker = String(e).includes('LOCATOR_NOT_FOUND');
  }
  check('missing element throws LOCATOR_NOT_FOUND', marker);
} catch (e) {
  failures++;
  console.log('FAIL  unhandled', e);
} finally {
  await browser.close().catch(() => {});
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
