/**
 * Shared page + locator wrappers for Playwright-based backends.
 *
 * Both the managed-Chromium Playwright backend (`playwright.ts`) and the
 * user-Chrome-over-CDP backend (`chrome-cdp.ts`) drive the same Playwright
 * `Page` / `Locator` / `FrameLocator` objects. To avoid duplicating ~360 lines
 * of wrapper logic across the two backends, the shared {@link PlaywrightPage}
 * and {@link PlaywrightLocator} classes live here and are imported by both.
 */

import type { FrameLocator, Locator, Page } from 'playwright';
import * as path from 'node:path';
import { BrowserError } from '../governance/errors.ts';
import type {
  BackendLocator,
  BackendPage,
  LocatorSpec,
} from './ports.ts';
import type { CurrentSurface, Observation } from '../sdk/contracts.ts';

// ---------------------------------------------------------------------------
// BackendLocator wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a Playwright `Locator` / `FrameLocator` into the backend's
 * {@link BackendLocator} interface. Read-only composition helpers; each
 * action returns a short evidence line.
 */
export class PlaywrightLocator implements BackendLocator {
  constructor(
    private readonly loc: Locator | FrameLocator,
    private readonly workspaceDir: string,
    private readonly id: string,
  ) {}

  // -- compose / scope ------------------------------------------------------

  getByRole(role: string, name?: string): BackendLocator {
    const l = (this.loc as Locator).getByRole(role as never, name ? { name } : {});
    return new PlaywrightLocator(l, this.workspaceDir, this.id);
  }

  getByText(text: string): BackendLocator {
    const l = (this.loc as Locator).getByText(text);
    return new PlaywrightLocator(l, this.workspaceDir, this.id);
  }

  getByLabel(text: string): BackendLocator {
    const l = (this.loc as Locator).getByLabel(text);
    return new PlaywrightLocator(l, this.workspaceDir, this.id);
  }

  getByPlaceholder(text: string): BackendLocator {
    const l = (this.loc as Locator).getByPlaceholder(text);
    return new PlaywrightLocator(l, this.workspaceDir, this.id);
  }

  filter(opts: { hasText?: string }): BackendLocator {
    const l = (this.loc as Locator).filter(opts);
    return new PlaywrightLocator(l, this.workspaceDir, this.id);
  }

  nth(i: number): BackendLocator {
    const l = (this.loc as Locator).nth(i);
    return new PlaywrightLocator(l, this.workspaceDir, this.id);
  }

  get first(): BackendLocator {
    const l = (this.loc as Locator).first();
    return new PlaywrightLocator(l, this.workspaceDir, this.id);
  }

  get last(): BackendLocator {
    const l = (this.loc as Locator).last();
    return new PlaywrightLocator(l, this.workspaceDir, this.id);
  }

  // -- read -----------------------------------------------------------------

  async count(): Promise<number> {
    return (this.loc as Locator).count();
  }

  async innerText(): Promise<string> {
    return (this.loc as Locator).innerText();
  }

  async textContent(): Promise<string | null> {
    return (this.loc as Locator).textContent();
  }

  async allTextContents(): Promise<string[]> {
    return (this.loc as Locator).allTextContents();
  }

  async getAttribute(name: string): Promise<string | null> {
    return (this.loc as Locator).getAttribute(name);
  }

  async inputValue(): Promise<string> {
    return (this.loc as Locator).inputValue();
  }

  async isVisible(): Promise<boolean> {
    return (this.loc as Locator).isVisible();
  }

  async isEnabled(): Promise<boolean> {
    return (this.loc as Locator).isEnabled();
  }

