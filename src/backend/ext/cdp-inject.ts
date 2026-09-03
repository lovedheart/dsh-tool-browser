/**
 * Page-side injection engine for the CDP-over-Chrome-extension backend.
 *
 * Ported concept from QwenPaw cdp_verbs.py; implemented DOM-side for DSH.
 *
 * The extension backend has no Playwright objects inside the page: every
 * locator operation must be translated into a self-contained snippet of
 * JavaScript that is evaluated in the page context via
 * `Runtime.evaluate({ returnByValue: true, awaitPromise: true })`. This module
 * compiles a declarative {@link LocatorSpec} into such snippets and provides
 * the per-verb ACT / READ function bodies that run against the resolved
 * element(s).
 *
 * Conventions shared with the host (chrome-extension.ts):
 *   - locator snippets evaluate to a single Element or `null`
 *     ({@link buildLocatorExpression}) or to an Element array
 *     ({@link buildElementsExpression});
 *   - every action/read snippet ends by returning `JSON.stringify(payload)`
 *     so the host can uniformly `JSON.parse` the evaluation result;
 *   - a missing element throws `Error` whose message contains the fixed
 *     marker {@link LOCATOR_NOT_FOUND}; the host maps that marker to a
 *     governed `BrowserError` (category RETRYABLE, cause `locator_not_found`).
 *   - strict-mode parity with the Playwright wrapper: multiple CSS matches do
 *     not throw — the first is taken and the ambiguity is recorded on
 *     `globalThis.__dshAmbiguousLocator` for diagnostics.
 *
 * The generated code has no external dependencies: plain DOM APIs plus a
 * small ARIA-heuristic table (implicit roles + accessible names).
 */

import type { LocatorSpec } from '../ports.ts';

/** Fixed marker in thrown messages so the host can map to a governed error. */
export const LOCATOR_NOT_FOUND = 'LOCATOR_NOT_FOUND';
/** Fixed marker for in-page waits that gave up. */
export const LOCATOR_TIMEOUT = 'LOCATOR_TIMEOUT';

/** Serialize a value as a JS literal safe to splice into generated code. */
function js(v: unknown): string {
  return JSON.stringify(v === undefined ? null : v);
}

// ---------------------------------------------------------------------------
// Shared in-page helpers (emitted inside every elements IIFE)
// ---------------------------------------------------------------------------

const HELPERS = `
function __norm(s){ return String(s === null || s === undefined ? '' : s).replace(/\\s+/g, ' ').trim(); }
function __lc(s){ return __norm(s).toLowerCase(); }
function __roleOf(el){
  var r = el.getAttribute ? el.getAttribute('role') : null;
  if (r) return __lc(r);
  var t = (el.tagName || '').toLowerCase();
  if (t === 'a') return 'link';
  if (t === 'input') {
    var ty = (el.getAttribute('type') || '').toLowerCase();
    var im = { button: 'button', submit: 'button', reset: 'button', image: 'button',
      checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton',
      search: 'searchbox', tel: 'textbox', url: 'textbox', email: 'textbox',
      text: 'textbox', hidden: 'hidden', file: 'button', date: 'textbox',
      time: 'textbox', datetime: 'textbox' };
    return Object.prototype.hasOwnProperty.call(im, ty) ? im[ty] : 'textbox';
  }
  var m = { button: 'button', textarea: 'textbox', select: el.multiple ? 'listbox' : 'combobox',
    img: 'img', nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo',
    section: 'region', article: 'article', aside: 'complementary', form: 'form',
    ul: 'list', ol: 'list', li: 'listitem', table: 'table', dialog: 'dialog',
    progress: 'progressbar', output: 'status', details: 'group', fieldset: 'group',
    iframe: 'iframe', canvas: '', label: '', legend: '',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading' };
  return m[t] || '';
}
function __nameOf(el){
  var a = el.getAttribute ? el.getAttribute('aria-label') : null;
  if (a && __norm(a)) return __norm(a);
  var lb = el.getAttribute ? el.getAttribute('aria-labelledby') : null;
  if (lb) {
    var ids = String(lb).split(/\\s+/);
    var txt = ids.map(function (id) { var n = document.getElementById(id); return n ? (n.textContent || '') : ''; }).join(' ');
    if (__norm(txt)) return __norm(txt);
  }
  var t = (el.tagName || '').toLowerCase();
  if (t === 'input') {
    var ty = (el.getAttribute('type') || '').toLowerCase();
    if (ty === 'button' || ty === 'submit' || ty === 'reset') return __norm(el.value);
    if (el.labels && el.labels.length) return __norm(el.labels[0].textContent);
    if (el.placeholder) return __norm(el.placeholder);
  }
  if (t === 'img' && el.getAttribute('alt')) return __norm(el.getAttribute('alt'));
  if (t !== 'label' && el.closest) {
    var lab = el.closest('label');
    if (lab) return __norm(lab.textContent);
  }
  return __norm(el.textContent);
}
`;

