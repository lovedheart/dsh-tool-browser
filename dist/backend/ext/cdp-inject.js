/**
 * Page-side injection engine for the CDP-over-Chrome-extension backend.
 *
 * Ported concept from QwenPaw cdp_verbs.py; implemented DOM-side for DSH.
 *
 * The extension backend has no Playwright objects inside the page: every
 * locator operation must be translated into a self-contained snippet of
 * JavaScript evaluated in the page context via
 * `Runtime.evaluate({ returnByValue: true, awaitPromise: true })`. This module
 * compiles a declarative {@link LocatorSpec} into such snippets and provides
 * the per-verb ACT / READ fragments that run against the resolved element(s).
 *
 * Host composition shape (chrome-extension.ts):
 *   `(function(){ const el = <buildLocatorExpression(spec)>;
 *      if (!el) throw Error('LOCATOR_NOT_FOUND');
 *      return (<ACT fragment>)(el); })()`
 * with `awaitPromise: true` (fragments may return a Promise, e.g. waitFor).
 *
 * Conventions:
 *   - {@link buildLocatorExpression} evaluates to a single Element or null
 *     (first match; multi-match ambiguity is tolerated, not thrown, matching
 *     the lenient behavior of the Playwright wrapper, and recorded on
 *     `globalThis.__dshAmbiguousLocator` for diagnostics);
 *   - {@link buildLocatorListExpression} evaluates to an Element[] — used by
 *     count/allTextContents reads;
 *   - every action/read fragment returns `JSON.stringify(payload)`, so the
 *     host can uniformly JSON.parse the evaluation result;
 *   - a missing element throws `Error` whose message contains the fixed
 *     marker {@link LOCATOR_NOT_FOUND}; the host maps that marker to a
 *     governed `BrowserError` (category RETRYABLE, cause `locator_not_found`).
 *
 * The generated code has no external dependencies: plain DOM APIs plus a
 * small ARIA-heuristic table (implicit roles + accessible names).
 */