  async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return (this.loc as Locator).boundingBox();
  }

  // -- act ------------------------------------------------------------------

  async click(): Promise<{ evidence: string }> {
    await (this.loc as Locator).click();
    return { evidence: 'clicked' };
  }

  async fill(value: string): Promise<{ evidence: string }> {
    await (this.loc as Locator).fill(value);
    return { evidence: `filled "${value}"` };
  }

  async type(text: string): Promise<{ evidence: string }> {
    await (this.loc as Locator).pressSequentially(text);
    return { evidence: `typed "${text}"` };
  }

  async press(key: string): Promise<{ evidence: string }> {
    await (this.loc as Locator).press(key);
    return { evidence: `pressed "${key}"` };
  }

  async check(): Promise<{ evidence: string }> {
    await (this.loc as Locator).check();
    return { evidence: 'checked' };
  }

  async uncheck(): Promise<{ evidence: string }> {
    await (this.loc as Locator).uncheck();
    return { evidence: 'unchecked' };
  }

  async setChecked(b: boolean): Promise<{ evidence: string }> {
    if (b) await (this.loc as Locator).check();
    else await (this.loc as Locator).uncheck();
    return { evidence: b ? 'checked' : 'unchecked' };
  }

  async selectOption(...values: string[]): Promise<{ evidence: string }> {
    await (this.loc as Locator).selectOption({ value: values[0] });
    return { evidence: `selected "${values[0]}"` };
  }

  async hover(): Promise<{ evidence: string }> {
    await (this.loc as Locator).hover();
    return { evidence: 'hovered' };
  }

  async dblclick(): Promise<{ evidence: string }> {
    await (this.loc as Locator).dblclick();
    return { evidence: 'double-clicked' };
  }

  async scroll(): Promise<{ evidence: string }> {
    await (this.loc as Locator).evaluate((el) => el.scrollIntoView());
    return { evidence: 'scrolled into view' };
  }

  async focus(): Promise<{ evidence: string }> {
    await (this.loc as Locator).focus();
    return { evidence: 'focused' };
  }

  async blur(): Promise<{ evidence: string }> {
    await (this.loc as Locator).blur();
    return { evidence: 'blurred' };
  }

  async clear(): Promise<{ evidence: string }> {
    await (this.loc as Locator).fill('');
    return { evidence: 'cleared' };
  }

  async waitFor(
    state: 'visible' | 'hidden' | 'attached' | 'detached',
    timeoutMs?: number,
  ): Promise<void> {
    await (this.loc as Locator).waitFor({ state, timeout: timeoutMs });
  }

  async screenshot(): Promise<{ path: string }> {
    const ts = Date.now();
    const file = path.join(this.workspaceDir, `browser_shot_${this.id}_loc_${ts}.png`);
    await (this.loc as Locator).screenshot({ path: file });
    return { path: file };
  }
}

// ---------------------------------------------------------------------------
// BackendPage wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a Playwright `Page` into the backend's {@link BackendPage} interface.
 * Both backends (managed Chromium and CDP-attached Chrome) use this, so the
 * navigation, snapshot, screenshot, input and locator-resolution logic is
 * identical across them.
 */
export class PlaywrightPage implements BackendPage {
  readonly id: string;

  constructor(
    readonly page: Page,
    id: string,
    private readonly workspaceDir: string,
  ) {
    this.id = id;
  }

  /** Navigate to url; returns raw navigation facts. */
  async goto(url: string): Promise<Record<string, unknown>> {
    try {
      await this.page.goto(url);
      return { url: this.page.url(), ok: true };
    } catch (e) {
      throw new BrowserError({
        category: 'RETRYABLE',
        cause: 'navigation_failed',
        reason: `Navigation to ${url} failed`,
        detail: e instanceof Error ? e.message : String(e),
        suggested_action: 'Check the URL and retry, or navigate to a different page.',
      });
    }
  }