// ---------------------------------------------------------------------------
// Locator compilation
// ---------------------------------------------------------------------------

/** Compile the spec's base selection into an expression yielding Element[]. */
function compileBase(spec: LocatorSpec): string {
  switch (spec.kind) {
    case 'css':
      return `(function(){ var __n = Array.prototype.slice.call(document.querySelectorAll(${js(spec.selector ?? '*')})); if (__n.length > 1) { try { globalThis.__dshAmbiguousLocator = { selector: ${js(spec.selector ?? '')}, count: __n.length }; } catch (e) {} } return __n; })()`;
    case 'frame':
      // Simplification: the iframe's whole document as the base set; further
      // narrowing happens through filters.
      return `(function(){ var __f = document.querySelector(${js(spec.selector ?? '')}); var __d = __f ? __f.contentDocument : null; return __d ? Array.prototype.slice.call(__d.querySelectorAll('*')) : []; })()`;
    case 'text':
      return `(function(){ var wl = __lc(${js(spec.text ?? '')}); if (!wl) return []; var all = (document.body ? [document.body] : []).concat(Array.prototype.slice.call(document.querySelectorAll('body *'))); var scored = []; for (var i = 0; i < all.length; i++) { var e = all[i]; var t = __lc(e.textContent); if (!t) continue; var hit = t === wl ? 0 : (t.includes(wl) ? 1 : -1); if (hit >= 0) scored.push([hit, e]); } var leaves = scored.filter(function (p) { return !scored.some(function (q) { return q[1] !== p[1] && p[1].contains(q[1]); }); }); leaves.sort(function (a, b) { return a[0] - b[0]; }); return leaves.map(function (p) { return p[1]; }); })()`;
    case 'role': {
      const nameExpr = spec.name === undefined ? 'null' : `__lc(${js(spec.name)})`;
      return `(function(){ var want = ${js((spec.role ?? '').toLowerCase())}; var nl = ${nameExpr}; var all = Array.prototype.slice.call(document.querySelectorAll('*')); var inRole = all.filter(function (e) { return __roleOf(e) === want; }); if (!nl) return inRole; var exact = inRole.filter(function (e) { return __lc(__nameOf(e)) === nl; }); if (exact.length) return exact; return inRole.filter(function (e) { return __lc(__nameOf(e)).includes(nl); }); })()`;
    }
    case 'label':
      return `(function(){ var wl = __lc(${js(spec.text ?? '')}); var out = []; function add(e, score){ if (!e || score < 0) return; for (var k = 0; k < out.length; k++) { if (out[k][1] === e) { if (score < out[k][0]) out[k][0] = score; return; } } out.push([score, e]); } function sc(s){ return s === wl ? 0 : (wl && s.includes(wl) ? 1 : -1); } var labels = Array.prototype.slice.call(document.querySelectorAll('label')); labels.forEach(function (l) { var s = sc(__lc(l.textContent)); if (s < 0) return; if (l.htmlFor) add(document.getElementById(l.htmlFor), s); var cs = l.querySelectorAll('input,select,textarea,button,[contenteditable="true"]'); for (var i = 0; i < cs.length; i++) add(cs[i], s); }); Array.prototype.slice.call(document.querySelectorAll('[aria-label]')).forEach(function (e) { add(e, sc(__lc(e.getAttribute('aria-label')))); }); Array.prototype.slice.call(document.querySelectorAll('[aria-labelledby]')).forEach(function (e) { var ids = String(e.getAttribute('aria-labelledby') || '').split(/\\s+/); var t = __lc(ids.map(function (id) { var n = document.getElementById(id); return n ? (n.textContent || '') : ''; }).join(' ')); add(e, sc(t)); }); Array.prototype.slice.call(document.querySelectorAll('input,textarea,select,button,[contenteditable="true"]')).forEach(function (e) { if (e.labels && e.labels.length) add(e, sc(__lc(e.labels[0].textContent))); }); out.sort(function (a, b) { return a[0] - b[0]; }); return out.map(function (p) { return p[1]; }); })()`;
    case 'placeholder':
      return `(function(){ var wl = __lc(${js(spec.text ?? '')}); if (!wl) return []; var scored = []; var all = Array.prototype.slice.call(document.querySelectorAll('input[placeholder], textarea[placeholder]')); all.forEach(function (e) { var p = __lc(e.getAttribute('placeholder')); var hit = p === wl ? 0 : (p.includes(wl) ? 1 : -1); if (hit >= 0) scored.push([hit, e]); }); scored.sort(function (a, b) { return a[0] - b[0]; }); return scored.map(function (p) { return p[1]; }); })()`;
    default:
      throw new Error(`Unsupported locator kind: ${String((spec as LocatorSpec).kind)}`);
  }
}