/** Fixed marker in thrown messages so the host can map to a governed error. */
export const LOCATOR_NOT_FOUND = 'LOCATOR_NOT_FOUND';
/** Fixed marker for in-page waits that gave up. */
export const LOCATOR_TIMEOUT = 'LOCATOR_TIMEOUT';
/** Serialize a value as a JS literal safe to splice into generated code. */
function js(v) {
    return JSON.stringify(v === undefined ? null : v);
}
/** Wrap a body into a self-contained `(el) => { ... }` fragment string. */
function fn(body, param = 'el') {
    return `((${param}) => {\n${body}\n})`;
}
/** In-fragment null guard (the host also guards; this keeps fragments safe standalone). */
function need(verb) {
    return `if (!el || !(el instanceof Element)) { throw new Error(${js(`${LOCATOR_NOT_FOUND}: ${verb}: element did resolve to null`)}); }`;
}
// ---------------------------------------------------------------------------
// Shared in-page helpers (emitted inside the locator IIFEs)
// ---------------------------------------------------------------------------
const HELPERS = `
function __norm(s){ return String(s === null || s === undefined ? '' : s).replace(/\\s+/g, ' ').trim(); }
function __lc(s){ return __norm(s).toLowerCase(); }
function __roleOf(el){
  var r = el.getAttribute ? el.getAttribute('role') : null;
  if (r) return __lc(r);
  var t = (el.tagName || '').toLowerCase();
  if (t === 'input') {
    var ty = (el.getAttribute('type') || '').toLowerCase();
    var im = { checkbox: 'checkbox', radio: 'radio', submit: 'button', reset: 'button',
      image: 'button', button: 'button', file: 'button' };
    if (Object.prototype.hasOwnProperty.call(im, ty)) return im[ty];
    if (ty === 'search') return 'searchbox';
    if (ty === 'range') return 'slider';
    if (ty === 'number') return 'spinbutton';
    return 'textbox';
  }
  // Minimal implicit-role table (button/link/textbox/checkbox/radio/heading/
  // combobox); everything else falls back to the explicit role attribute.
  var m = { button: 'button', a: 'link', textarea: 'textbox', select: 'combobox',
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
function compileBase(spec) {
    switch (spec.kind) {
        case 'css':
            return `(function(){ var __n = Array.prototype.slice.call(document.querySelectorAll(${js(spec.selector ?? '*')})); if (__n.length > 1) { try { globalThis.__dshAmbiguousLocator = { selector: ${js(spec.selector ?? '')}, count: __n.length }; } catch (e) {} } return __n; })()`;
        case 'frame':
            // Simplification: the iframe's whole document as the base set; further
            // narrowing happens through filters.
            return `(function(){ var __f = document.querySelector(${js(spec.selector ?? '')}); var __d = __f ? __f.contentDocument : null; return __d ? Array.prototype.slice.call(__d.querySelectorAll('*')) : []; })()`;
        case 'text':
            return `(function(){ var wl = __lc(${js(spec.text ?? '')}); if (!wl) return []; var all = (document.body ? [document.body] : []).concat(Array.prototype.slice.call(document.querySelectorAll('body *'))); var scored = []; for (var i = 0; i < all.length; i++) { var e = all[i]; var t = __lc(e.textContent); if (!t) continue; var hit = t === wl ? 0 : (t.indexOf(wl) >= 0 ? 1 : -1); if (hit >= 0) scored.push([hit, e]); } var leaves = scored.filter(function (p) { return !scored.some(function (q) { return q[1] !== p[1] && p[1].contains(q[1]); }); }); leaves.sort(function (a, b) { return a[0] - b[0]; }); return leaves.map(function (p) { return p[1]; }); })()`;
        case 'role': {
            const nameExpr = spec.name === undefined ? 'null' : `__lc(${js(spec.name)})`;
            return `(function(){ var want = ${js((spec.role ?? '').toLowerCase())}; var nl = ${nameExpr}; var all = Array.prototype.slice.call(document.querySelectorAll('*')); var inRole = all.filter(function (e) { return __roleOf(e) === want; }); if (!nl) return inRole; var exact = inRole.filter(function (e) { return __lc(__nameOf(e)) === nl; }); if (exact.length) return exact; return inRole.filter(function (e) { return __lc(__nameOf(e)).indexOf(nl) >= 0; }); })()`;
        }
        case 'label':
            return `(function(){ var wl = __lc(${js(spec.text ?? '')}); var out = []; function add(e, score){ if (!e || score < 0) return; for (var k = 0; k < out.length; k++) { if (out[k][1] === e) { if (score < out[k][0]) out[k][0] = score; return; } } out.push([score, e]); } function sc(s){ return s === wl ? 0 : (wl && s.indexOf(wl) >= 0 ? 1 : -1); } var labels = Array.prototype.slice.call(document.querySelectorAll('label')); labels.forEach(function (l) { var s = sc(__lc(l.textContent)); if (s < 0) return; if (l.htmlFor) add(document.getElementById(l.htmlFor), s); var cs = l.querySelectorAll('input,select,textarea,button,[contenteditable="true"]'); for (var i = 0; i < cs.length; i++) add(cs[i], s); }); Array.prototype.slice.call(document.querySelectorAll('[aria-label]')).forEach(function (e) { add(e, sc(__lc(e.getAttribute('aria-label')))); }); Array.prototype.slice.call(document.querySelectorAll('[aria-labelledby]')).forEach(function (e) { var ids = String(e.getAttribute('aria-labelledby') || '').split(/\\s+/); var t = __lc(ids.map(function (id) { var n = document.getElementById(id); return n ? (n.textContent || '') : ''; }).join(' ')); add(e, sc(t)); }); Array.prototype.slice.call(document.querySelectorAll('input,textarea,select,button,[contenteditable="true"]')).forEach(function (e) { if (e.labels && e.labels.length) add(e, sc(__lc(e.labels[0].textContent))); }); out.sort(function (a, b) { return a[0] - b[0]; }); return out.map(function (p) { return p[1]; }); })()`;
        case 'placeholder':
            return `(function(){ var wl = __lc(${js(spec.text ?? '')}); if (!wl) return []; var scored = []; var all = Array.prototype.slice.call(document.querySelectorAll('input[placeholder], textarea[placeholder]')); all.forEach(function (e) { var p = __lc(e.getAttribute('placeholder')); var hit = p === wl ? 0 : (p.indexOf(wl) >= 0 ? 1 : -1); if (hit >= 0) scored.push([hit, e]); }); scored.sort(function (a, b) { return a[0] - b[0]; }); return scored.map(function (p) { return p[1]; }); })()`;
        default:
            throw new Error(`Unsupported locator kind: ${String(spec.kind)}`);
    }
}
/** Compile filters + nth/first/last tail lines acting on the `__els` array. */
function compileTail(spec) {
    const parts = [];
    for (const f of spec.filters ?? []) {
        if (f.hasText !== undefined) {
            parts.push(`__els = __els.filter(function (e) { return (e.textContent || '').indexOf(${js(f.hasText)}) >= 0; });`);
        }
    }
    if (spec.nth !== undefined) {
        const idx = `${js(spec.nth)}`;
        parts.push(`__els = (${idx}) >= 0 ? (${idx} < __els.length ? [__els[${idx}]] : []) : (((__els.length + (${idx})) >= 0 && (__els.length + (${idx})) < __els.length) ? [__els[__els.length + (${idx})]] : []);`);
    }
    if (spec.first)
        parts.push('__els = __els.slice(0, 1);');
    if (spec.last)
        parts.push('__els = __els.length ? [__els[__els.length - 1]] : [];');
    return parts.join('\n  ');
}
function needsHelpers(spec) {
    return spec.kind === 'role' || spec.kind === 'text' || spec.kind === 'label' || spec.kind === 'placeholder';
}
/**
 * Build an IIFE snippet evaluating to a single Element or `null` (first
 * match; ambiguity tolerated and recorded, matching the Playwright wrapper's
 * lenient behavior). `base` is reserved for a future frame-scope prefix and
 * is currently ignored.
 */
export function buildLocatorExpression(spec, base) {
    void base;
    const helpers = needsHelpers(spec) ? HELPERS : '';
    return `(() => {\n  ${helpers}\n  var __els = ${compileBase(spec)};\n  ${compileTail(spec)}\n  return __els.length ? __els[0] : null;\n})()`;
}
/** Build an IIFE snippet evaluating to an Element[] (possibly empty). */
export function buildLocatorListExpression(spec) {
    const helpers = needsHelpers(spec) ? HELPERS : '';
    return `(() => {\n  ${helpers}\n  var __els = ${compileBase(spec)};\n  ${compileTail(spec)}\n  return __els;\n})()`;
}
// ---------------------------------------------------------------------------
// In-fragment preambles (each fragment is standalone — no cross-scope helpers)
// ---------------------------------------------------------------------------
/** Element-descriptor helper (`tag#id.class`). */
const DESC = `function __d(e){ var t = (e.tagName || '').toLowerCase(); var cl = ''; try { cl = (e.getAttribute('class') || '').trim(); } catch (_) {} var cls = cl ? '.' + cl.split(/\\s+/).join('.') : ''; return t + (e.id ? '#' + e.id : '') + cls; }`;
/** Scroll-into-view + center-point + pointer/mouse dispatch helpers. */
const POINTERS = `el.scrollIntoView ? el.scrollIntoView({ block: 'center', inline: 'nearest' }) : null;
var __r = el.getBoundingClientRect(); var __x = Math.round((__r.left + __r.right) / 2); var __y = Math.round((__r.top + __r.bottom) / 2);
var __t = document.elementFromPoint(__x, __y) || el;
function __me(type, detail){ __t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: __x, clientY: __y, button: 0, detail: detail || 1 })); }
function __pe(type, detail){ if (typeof PointerEvent === 'function') { __t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: __x, clientY: __y, button: 0, detail: detail || 1, pointerId: 1, pointerType: 'mouse', isPrimary: true })); } else { __me(type, detail); } }`;
/** React-compatible value setter (native setter + input/change events). */
const VALUE_SETTER = `function __setValue(node, v){ var proto = (typeof HTMLTextAreaElement !== 'undefined' && node instanceof HTMLTextAreaElement) ? HTMLTextAreaElement.prototype : (typeof HTMLInputElement !== 'undefined' && node instanceof HTMLInputElement) ? HTMLInputElement.prototype : (typeof HTMLSelectElement !== 'undefined' && node instanceof HTMLSelectElement) ? HTMLSelectElement.prototype : HTMLElement.prototype; var d = Object.getOwnPropertyDescriptor(proto, 'value'); if (node.isContentEditable) { node.textContent = String(v); } else if (d && d.set) { d.set.call(node, String(v)); } else { node.value = String(v); } node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }`;
/** focus() helper that never throws on odd elements. */
const FOCUS = `if (el.focus) { try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (__) {} } }`;
function checkBody(verb, wantLit) {
    return `${need(verb)}
var want = ${wantLit};
function __input(e){ var t = (e.tagName || '').toLowerCase(); if (t === 'input' && (e.type === 'checkbox' || e.type === 'radio')) return e; if (e.querySelector) { var i = e.querySelector('input[type=checkbox],input[type=radio]'); if (i) return i; } return null; }
var input = __input(el);
var cur = input ? !!input.checked : (el.getAttribute ? el.getAttribute('aria-checked') === 'true' : false);
if (cur !== want) {
  if (input) { input.click(); }
  else { el.setAttribute('aria-checked', want ? 'true' : 'false'); el.dispatchEvent(new Event('change', { bubbles: true })); }
}
var now = input ? !!input.checked : (el.getAttribute ? el.getAttribute('aria-checked') === 'true' : want);
return JSON.stringify({ ok: true, evidence: now === want ? (want ? 'checked' : 'unchecked') : 'check-state-mismatch' });`;
}
// ---------------------------------------------------------------------------
// ACT — (el) => JSON string of { ok, evidence }
// ---------------------------------------------------------------------------
/**
 * Action fragments. Zero-arg verbs are plain function-string constants;
 * parameterized verbs are functions returning a function string with the
 * argument inlined as a literal. Each fragment is a `(el) => ...` expression
 * whose result is `JSON.stringify({ ok, evidence })` (or a Promise thereof,
 * for waitFor — the host evaluates with awaitPromise: true).
 */