  /** Go back in history. */
  async goBack(): Promise<Record<string, unknown>> {
    try {
      await this.page.goBack();
      return { url: this.page.url(), ok: true };
    } catch (e) {
      throw new BrowserError({
        category: 'RETRYABLE',
        cause: 'navigation_failed',
        reason: 'goBack failed',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Go forward in history. */
  async goForward(): Promise<Record<string, unknown>> {
    try {
      await this.page.goForward();
      return { url: this.page.url(), ok: true };
    } catch (e) {
      throw new BrowserError({
        category: 'RETRYABLE',
        cause: 'navigation_failed',
        reason: 'goForward failed',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Reload the current page. */
  async reload(): Promise<Record<string, unknown>> {
    try {
      await this.page.reload();
      return { url: this.page.url(), ok: true };
    } catch (e) {
      throw new BrowserError({
        category: 'RETRYABLE',
        cause: 'navigation_failed',
        reason: 'reload failed',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Wait for a load state. */
  async waitForLoadState(state: string, timeoutMs?: number): Promise<void> {
    await this.page.waitForLoadState(state as 'load' | 'domcontentloaded' | 'networkidle', {
      timeout: timeoutMs,
    });
  }

  /** Perceive: page text (+ optional query match count). */
  async snapshot(query?: string): Promise<Observation> {
    let text = '';
    try {
      text = await this.page.locator('body').innerText();
    } catch {
      text = '';
    }
    if (query !== undefined) {
      const q = query.toLowerCase();
      const match_count = text
        .split('\n')
        .filter((line) => line.toLowerCase().includes(q)).length;
      return { text, match_count };
    }
    return { text };
  }

  /** Current surface info. */
  async currentSurface(): Promise<CurrentSurface> {
    return {
      url: this.page.url(),
      title: await this.page.title(),
      load_state: 'load',
    };
  }

  /** Screenshot to a PNG in the workspace; returns { path }. */
  async screenshot(): Promise<{ path: string }> {
    const ts = Date.now();
    const file = path.join(this.workspaceDir, `browser_shot_${this.id}_${ts}.png`);
    await this.page.screenshot({ path: file });
    return { path: file };
  }

  /** Coordinate/keyboard input. */
  async input(
    kind: 'mouse' | 'keyboard',
    verb: 'click' | 'press' | 'wheel',
    opts: { x?: number; y?: number; key?: string; delta_x?: number; delta_y?: number },
  ): Promise<Record<string, unknown>> {
    if (kind === 'mouse' && verb === 'click') {
      await this.page.mouse.click(opts.x ?? 0, opts.y ?? 0);
      return { evidence: `mouse.click(${opts.x ?? 0}, ${opts.y ?? 0})`, ok: true, kind, verb };
    } else if (kind === 'mouse' && verb === 'wheel') {
      await this.page.mouse.wheel(opts.delta_x ?? 0, opts.delta_y ?? 0);
      return { evidence: `mouse.wheel(${opts.delta_x ?? 0}, ${opts.delta_y ?? 0})`, ok: true, kind, verb };
    } else if (kind === 'keyboard' && verb === 'press') {
      await this.page.keyboard.press(opts.key ?? '');
      return { evidence: `keyboard.press("${opts.key ?? ''}")`, ok: true, kind, verb };
    }
    return { evidence: `${kind}.${verb} (no-op)`, ok: false, kind, verb };
  }

  /** Resolve a locator spec to a backend locator handle. */
  locator(spec: LocatorSpec): BackendLocator {
    let loc: Locator;
    switch (spec.kind) {
      case 'css':
        loc = this.page.locator(spec.selector!);
        break;
      case 'role':
        loc = this.page.getByRole(spec.role! as never, spec.name ? { name: spec.name } : {});
        break;
      case 'text':
        loc = this.page.getByText(spec.text!);
        break;
      case 'label':
        loc = this.page.getByLabel(spec.text!);
        break;
      case 'placeholder':
        loc = this.page.getByPlaceholder(spec.text!);
        break;
      default:
        throw new BrowserError({
          category: 'API_MISUSE',
          cause: 'api_misuse',
          reason: `Unsupported locator kind: ${spec.kind}`,
        });
    }
    // Apply filters in order
    if (spec.filters) {
      for (const f of spec.filters) {
        loc = loc.filter(f);
      }
    }
    if (spec.nth !== undefined) loc = loc.nth(spec.nth);
    if (spec.first) loc = loc.first();
    if (spec.last) loc = loc.last();
    return new PlaywrightLocator(loc, this.workspaceDir, this.id);
  }

  /** Create a frame locator wrapper. */
  frameLocator(selector: string): BackendLocator {
    const fl = this.page.frameLocator(selector);
    return new PlaywrightLocator(fl, this.workspaceDir, this.id);
  }

  /** Close this page. */
  async close(): Promise<void> {
    await this.page.close();
  }
}