/** Compile filters + nth/first/last tail lines acting on the `__els` array. */
function compileTail(spec: LocatorSpec): string {
  const parts: string[] = [];
  for (const f of spec.filters ?? []) {
    if (f.hasText !== undefined) {
      parts.push(`__els = __els.filter(function (e) { return (e.textContent || '').includes(${js(f.hasText)}); });`);
    }
  }
  if (spec.nth !== undefined) {
    const idx = spec.nth < 0 ? `__els.length ${spec.nth}` : `${spec.nth}`;
    parts.push(`__els = __els.length > ${idx >= 0 ? idx : `${idx} >= 0 ? ${idx}` : idx} ? [__els[${idx}]] : [];`.replace(
      // normalize the negative-index guard into plain JS
      /\S+( \? \[__els\[[^\]]*\]\] : \[\];)/,
      `((__els.length + (${idx})) >= 0 && (${idx}) < __els.length) ? [__els[(${idx})]] : [];`,
    ));
  }
  if (spec.first) parts.push('__els = __els.slice(0, 1);');
  if (spec.last) parts.push('__els = __els.length ? [__els[__els.length - 1]] : [];');
  return parts.join('\n  ');
}

/** Build an IIFE snippet evaluating to an Element[] (possibly empty). */
export function buildElementsExpression(spec: LocatorSpec): string {
  const helpers = spec.kind === 'role' || spec.kind === 'text' || spec.kind === 'label' || spec.kind === 'placeholder' ? HELPERS : '';
  return `(() => {\n  ${helpers}\n  var __els = ${compileBase(spec)};\n  ${compileTail(spec)}\n  return __els;\n})()`;
}

/**
 * Build an IIFE snippet evaluating to a single Element or `null` (first
 * match; ambiguity tolerated and recorded, matching the Playwright wrapper's
 * lenient behavior).
 */
export function buildLocatorExpression(spec: LocatorSpec): string {
  const helpers = spec.kind === 'role' || spec.kind === 'text' || spec.kind === 'label' || spec.kind === 'placeholder' ? HELPERS : '';
  return `(() => {\n  ${helpers}\n  var __els = ${compileBase(spec)};\n  ${compileTail(spec)}\n  return __els.length ? __els[0] : null;\n})()`;
}

// ---------------------------------------------------------------------------
// ACT bodies — function strings with signature (el, arg)
// ---------------------------------------------------------------------------

/** Null-guard preamble shared by all action bodies. */
function needEl(verb: string): string {
  return `if (!el) { throw new Error(${js(`${LOCATOR_NOT_FOUND}: ${verb}: element did not resolve`)}); }`;
}

/** Element-descriptor helper (`tag#id.class`), spliced into act bodies. */
const DESC = `function __d(e){ var t = (e.tagName || '').toLowerCase(); var cl = ''; try { cl = (e.getAttribute('class') || '').trim(); } catch (_) {} var cls = cl ? '.' + cl.split(/\\s+/).join('.') : ''; return t + (e.id ? '#' + e.id : '') + cls; }`;

/** Center-of-element + hit-target preamble for pointer-ish acts. */
const CENTER = `var __r = el.getBoundingClientRect(); var __x = Math.round((__r.left + __r.right) / 2); var __y = Math.round((__r.top + __r.bottom) / 2); var __t = document.elementFromPoint(__x, __y) || el;
function __me(type, detail){ __t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: __x, clientY: __y, button: 0, detail: detail || 1 })); }
function __pe(type, detail){ if (typeof PointerEvent === 'function') { __t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: __x, clientY: __y, button: 0, detail: detail || 1, pointerId: 1, pointerType: 'mouse', isPrimary: true })); } else { __me(type, detail); } }`;

