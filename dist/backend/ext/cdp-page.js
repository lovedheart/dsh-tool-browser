/**
 * A page of the chrome-extension backend: BackendPage translated into CDP
 * calls over the NM bridge (chrome.debugger). Port of the verb layer of
 * QwenPaw's `control_link/chrome/cdp_verbs.py`, where rich DOM semantics
 * (locator resolution, act/read) are injected page-side via ./cdp-inject.ts.
 */
import { BrowserError } from "../../governance/errors.js";
import { buildLocatorExpression, buildActionExpression, buildReadExpression } from "./cdp-inject.js";
const KEY_CODEMAP = {
    Enter: { windows: { keyCode: 13, code: 'Enter' }, text: '\r' },
    Tab: { windows: { keyCode: 9, code: 'Tab' } },
    Backspace: { windows: { keyCode: 8, code: 'Backspace' } },
    Escape: { windows: { keyCode: 27, code: 'Escape' } },
    ArrowUp: { windows: { keyCode: 38, code: 'ArrowUp' } },
    ArrowDown: { windows: { keyCode: 40, code: 'ArrowDown' } },
    ArrowLeft: { windows: { keyCode: 37, code: 'ArrowLeft' } },
    ArrowRight: { windows: { keyCode: 39, code: 'ArrowRight' } },
    Home: { windows: { keyCode: 36, code: 'Home' } },
    End: { windows: { keyCode: 35, code: 'End' } },
    Delete: { windows: { keyCode: 46, code: 'Delete' } },
};
function keyToCdp(key) {
    if (key.length === 1) {
        const ch = key;
        const upper = ch.toUpperCase();
        const code = /[A-Z0-9]/.test(upper)
            ? `Key${upper}`
            : ch === ' '
                ? 'Space'
                : `Key${upper}`;
        const keyCode = upper.charCodeAt(0);
        return { type: 'keyDown', keyCode, code, text: ch };
    }
    const m = KEY_CODEMAP[key];
    if (!m) {
        throw new BrowserError({
            category: 'API_MISUSE',
            cause: 'api_misuse',
            reason: `unsupported key "${key}" (single chars or Enter/Tab/Escape/arrow keys)`,
        });
    }
    return { type: 'keyDown', ...m.windows, ...(m.text ? { text: m.text } : {}) };
}
export class ExtPage {
    session;
    id;
    constructor(session, id) {
        this.session = session;
        this.id = id;
    }
    cdp(method, params = {}) {
        return this.session.cdp(this.id, method, params);
    }
    evalJson(expression, awaitPromise = false) {
        return this.session.evaluateJson(this.id, expression, awaitPromise);
    }
    async goto(url) {
        const nav = await this.cdp('Page.navigate', { url }).catch((e) => e);
        if (nav instanceof Error) {
            throw new BrowserError({ category: 'RETRYABLE', cause: 'navigation_failed', reason: `navigation to ${url} failed: ${nav.message}` });
        }
        if (nav.errorText) {
            throw new BrowserError({ category: 'RETRYABLE', cause: 'navigation_failed', reason: `navigation to ${url} failed: ${nav.errorText}` });
        }
        await this.waitForLoadState('load').catch(() => undefined);
        return { url };
    }
    async goBack() {
        await this.evalJson('history.back()');
        await this.waitForLoadState('load').catch(() => undefined);
        return { ok: true };
    }
    async goForward() {
        await this.evalJson('history.forward()');
        await this.waitForLoadState('load').catch(() => undefined);
        return { ok: true };
    }
    async reload() {
        await this.cdp('Page.reload', {});
        await this.waitForLoadState('load').catch(() => undefined);
        return { ok: true };
    }
    /** Poll document.readyState via JS (no event stream dependence). */
    async waitForLoadState(state, timeoutMs = 30_000) {
        const want = state === 'domcontentloaded' ? 'domcontentloaded' : 'complete';
        const expr = `(async()=>{const want=${JSON.stringify(want)};const deadline=Date.now()+${timeoutMs};
      while(document.readyState!=='complete'&&want==='domcontentloaded'&&document.readyState!=='interactive'){
        if(Date.now()>deadline)throw new Error('load state timeout');await new Promise(r=>setTimeout(r,50));}
      if(want==='complete'){while(document.readyState!=='complete'){if(Date.now()>deadline)throw new Error('load state timeout');await new Promise(r=>setTimeout(r,50));}}
      return document.readyState;})()`;
        try {
            await this.evalJson(expr, true);
        }
        catch (e) {
            if (e instanceof BrowserError && /load state timeout/.test(e.reason)) {
                throw new BrowserError({ category: 'RETRYABLE', cause: 'timeout', reason: `page did not reach ${state} within ${timeoutMs} ms` });
            }
            throw e;
        }
    }
    async snapshot(query) {
        const pageText = await this.evalJson('document.body ? document.body.innerText : ""').catch(() => '');
        const elements = await this.evalJson(`(${READ_SNAPSHOT_JS})()`).catch(() => undefined);
        if (query !== undefined) {
            const q = query.toLowerCase();
            const match_count = pageText.split('\n').filter((l) => l.toLowerCase().includes(q)).length;
            return { text: pageText, elements, match_count };
        }
        return { text: pageText, elements };
    }
    async currentSurface() {
        const v = await this.evalJson('({url: location.href, title: document.title, ready: document.readyState})');
        const load_state = v.ready === 'complete' ? 'load' : v.ready === 'interactive' ? 'domcontentloaded' : v.ready;
        return { url: v.url, title: v.title, load_state };
    }
    async screenshot() {
        const file = this.session.path(`browser_shot_${this.id}_${Date.now()}.png`);
        return this.session.screenshotTo(this.id, file);
    }
    async input(kind, verb, opts) {
        if (kind === 'mouse' && (verb === 'down' || verb === 'move' || verb === 'up')) {
            const x = Number(opts.x ?? 0);
            const y = Number(opts.y ?? 0);
            const type = verb === 'down' ? 'mousePressed' : verb === 'up' ? 'mouseReleased' : 'mouseMoved';
            await this.cdp('Input.dispatchMouseEvent', {
                type, x, y, button: verb === 'move' ? 'none' : 'left', clickCount: 0,
                buttons: verb === 'up' ? 0 : verb === 'down' ? 1 : 1,
            });
            return { evidence: `mouse.${verb} (${x},${y})` };
        }
        if (kind === 'mouse' && verb === 'click') {
            const x = Number(opts.x ?? 0);
            const y = Number(opts.y ?? 0);
            for (const type of ['mousePressed', 'mouseReleased']) {
                await this.cdp('Input.dispatchMouseEvent', {
                    type,
                    x,
                    y,
                    button: 'left',
                    clickCount: 1,
                    buttons: type === 'mousePressed' ? 1 : 0,
                });
            }
            return { evidence: `clicked (${x},${y})` };
        }
        if (kind === 'mouse' && verb === 'wheel') {
            await this.cdp('Input.dispatchMouseEvent', {
                type: 'mouseWheel',
                x: Number(opts.x ?? 500),
                y: Number(opts.y ?? 400),
                deltaX: Number(opts.delta_x ?? 0),
                deltaY: Number(opts.delta_y ?? 300),
            });
            return { evidence: `scrolled ${Number(opts.delta_y ?? 300)}` };
        }
        if (kind === 'keyboard' && verb === 'press') {
            const k = keyToCdp(String(opts.key ?? 'Enter'));
            await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', keyCode: k.keyCode, code: k.code, ...(k.text ? { text: k.text } : {}) });
            await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', keyCode: k.keyCode, code: k.code });
            return { evidence: `pressed ${String(opts.key ?? 'Enter')}` };
        }
        throw new BrowserError({ category: 'API_MISUSE', cause: 'api_misuse', reason: `unsupported input ${kind}.${verb}` });
    }
    locator(spec) {
        return new ExtLocator(this.session, this.id, spec, undefined);
    }
    frameLocator(selector) {
        // Cross-origin frames are out of scope for the extension transport (same
        // limitation as QwenPaw's same-origin injected engine); same-origin frames
        // are reachable via contentDocument traversal in the injected chain.
        return new ExtLocator(this.session, this.id, { kind: 'frame', selector }, undefined);
    }
    async close() {
        await this.session.closePage(this.id);
    }
}
/** A locator chain: spec is compiled into an injected JS expression on use. */
class ExtLocator {
    session;
    pageId;
    spec;
    base;
    constructor(session, pageId, spec, base) {
        this.session = session;
        this.pageId = pageId;
        this.spec = spec;
        this.base = base;
    }
    derived(patch) {
        return new ExtLocator(this.session, this.pageId, { ...this.spec, ...patch }, this.base);
    }
    // -- compose ------------------------------------------------------------
    getByRole(role, name) {
        return this.derived({ kind: 'role', role, name });
    }
    getByText(text) {
        return this.derived({ kind: 'text', text });
    }
    getByLabel(text) {
        return this.derived({ kind: 'label', text });
    }
    getByPlaceholder(text) {
        return this.derived({ kind: 'placeholder', text });
    }
    filter(opts) {
        return this.derived({ filters: [...(this.spec.filters ?? []), opts] });
    }
    nth(i) {
        return this.derived({ nth: i });
    }
    get first() {
        return this.derived({ first: true });
    }
    get last() {
        return this.derived({ last: true });
    }
    // -- evaluation helpers ---------------------------------------------------
    expr() {
        return buildLocatorExpression(this.spec, this.base);
    }
    async runAct(verb, arg) {
        return this.guard(async () => {
            const out = await this.session.evaluateJson(this.pageId, buildActionExpression(this.spec, verb, arg), true);
            return JSON.parse(String(out));
        });
    }
    async runRead(verb, arg) {
        return this.guard(async () => {
            const out = await this.session.evaluateJson(this.pageId, buildReadExpression(this.spec, verb, arg), true);
            return JSON.parse(String(out));
        });
    }
    async guard(fn) {
        try {
            return await fn();
        }
        catch (e) {
            if (e instanceof BrowserError && /LOCATOR_NOT_FOUND/.test(e.reason)) {
                throw new BrowserError({
                    category: 'RETRYABLE',
                    cause: 'locator_not_found',
                    reason: 'no element matched the locator',
                    suggested_action: 'snapshot() to inspect the page, then adjust role/name/selector.',
                });
            }
            throw e;
        }
    }
    // -- read ---------------------------------------------------------------
    count() {
        return this.runRead('count');
    }
    innerText() {
        return this.runRead('innerText');
    }
    textContent() {
        return this.runRead('textContent');
    }
    allTextContents() {
        return this.runRead('allTextContents');
    }
    getAttribute(name) {
        return this.runRead('getAttribute', name);
    }
    inputValue() {
        return this.runRead('inputValue');
    }
    isVisible() {
        return this.runRead('isVisible');
    }
    isEnabled() {
        return this.runRead('isEnabled');
    }
    boundingBox() {
        return this.runRead('boundingBox');
    }
    // -- act ------------------------------------------------------------------
    click() {
        return this.runAct('click');
    }
    fill(value) {
        return this.runAct('fill', value);
    }
    type(text) {
        return this.runAct('type', text);
    }
    press(key) {
        return this.runAct('press', key);
    }
    check() {
        return this.runAct('setChecked', true);
    }
    uncheck() {
        return this.runAct('setChecked', false);
    }
    setChecked(b) {
        return this.runAct('setChecked', b);
    }
    selectOption(...values) {
        return this.runAct('selectOption', values);
    }
    hover() {
        return this.runAct('hover');
    }
    dblclick() {
        return this.runAct('dblclick');
    }
    scroll() {
        return this.runAct('scroll');
    }
    focus() {
        return this.runAct('focus');
    }
    blur() {
        return this.runAct('blur');
    }
    clear() {
        return this.runAct('clear');
    }
    waitFor(state, timeoutMs = 5000) {
        return this.guard(async () => {
            await this.session.evaluateJson(this.pageId, `(async()=>{const el=${this.expr()};const state=${JSON.stringify(state)};const deadline=Date.now()+${timeoutMs};
          const ok=()=>{switch(state){case 'attached':return !!el;case 'detached':return !el;case 'visible':return !!el&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length>0);case 'hidden':return !el||!(el.offsetWidth||el.offsetHeight||el.getClientRects().length);}};
          while(!ok()){if(Date.now()>deadline)throw new Error('LOCATOR_NOT_FOUND');await new Promise(r=>setTimeout(r,50));}return true;})()`, true);
        });
    }
    async screenshot() {
        const box = await this.boundingBox();
        const file = this.session.path(`browser_shot_${this.pageId}_loc_${Date.now()}.png`);
        if (!box) {
            throw new BrowserError({ category: 'RETRYABLE', cause: 'locator_not_found', reason: 'locator has no box to screenshot' });
        }
        const shot = await this.session.cdp(this.pageId, 'Page.captureScreenshot', {
            format: 'png',
            clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
        });
        if (!shot?.data)
            throw new BrowserError({ category: 'RETRYABLE', cause: 'internal', reason: 'locator screenshot returned no data' });
        const { writeFileSync, mkdirSync } = await import('node:fs');
        mkdirSync(this.session.workspaceDir, { recursive: true });
        writeFileSync(file, Buffer.from(shot.data, 'base64'));
        return { path: file };
    }
}
/** Page-side aria-lite extractor producing ObservedElement-shaped rows. */
const READ_SNAPSHOT_JS = `() => {
  const rows = [];
  const INTERACTIVE = 'a,button,input,select,textarea,[role],[contenteditable="true"],img,h1,h2,h3,h4,h5,h6';
  const seen = new Set();
  const visit = (root) => {
    let nodes;
    try { nodes = root.querySelectorAll(INTERACTIVE); } catch { return; }
    for (const el of nodes) {
      if (seen.has(el)) continue; seen.add(el);
      const rect = el.getBoundingClientRect();
      const role = el.getAttribute('role') ||
        ({ A: 'link', BUTTON: 'button', INPUT: { text: 'textbox', checkbox: 'checkbox', radio: 'radio', submit: 'button' }, SELECT: 'combobox', TEXTAREA: 'textbox' }[el.tagName] && ({ INPUT: { text: 'textbox', checkbox: 'checkbox', radio: 'radio', submit: 'button' } }[el.tagName] || { A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox' }[el.tagName] || el.tagName.toLowerCase())) ||
        (/^H[1-6]$/.test(el.tagName) ? 'heading' : el.tagName === 'NAV' ? 'navigation' : el.tagName === 'MAIN' ? 'main' : '');
      const name = el.getAttribute('aria-label') || el.getAttribute('alt') ||
        (el.labels && el.labels[0] ? el.labels[0].textContent.trim() : '') ||
        (el.tagName === 'A' || el.tagName === 'BUTTON' ? (el.textContent || '').trim().slice(0, 80) : '');
      const text = (el.textContent || '').trim().slice(0, 120);
      if (!role && !name && !text) continue;
      if (!rect.width && !rect.height && !el.isConnected) continue;
      rows.push({ role, name, text, ref_id: 'e' + rows.length });
      if (rows.length >= 400) return;
    }
    for (const f of root.querySelectorAll('iframe')) {
      try { if (f.contentDocument) visit(f.contentDocument); } catch { /* cross-origin */ }
    }
  };
  if (document.body) visit(document.body);
  return rows;
}`;