export const ACT = {
    click: fn(`${need('click')}
${DESC}
${POINTERS}
__pe('pointerover'); __me('mouseover'); __pe('pointerdown'); __me('mousedown'); __pe('pointerup'); __me('mouseup'); __me('click');
return JSON.stringify({ ok: true, evidence: 'clicked ' + __d(el) + ' at (' + __x + ',' + __y + ')' });`),
    dblclick: fn(`${need('dblclick')}
${DESC}
${POINTERS}
__pe('pointerdown'); __me('mousedown', 1); __pe('pointerup'); __me('mouseup', 1); __me('click', 1);
__pe('pointerdown'); __me('mousedown', 2); __pe('pointerup'); __me('mouseup', 2); __me('click', 2); __me('dblclick', 2);
return JSON.stringify({ ok: true, evidence: 'double-clicked ' + __d(el) + ' at (' + __x + ',' + __y + ')' });`),
    hover: fn(`${need('hover')}
${DESC}
${POINTERS}
__pe('pointerover'); __pe('pointerenter'); __me('mouseover'); __me('mousemove'); __pe('pointermove');
return JSON.stringify({ ok: true, evidence: 'hovered ' + __d(el) + ' at (' + __x + ',' + __y + ')' });`),
    scroll: fn(`${need('scroll')}
${DESC}
if (el.scrollIntoView) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); }
return JSON.stringify({ ok: true, evidence: 'scrolled into view ' + __d(el) });`),
    focus: fn(`${need('focus')}
${DESC}
${FOCUS}
return JSON.stringify({ ok: true, evidence: 'focused ' + __d(el) });`),
    blur: fn(`${need('blur')}
${DESC}
if (el.blur) { el.blur(); }
return JSON.stringify({ ok: true, evidence: 'blurred ' + __d(el) });`),
    clear: fn(`${need('clear')}
${DESC}
${VALUE_SETTER}
${FOCUS}
__setValue(el, '');
return JSON.stringify({ ok: true, evidence: 'cleared' });`),
    fill: (value) => fn(`${need('fill')}
${DESC}
${VALUE_SETTER}
${FOCUS}
var __v = ${js(value)};
__setValue(el, __v);
if (el.setSelectionRange) { try { var __l = String(el.value === undefined ? '' : el.value).length; el.setSelectionRange(__l, __l); } catch (_) {} }
return JSON.stringify({ ok: true, evidence: 'filled ' + JSON.stringify(__v) + ' into ' + __d(el) });`),
    type: (text) => fn(`${need('type')}
${VALUE_SETTER}
${FOCUS}
var __s = ${js(text)};
for (var __i = 0; __i < __s.length; __i++) {
  var __ch = __s[__i];
  el.dispatchEvent(new KeyboardEvent('keydown', { key: __ch, bubbles: true, cancelable: true }));
  __setValue(el, (el.isContentEditable ? (el.textContent || '') : String(el.value === undefined ? '' : el.value)) + __ch);
  el.dispatchEvent(new KeyboardEvent('keyup', { key: __ch, bubbles: true, cancelable: true }));
}
return JSON.stringify({ ok: true, evidence: 'typed ' + JSON.stringify(__s) });`),
    press: (key) => fn(`${need('press')}
${DESC}
var __key = ${js(key)};
var __parts = __key.split('+');
var __k = __parts.length > 1 ? __parts[__parts.length - 1].trim() : __key;
var __mods = (__parts.length > 1 ? __parts.slice(0, -1).join('+') : '').toLowerCase();
if (__k === 'Space') __k = ' ';
${FOCUS}
var __o = { key: __k, code: 'Key' + __k.toUpperCase(), bubbles: true, cancelable: true, composed: true,
  ctrlKey: __mods.indexOf('ctrl') >= 0, altKey: __mods.indexOf('alt') >= 0,
  shiftKey: __mods.indexOf('shift') >= 0 || /[A-Z]/.test(__k), metaKey: __mods.indexOf('meta') >= 0 || __mods.indexOf('cmd') >= 0 };
el.dispatchEvent(new KeyboardEvent('keydown', __o));
el.dispatchEvent(new KeyboardEvent('keyup', __o));
return JSON.stringify({ ok: true, evidence: 'pressed ' + ${js(JSON.stringify(key))} });`),
    check: fn(checkBody('check', 'true')),
    uncheck: fn(checkBody('uncheck', 'false')),
    setChecked: (b) => fn(checkBody('setChecked', b ? 'true' : 'false')),
    selectOption: (values) => fn(`${need('selectOption')}
var __vals = ${js(values.map(String))};
if ((el.tagName || '').toLowerCase() !== 'select') { throw new Error(${js(`${LOCATOR_NOT_FOUND}: selectOption: resolved element is not a <select>`)} + ' <' + (el.tagName || '') + '>'); }
function __norm2(s){ return String(s == null ? '' : s).trim().toLowerCase(); }
var __hits = [];
for (var __i = 0; __i < el.options.length; __i++) {
  var __o = el.options[__i];
  var __ot = String(__o.text == null ? '' : __o.text).trim();
  __hits.push(__vals.some(function (v) { return __o.value === v || __norm2(__ot) === __norm2(v) || __ot.indexOf(String(v)) >= 0; }));
}
var __first = __hits.indexOf(true);
if (__first < 0) { throw new Error(${js(`${LOCATOR_NOT_FOUND}: selectOption: no option matched `)} + JSON.stringify(__vals)); }
if (el.multiple) { for (var __j = 0; __j < el.options.length; __j++) { el.options[__j].selected = __hits[__j]; } }
else { el.selectedIndex = __first; }
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
return JSON.stringify({ ok: true, evidence: 'selected ' + JSON.stringify(__vals.join('", "')) });`),
    waitFor: (state = 'visible', timeoutMs = 5000) => fn(`${need('waitFor')}
var __state = ${js(state)}; var __timeout = ${js(timeoutMs)}; var __start = Date.now();
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
});`),
};
// ---------------------------------------------------------------------------
// READ — (el) => JSON string of the read value
// ---------------------------------------------------------------------------
/** Normalize an el-or-list param into a (possibly empty) element array. */
const TO_ARRAY = `var __list = el == null ? [] : (Array.isArray(el) ? el.filter(function (x) { return !!x; }) : [el]);`;
/** Normalize to a first element, lenient (reads that return a falsy default). */
const FIRST = `if (Array.isArray(el)) el = el.length ? el[0] : null;`;
/**
 * Read fragments. Each is a `(el) => ...` fragment returning
 * `JSON.stringify(value)`; count/allTextContents/isVisible/isEnabled/
 * boundingBox accept a single element, an element array, or null.
 */