/** Native value setter preamble for fill/type/clear (React-compatible). */
const VALUE_SETTER = `function __setValue(node, v){ var proto = (typeof HTMLTextAreaElement !== 'undefined' && node instanceof HTMLTextAreaElement) ? HTMLTextAreaElement.prototype : (typeof HTMLInputElement !== 'undefined' && node instanceof HTMLInputElement) ? HTMLInputElement.prototype : (typeof HTMLSelectElement !== 'undefined' && node instanceof HTMLSelectElement) ? HTMLSelectElement.prototype : HTMLElement.prototype; var d = Object.getOwnPropertyDescriptor(proto, 'value'); if (node.isContentEditable) { node.textContent = String(v); } else if (d && d.set) { d.set.call(node, String(v)); } else { node.value = String(v); } node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }`;

function checkBody(verb: string, wantExpr: string): string {
  return `${needEl(verb)}
function __input(e){ var t = (e.tagName || '').toLowerCase(); if (t === 'input' && (e.type === 'checkbox' || e.type === 'radio')) return e; if (e.querySelector) { var i = e.querySelector('input[type=checkbox],input[type=radio]'); if (i) return i; } return null; }
var want = ${wantExpr};
var input = __input(el);
var cur;
if (input) { cur = !!input.checked; }
else { var ac = el.getAttribute ? el.getAttribute('aria-checked') : null; cur = ac === 'true' || ac === 'mixed'; }
if (cur !== want) {
  if (input) { input.click(); }
  else { el.setAttribute('aria-checked', want ? 'true' : 'false'); el.dispatchEvent(new Event('change', { bubbles: true })); }
}
var now = input ? !!input.checked : (el.getAttribute('aria-checked') === 'true');
if (now !== want && !input) { if (input === null) { now = want; } }
return JSON.stringify({ ok: true, evidence: now ? 'checked' : 'unchecked' });`;
}

/** Action bodies. Each is a function body `(el, arg) => { ... }` whose final
 *  statement returns `JSON.stringify(payload)`. */
