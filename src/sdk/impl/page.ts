/**
 * Concrete Page implementation — wraps a BackendPage.
 * Ported from QwenPaw's `browser/sdk/page.py` Page class.
 */

import type { ActionEvidence, CurrentSurface, Observation } from '../contracts.ts';
import type { InputSurface, Page, PageFactory } from '../page.ts';
import type { LocatorView } from '../locator.ts';
import { createLocatorFactory } from './locator.ts';
import type { BackendPage, LocatorSpec } from '../../backend/ports.ts';
import { raceAbort } from '../../kernel/run-control.ts';
import { currentRunSignal } from '../../kernel/run-context.ts';

/** Run a backend op under the current run's abort signal (see locator.ts). */
function op<T>(p: Promise<T>): Promise<T> {
  return raceAbort(p, currentRunSignal()) as Promise<T>;
}

/** Concrete Page bound to one BackendPage handle. */
export class PageImpl implements Page {
  readonly id: string;
  readonly mouse: InputSurface;
  readonly keyboard: InputSurface;

  private readonly backend: BackendPage;
  private readonly locatorFactory = createLocatorFactory();

  constructor(backendPage: BackendPage) {
    this.backend = backendPage;
    this.id = backendPage.id;

    const bp = backendPage;
    this.mouse = {
      click: (x: number, y: number) =>
        op(bp.input('mouse', 'click', { x, y })) as Promise<ActionEvidence>,
      press: (key: string) =>
        op(bp.input('mouse', 'press', { key })) as Promise<ActionEvidence>,
      wheel: (deltaX?: number, deltaY?: number) =>
        op(bp.input('mouse', 'wheel', { delta_x: deltaX ?? 0, delta_y: deltaY ?? 0 })) as Promise<ActionEvidence>,
    };
    this.keyboard = {
      click: (x: number, y: number) =>
        op(bp.input('keyboard', 'click', { x, y })) as Promise<ActionEvidence>,
      press: (key: string) =>
        op(bp.input('keyboard', 'press', { key })) as Promise<ActionEvidence>,
      wheel: (deltaX?: number, deltaY?: number) =>
        op(bp.input('keyboard', 'wheel', { delta_x: deltaX ?? 0, delta_y: deltaY ?? 0 })) as Promise<ActionEvidence>,
    };
  }

  // ── navigation ──────────────────────────────────────────────────────

  /** Navigate to url. */
  async goto(url: string): Promise<Record<string, unknown>> {
    return op(this.backend.goto(url));
  }

  /** Navigate back in history. */
  async goBack(): Promise<Record<string, unknown>> {
    return op(this.backend.goBack());
  }

  /** Navigate forward in history. */
  async goForward(): Promise<Record<string, unknown>> {
    return op(this.backend.goForward());
  }

  /** Reload the current page. */
  async reload(): Promise<Record<string, unknown>> {
    return op(this.backend.reload());
  }

  /** Retain this page across response cycles for the current chat. */
  async keep(): Promise<void> {
    // No-op at the SDK level; the kernel handles pinning.
  }

  // ── waiting ─────────────────────────────────────────────────────────

  /**
   * Wait for a fixed duration (capped at 30 s). Cooperative with the run's
   * abort signal: a budget abort cuts the wait short (AbortError) instead of
   * letting it run to the cap.
   */
  async waitForTimeout(ms: number): Promise<void> {
    await raceAbort(
      new Promise<void>((r) => setTimeout(r, Math.min(ms, 30_000))),
      currentRunSignal(),
    );
  }

  /** Wait for the page to reach a load state. */
  async waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle', timeoutMs?: number): Promise<void> {
    await op(this.backend.waitForLoadState(state ?? 'load', timeoutMs));
  }

  // ── perception ──────────────────────────────────────────────────────

  /** Capture a screenshot; returns { path }. */
  async screenshot(): Promise<{ path: string }> {
    return op(this.backend.screenshot());
  }

  /** Perceive page text (+ optional query match count). */
  async snapshot(query?: string): Promise<Observation> {
    return op(this.backend.snapshot(query));
  }

  /** Report current url/title/load_state. */
  async currentSurface(): Promise<CurrentSurface> {
    return op(this.backend.currentSurface());
  }

  // ── locating (semantic first) ───────────────────────────────────────

  /** Locate by ARIA role and optional accessible name. */
  getByRole(role: string, opts?: { name?: string }): LocatorView {
    const spec: LocatorSpec = { kind: 'role', role, name: opts?.name };
    return this.locatorFactory.create(this.backend.locator(spec));
  }

  /** Locate by visible text content. */
  getByText(text: string): LocatorView {
    const spec: LocatorSpec = { kind: 'text', text };
    return this.locatorFactory.create(this.backend.locator(spec));
  }

  /** Locate by associated label text. */
  getByLabel(text: string): LocatorView {
    const spec: LocatorSpec = { kind: 'label', text };
    return this.locatorFactory.create(this.backend.locator(spec));
  }

  /** Locate by placeholder text. */
  getByPlaceholder(text: string): LocatorView {
    const spec: LocatorSpec = { kind: 'placeholder', text };
    return this.locatorFactory.create(this.backend.locator(spec));
  }

  /** Locate by CSS selector. */
  locator(css: string): LocatorView {
    const spec: LocatorSpec = { kind: 'css', selector: css };
    return this.locatorFactory.create(this.backend.locator(spec));
  }

  /** Scope into an iframe by selector. */
  frameLocator(selector: string): LocatorView {
    return this.locatorFactory.create(this.backend.frameLocator(selector));
  }
}

/** Factory that binds a Page to a backend page handle. */
export function createPageFactory(): PageFactory {
  return {
    create(backendPage: BackendPage): Page {
      return new PageImpl(backendPage);
    },
  };
}
