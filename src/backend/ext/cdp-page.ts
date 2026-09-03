/**
 * A page of the chrome-extension backend: BackendPage translated into CDP
 * calls over the NM bridge (chrome.debugger). Port of the verb layer of
 * QwenPaw's `control_link/chrome/cdp_verbs.py`, where rich DOM semantics
 * (locator resolution, act/read) are injected page-side via ./cdp-inject.ts.
 */

import { BrowserError } from '../../governance/errors.ts';
import type { BackendLocator, BackendPage, LocatorSpec } from '../ports.ts';
import type { CurrentSurface, Observation } from '../../sdk/contracts.ts';
import type { ExtSession } from '../chrome-extension.ts';
import { buildLocatorExpression, ACT, READ } from './cdp-inject.ts';

const KEY_CODEMAP: Record<string, { windows: { keyCode: number; code: string }; text?: string }> = {
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

function keyToCdp(key: string): { type: string; keyCode: number; code: string; text?: string } {
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

export class ExtPage implements BackendPage {
  constructor(private readonly session: ExtSession, readonly id: string) {}

  private cdp<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.session.cdp<T>(this.id, method, params);
  }

  private evalJson<T>(expression: string, awaitPromise = false): Promise<T> {
    return this.session.evaluateJson<T>(this.id, expression, awaitPromise);
  }

  async goto(url: string): Promise<Record<string, unknown>> {
    const nav = await this.cdp<{ errorText?: string }>('Page.navigate', { url }).catch((e) => e);
    if (nav instanceof Error) {
      throw new BrowserError({ category: 'RETRYABLE', cause: 'navigation_failed', reason: `navigation to ${url} failed: ${nav.message}` });
    }
    if (nav.errorText) {
      throw new BrowserError({ category: 'RETRYABLE', cause: 'navigation_failed', reason: `navigation to ${url} failed: ${nav.errorText}` });
    }
    await this.waitForLoadState('load').catch(() => undefined);
    return { url };
  }

  async goBack(): Promise<Record<string, unknown>> {
    await this.evalJson('history.back()');
    await this.waitForLoadState('load').catch(() => undefined);
    return { ok: true };
  }

  async goForward(): Promise<Record<string, unknown>> {
    await this.evalJson('history.forward()');
    await this.waitForLoadState('load').catch(() => undefined);
    return { ok: true };
  }

  async reload(): Promise<Record<string, unknown>> {
    await this.cdp('Page.reload', {});
    await this.waitForLoadState('load').catch(() => undefined);
    return { ok: true };
  }

  /** Poll document.readyState via JS (no event stream dependence). */
  async waitForLoadState(state: string, timeoutMs = 30_000): Promise<void> {
    const want = state === 'domcontentloaded' ? 'domcontentloaded' : 'complete';
    const expr = `(async()=>{const want=${JSON.stringify(want)};const deadline=Date.now()+${timeoutMs};
      while(document.readyState!=='complete'&&want==='domcontentloaded'&&document.readyState!=='interactive'){
        if(Date.now()>deadline)throw new Error('load state timeout');await new Promise(r=>setTimeout(r,50));}
      if(want==='complete'){while(document.readyState!=='complete'){if(Date.now()>deadline)throw new Error('load state timeout');await new Promise(r=>setTimeout(r,50));}}
      return document.readyState;})()`;
    try {
      await this.evalJson(expr, true);
    } catch (e) {
      if (e instanceof BrowserError && /load state timeout/.test(e.reason)) {
        throw new BrowserError({ category: 'RETRYABLE', cause: 'timeout', reason: `page did not reach ${state} within ${timeoutMs} ms` });
      }
      throw e;
    }
  }

  async snapshot(query?: string): Promise<Observation> {
    const pageText = await this.evalJson<string>('document.body ? document.body.innerText : ""').catch(() => '');
    const elements = await this.evalJson<
      Array<{ role: string; name: string; text: string; ref_id?: string }>
    >(`(${READ_SNAPSHOT_JS})()`).catch(() => undefined);
    if (query !== undefined) {
      const q = query.toLowerCase();
      const match_count = pageText.split('\n').filter((l) => l.toLowerCase().includes(q)).length;
      return { text: pageText, elements, match_count };
    }
    return { text: pageText, elements };
  }

  async currentSurface(): Promise<CurrentSurface> {
    const v = await this.evalJson<{ url: string; title: string; ready: string }>(
      '({url: location.href, title: document.title, ready: document.readyState})',
    );
    const load_state = v.ready === 'complete' ? 'load' : v.ready === 'interactive' ? 'domcontentloaded' : v.ready;
    return { url: v.url, title: v.title, load_state };
  }

  async screenshot(): Promise<{ path: string }> {
    const file = this.session.path(`browser_shot_${this.id}_${Date.now()}.png`);
    return this.session.screenshotTo(this.id, file);
  }

  async input(
    kind: 'mouse' | 'keyboard',
    verb: 'click' | 'press' | 'wheel',
    opts: { x?: number; y?: number; key?: string; delta_x?: number; delta_y?: number },
  ): Promise<Record<string, unknown>> {
    if (kind === 'mouse' && verb === 'click') {
      const x = Number(opts.x ?? 0);
      const y = Number(opts.y ?? 0);
      for (const type of ['mousePressed', 'mouseReleased'] as const) {
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

  locator(spec: LocatorSpec): BackendLocator {
    return new ExtLocator(this.session, this.id, spec, undefined);
  }

  frameLocator(selector: string): BackendLocator {
    // Cross-origin frames are out of scope for the extension transport (same
    // limitation as QwenPaw's same-origin injected engine); same-origin frames
    // are reachable via contentDocument traversal in the injected chain.
    return new ExtLocator(this.session, this.id, { kind: 'frame', selector }, undefined);
  }

  async close(): Promise<void> {
    await this.session.closePage(this.id);
  }
}

/** A locator chain: spec is compiled into an injected JS expression on use. */
class ExtLocator implements BackendLocator {
  constructor(
    private readonly session: ExtSession,
    private readonly pageId: string,
    private readonly spec: LocatorSpec,
    private readonly base?: string,
  ) {}

  private derived(patch: Partial<LocatorSpec>): ExtLocator {
    return new ExtLocator(this.session, this.pageId, { ...this.spec, ...patch }, this.base);
  }

  // -- compose ------------------------------------------------------------
  getByRole(role: string, name?: string): BackendLocator {
    return this.derived({ kind: 'role', role, name });
  }
  getByText(text: string): BackendLocator {
    return this.derived({ kind: 'text', text });
  }
  getByLabel(text: string): BackendLocator {
    return this.derived({ kind: 'label', text });
  }
  getByPlaceholder(text: string): BackendLocator {
    return this.derived({ kind: 'placeholder', text });
  }
  filter(opts: { hasText?: string }): BackendLocator {
    return this.derived({ filters: [...(this.spec.filters ?? []), opts] });
  }
  nth(i: number): BackendLocator {
    return this.derived({ nth: i });
  }
  get first(): BackendLocator {
    return this.derived({ first: true });
  }
  get last(): BackendLocator {
    return this.derived({ last: true });
  }

  // -- evaluation helpers ---------------------------------------------------
  private expr(): string {
    return buildLocatorExpression(this.spec, this.base);
  }

  private async runAct(fragment: string): Promise<{ evidence: string }> {
    const wrapped = `(function(){const el=${this.expr()};if(!el)throw new Error('LOCATOR_NOT_FOUND');return (${fragment})(el);})()`;
    return this.guard(async () => {
      const evidence = await this.session.evaluateJson<string>(this.pageId, wrapped, true);
      return { evidence: String(evidence) };
    });
  }

  private async runRead<T>(fragment: string, all = false): Promise<T> {
    const wrapped = `(function(){const __el=${this.expr()};if(!__el&&!${all})throw new Error('LOCATOR_NOT_FOUND');return (${fragment})(__el);})()`;
    return this.guard(() => this.session.evaluateJson<T>(this.pageId, wrapped, true));
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
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
  count(): Promise<number> {
    return this.runRead<number>(READ.count, true);
  }
  innerText(): Promise<string> {
    return this.runRead<string>(READ.innerText);
  }
  textContent(): Promise<string | null> {
    return this.runRead<string | null>(READ.textContent);
  }
  allTextContents(): Promise<string[]> {
    return this.runRead<string[]>(READ.allTextContents, true);
  }
  getAttribute(name: string): Promise<string | null> {
    return this.runRead<string | null>(READ.getAttribute(name));
  }
  inputValue(): Promise<string> {
    return this.runRead<string>(READ.inputValue);
  }
  isVisible(): Promise<boolean> {
    return this.runRead<boolean>(READ.isVisible, true);
  }
  isEnabled(): Promise<boolean> {
    return this.runRead<boolean>(READ.isEnabled, true);
  }
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.runRead(READ.boundingBox, true);
  }

  // -- act ------------------------------------------------------------------
  click(): Promise<{ evidence: string }> {
    return this.runAct(ACT.click);
  }
  fill(value: string): Promise<{ evidence: string }> {
    return this.runAct(ACT.fill(value));
  }
  type(text: string): Promise<{ evidence: string }> {
    return this.runAct(ACT.type(text));
  }
  press(key: string): Promise<{ evidence: string }> {
    return this.runAct(ACT.press(key));
  }
  check(): Promise<{ evidence: string }> {
    return this.runAct(ACT.setChecked(true));
  }
  uncheck(): Promise<{ evidence: string }> {
    return this.runAct(ACT.setChecked(false));
  }
  setChecked(b: boolean): Promise<{ evidence: string }> {
    return this.runAct(ACT.setChecked(b));
  }
  selectOption(...values: string[]): Promise<{ evidence: string }> {
    return this.runAct(ACT.selectOption(values));
  }
  hover(): Promise<{ evidence: string }> {
    return this.runAct(ACT.hover);
  }
  dblclick(): Promise<{ evidence: string }> {
    return this.runAct(ACT.dblclick);
  }
  scroll(): Promise<{ evidence: string }> {
    return this.runAct(ACT.scroll);
  }
  focus(): Promise<{ evidence: string }> {
    return this.runAct(ACT.focus);
  }
  blur(): Promise<{ evidence: string }> {
    return this.runAct(ACT.blur);
  }
  clear(): Promise<{ evidence: string }> {
    return this.runAct(ACT.clear);
  }
  waitFor(state: 'visible' | 'hidden' | 'attached' | 'detached', timeoutMs = 5000): Promise<void> {
    return this.guard(async () => {
      await this.session.evaluateJson(
        this.pageId,
        `(async()=>{const el=${this.expr()};const state=${JSON.stringify(state)};const deadline=Date.now()+${timeoutMs};
          const ok=()=>{switch(state){case 'attached':return !!el;case 'detached':return !el;case 'visible':return !!el&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length>0);case 'hidden':return !el||!(el.offsetWidth||el.offsetHeight||el.getClientRects().length);}};
          while(!ok()){if(Date.now()>deadline)throw new Error('LOCATOR_NOT_FOUND');await new Promise(r=>setTimeout(r,50));}return true;})()`,
        true,
      );
    });
  }
  async screenshot(): Promise<{ path: string }> {
    const box = await this.boundingBox();
    const file = this.session.path(`browser_shot_${this.pageId}_loc_${Date.now()}.png`);
    if (!box) {
      throw new BrowserError({ category: 'RETRYABLE', cause: 'locator_not_found', reason: 'locator has no box to screenshot' });
    }
    const shot = await this.session.cdp<{ data?: string }>(this.pageId, 'Page.captureScreenshot', {
      format: 'png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
    });
    if (!shot?.data) throw new BrowserError({ category: 'RETRYABLE', cause: 'internal', reason: 'locator screenshot returned no data' });
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