export const ACT: Record<string, string> = {
  click: `${needEl('click')}
${DESC}
${CENTER}
el.scrollIntoView ? el.scrollIntoView({ block: 'center', inline: 'nearest' }) : null;
__r = el.getBoundingClientRect(); __x = Math.round((__r.left + __r.right) / 2); __y = Math.round((__r.top + __r.bottom) / 2); __t = document.elementFromPoint(__x, __y) || el;
__pe('pointerover'); __me('mouseover'); __pe('pointerdown'); __me('mousedown'); __pe('pointerup'); __me('mouseup'); __me('click');
return JSON.stringify({ ok: true, evidence: 'clicked ' + __d(el) + ' at (' + __x + ',' + __y + ')' });`,

  dblclick: `${needEl('dblclick')}
${DESC}
${CENTER}
__pe('pointerdown'); __me('mousedown', 1); __pe('pointerup'); __me('mouseup', 1); __me('click', 1);
__pe('pointerdown'); __me('mousedown', 2); __pe('pointerup'); __me('mouseup', 2); __me('click', 2); __me('dblclick', 2);
return JSON.stringify({ ok: true, evidence: 'double-clicked ' + __d(el) + ' at (' + __x + ',' + __y + ')' });`,

  hover: `${needEl('hover')}
${DESC}
${CENTER}
__pe('pointerover'); __pe('pointerenter'); __me('mouseover'); __me('mousemove'); __pe('pointermove');
return JSON.stringify({ ok: true, evidence: 'hovered ' + __d(el) + ' at (' + __x + ',' + __y + ')' });`,

  fill: `${needEl('fill')}
${DESC}
${VALUE_SETTER}
if (el.focus) { try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } }
__setValue(el, arg === null || arg === undefined ? '' : arg);
if (el.setSelectionRange) { try { var __l = String(el.value === undefined ? '' : el.value).length; el.setSelectionRange(__l, __l); } catch (_) {} }
return JSON.stringify({ ok: true, evidence: 'filled ' + JSON.stringify(String(arg === null || arg === undefined ? '' : arg)) });`,

  type: `${needEl('type')}
${VALUE_SETTER}
if (el.focus) { try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } }
var __s = String(arg === null || arg === undefined ? '' : arg);
for (var __i = 0; __i < __s.length; __i++) {
  var __ch = __s[__i];
  el.dispatchEvent(new KeyboardEvent('keydown', { key: __ch, bubbles: true, cancelable: true }));
  __setValue(el, (el.isContentEditable ? (el.textContent || '') : String(el.value === undefined ? '' : el.value)) + __ch);
  el.dispatchEvent(new KeyboardEvent('keyup', { key: __ch, bubbles: true, cancelable: true }));
}
return JSON.stringify({ ok: true, evidence: 'typed ' + JSON.stringify(__s) });`,

  press: `${needEl('press')}
var __key = String(arg === null || arg === undefined ? '' : arg);
var __parts = __key.split('+');
var __k = __parts.length > 1 ? __parts[__parts.length - 1].trim() : __key;
var __mods = (__parts.length > 1 ? __parts.slice(0, -1).join('+') : '').toLowerCase();
if (__k === 'Space') __k = ' ';
if (document.activeElement !== el && el.focus) { try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } }
var __o = { key: __k, code: 'Key' + __k.toUpperCase(), bubbles: true, cancelable: true, composed: true,
  ctrlKey: __mods.indexOf('ctrl') >= 0, altKey: __mods.indexOf('alt') >= 0,
  shiftKey: __mods.indexOf('shift') >= 0 || /[A-Z]/.test(__k), metaKey: __mods.indexOf('meta') >= 0 || __mods.indexOf('cmd') >= 0 };
el.dispatchEvent(new KeyboardEvent('keydown', __o));
el.dispatchEvent(new KeyboardEvent('keyup', __o));
return JSON.stringify({ ok: true, evidence: 'pressed ' + JSON.stringify(__key) });`,

  check: checkBody('check', 'true'),
  uncheck: checkBody('uncheck', 'false'),
  setChecked: checkBody('setChecked', '!!arg'),

  selectOption: `${needEl('selectOption')}
var __tag = (el.tagName || '').toLowerCase();
if (__tag !== 'select') { throw new Error(${js(`${LOCATOR_NOT_FOUND}: selectOption: resolved element is not a <select>`)}); }
var __vals = Array.isArray(arg) ? arg.map(String) : [String(arg === null || arg === undefined ? '' : arg)];
var __hits = [];
for (var __i = 0; __i < el.options.length; __i++) {
  var __o = el.options[__i];
  var __ot = (__o.text || '').trim();
  var __hit = __vals.some(function (v) { return __o.value === v || __lcCmp(__ot, v) || __ot.includes(String(v)); });
  __hits.push(__hit);
  if (el.multiple) { __o.selected = __hit; }
}
var __firstHit = __hits.indexOf(true);
if (__firstHit < 0) { throw new Error(${js(`${LOCATOR_NOT_FOUND}: selectOption: no option matched`)} + JSON.stringify(__vals)); }
if (!el.multiple) { el.selectedIndex = __firstHit; }
else { for (var __j = 0; __j < el.options.length; __j++) { el.options[__j].selected = __hits[__j]; } }
function __lcCmp(a, b){ return String(a).toLowerCase() === String(b).toLowerCase(); }
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
return JSON.stringify({ ok: true, evidence: 'selected ' + __vals.map(function (v) { return JSON.stringify(v); }).join(', ') });`,

  scroll: `${needEl('scroll')}
${DESC}
if (el.scrollIntoView) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); }
return JSON.stringify({ ok: true, evidence: 'scrolled into view ' + __d(el) });`,

  focus: `${needEl('focus')}
${DESC}
if (el.focus) { el.focus({ preventScroll: true }); }
return JSON.stringify({ ok: true, evidence: 'focused ' + __d(el) });`,

  blur: `${needEl('blur')}
${DESC}
if (el.blur) { el.blur(); }
return JSON.stringify({ ok: true, evidence: 'blurred ' + __d(el) });`,

  clear: `${needEl('clear')}
${VALUE_SETTER}
if (el.focus) { try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } }
__setValue(el, '');
return JSON.stringify({ ok: true, evidence: 'cleared' });`,

  waitFor: `${needEl('waitFor')}
var __state = (arg && arg.state) || 'visible';
var __timeout = (arg && arg.timeout) || 5000;
var __start = Date.now();
function __vis(){ if (!el || !el.isConnected) return false; var r = el.getBoundingClientRect(); var cs = window.getComputedStyle(el); var box = (r.width > 0 && r.height > 0) || el.getClientRects().length > 0; return box && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.visibility !== 'collapse'; }
return new Promise(function (resolve, reject) {
  function step(){
    var ok;
    if (__state === 'attached') ok = !!el && el.isConnected;
    else if (__state === 'detached') ok = !el || !el.isConnected;
    else if (__state === 'visible') ok = __vis();
    else ok = !el || !el.isConnected || !__vis();
    if (ok) { resolve(JSON.stringify({ ok: true, evidence: 'waited for ' + __state })); return; }
    if (Date.now() - __start > __timeout) { reject(new Error(${js(LOCATOR_TIMEOUT)} + ': waiting for ' + __state)); return; }
    setTimeout(step, 50);
  }
  step();
});`,
};