export const READ = {
    count: fn(`${TO_ARRAY}
return JSON.stringify(__list.length);`),
    allTextContents: fn(`${TO_ARRAY}
return JSON.stringify(__list.map(function (e) { return e.textContent == null ? '' : e.textContent; }));`),
    innerText: fn(`${FIRST}
${need('innerText')}
var t = (el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent) || '';
return JSON.stringify(t);`),
    textContent: fn(`${FIRST}
${need('textContent')}
return JSON.stringify(el.textContent === null || el.textContent === undefined ? null : el.textContent);`),
    getAttribute: (name) => fn(`${FIRST}
${need('getAttribute')}
return JSON.stringify(el.getAttribute(${js(name)}));`),
    inputValue: fn(`${FIRST}
${need('inputValue')}
var tag = (el.tagName || '').toLowerCase();
if (tag === 'select') { var o = el.options && el.options[el.selectedIndex]; return JSON.stringify(o ? (o.value !== '' ? o.value : (o.text || '')) : ''); }
if (el.isContentEditable) return JSON.stringify(el.textContent || '');
return JSON.stringify(el.value === null || el.value === undefined ? '' : String(el.value));`),
    isVisible: fn(`${FIRST}
if (!el || !(el instanceof Element)) { return JSON.stringify(false); }
if (el.checkVisibility) { return JSON.stringify(el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); }
var r = el.getBoundingClientRect();
var cs = window.getComputedStyle(el);
var box = (r.width > 0 && r.height > 0) || el.getClientRects().length > 0;
var vis = box && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.visibility !== 'collapse' && parseFloat(cs.opacity || '1') > 0;
return JSON.stringify(vis);`),
    isEnabled: fn(`${FIRST}
if (!el || !(el instanceof Element)) { return JSON.stringify(false); }
var dis = el.disabled === true || (el.getAttribute && el.getAttribute('aria-disabled') === 'true');
if (!dis && el.closest && ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'OPTION', 'OPTGROUP'].indexOf((el.tagName || '').toUpperCase()) >= 0) {
  var f = el.closest('fieldset[disabled],[disabled]');
  if (f && f !== el) dis = f.disabled === true || f.hasAttribute('disabled');
}
return JSON.stringify(!dis);`),
    boundingBox: fn(`${FIRST}
if (!el || !(el instanceof Element)) { return JSON.stringify(null); }
var r = el.getBoundingClientRect();
return JSON.stringify({ x: r.left, y: r.top, width: r.width, height: r.height });`),
};
/**
 * Compose a locator spec with an {@link ACT} verb into one host-shaped
 * expression: resolves the first matching element (throwing a
 * LOCATOR_NOT_FOUND-marked Error on a miss) and runs the action fragment with
 * `(el)`. Parameterized ACT entries take `arg` and bake it into the fragment.
 */
export function buildActionExpression(spec, verb, arg) {
    const table = ACT;
    const entry = table[verb];
    if (entry === undefined)
        throw new Error(`Unsupported action verb: ${verb}`);
    const frag = typeof entry === 'function'
        ? entry(arg)
        : entry;
    return `(function(){ var el = ${buildLocatorExpression(spec)};
if (!el) { throw new Error(${js(`${LOCATOR_NOT_FOUND}: ${verb}: element did not resolve`)}); }
return (${frag})(el); })()`;
}
/**
 * Compose a locator spec with a {@link READ} verb into one JSON expression.
 * count/allTextContents receive the full element list; all other reads get
 * the first element (arrays tolerated by every read fragment).
 */
export function buildReadExpression(spec, verb, arg) {
    const table = READ;
    const entry = table[verb];
    if (entry === undefined)
        throw new Error(`Unsupported read verb: ${verb}`);
    const frag = typeof entry === 'function'
        ? entry(arg)
        : entry;
    const sel = (verb === 'count' || verb === 'allTextContents')
        ? buildLocatorListExpression(spec)
        : buildLocatorExpression(spec);
    return `(function(){ return (${frag})(${sel}); })()`;
}