// ---------------------------------------------------------------------------
// READ bodies — function strings with signature (els, arg)
// ---------------------------------------------------------------------------

function needEls(verb: string): string {
  return `if (!els || !els.length) { throw new Error(${js(`${LOCATOR_NOT_FOUND}: ${verb}: element did not resolve`)}); } var el = els[0];`;
}

/** Read bodies. Each is a function body `(els, arg) => { ... }` whose final
 *  statement returns `JSON.stringify(value)` (the raw read value). */
export const READ: Record<string, string> = {
  count: `els = els || []; return JSON.stringify(els.length);`,

  innerText: `${needEls('innerText')}
var t = (el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent) || '';
return JSON.stringify(t);`,

  textContent: `${needEls('textContent')}
return JSON.stringify(el.textContent === null || el.textContent === undefined ? null : el.textContent);`,

  allTextContents: `els = els || []; return JSON.stringify(els.map(function (e) { return e.textContent === null || e.textContent === undefined ? '' : e.textContent; }));`,

  getAttribute: `${needEls('getAttribute')}
return JSON.stringify(el.getAttribute(String(arg)));`,

  inputValue: `${needEls('inputValue')}
var tag = (el.tagName || '').toLowerCase();
if (tag === 'select') { var o = el.options && el.options[el.selectedIndex]; return JSON.stringify(o ? (o.value !== '' ? o.value : (o.text || '')) : ''); }
if (el.isContentEditable) return JSON.stringify(el.textContent || '');
return JSON.stringify(el.value === null || el.value === undefined ? '' : String(el.value));`,

  isVisible: `${needEls('isVisible')}
if (el.checkVisibility) { return JSON.stringify(el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); }
var r = el.getBoundingClientRect();
var cs = window.getComputedStyle(el);
var box = (r.width > 0 && r.height > 0) || el.getClientRects().length > 0;
var vis = box && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.visibility !== 'collapse' && parseFloat(cs.opacity || '1') > 0;
return JSON.stringify(vis);`,

  isEnabled: `${needEls('isEnabled')}
var dis = el.disabled === true || (el.getAttribute && el.getAttribute('aria-disabled') === 'true');
if (!dis && el.closest) { var f = el.closest('fieldset[disabled], [disabled]'); if (f && f !== el && ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'OPTION', 'OPTGROUP'].indexOf((el.tagName || '').toUpperCase()) >= 0) dis = f.disabled === true || f.hasAttribute('disabled'); }
return JSON.stringify(!dis);`,

  boundingBox: `${needEls('boundingBox')}
var r = el.getBoundingClientRect();
return JSON.stringify({ x: r.left, y: r.top, width: r.width, height: r.height });`,
};

// ---------------------------------------------------------------------------
// Composition helpers used by the extension backend
// ---------------------------------------------------------------------------

/**
 * Compose a locator spec with an {@link ACT} verb into one expression:
 * resolves the first matching element and runs the action body with
 * `(el, arg)`. Throws `LOCATOR_NOT_FOUND`-marked errors on a miss.
 */
export function buildActionExpression(spec: LocatorSpec, verb: string, arg?: unknown): string {
  const body = ACT[verb];
  if (!body) throw new Error(`Unsupported action verb: ${verb}`);
  return `(() => {\n  var __els = ${buildElementsExpression(spec)};\n  var __el = __els.length ? __els[0] : null;\n  return ((el, arg) => {\n${body}\n})(__el, ${js(arg)});\n})()`;
}

/** Compose a locator spec with a {@link READ} verb into one JSON expression. */
export function buildReadExpression(spec: LocatorSpec, verb: string, arg?: unknown): string {
  const body = READ[verb];
  if (!body) throw new Error(`Unsupported read verb: ${verb}`);
  return `(() => { return ((els, arg) => {\n${body}\n})(${buildElementsExpression(spec)}, ${js(arg)}); })()`;
}
