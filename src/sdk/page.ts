/**
 * Per-page operations — the model-facing `Page`. Ported from QwenPaw's
 * `browser/sdk/page.py`. SUBAGENT A implements; this pins the surface.
 */

import type {
  Observation,
  CurrentSurface,
  ActionEvidence,
} from './contracts.ts';
import type { LocatorView } from './locator.ts';
import type { BackendPage } from '../backend/ports.ts';

/** Coordinate/keyboard input surface (page.mouse / page.keyboard). */
export interface InputSurface {
  click(x: number, y: number): Promise<ActionEvidence>;
  press(key: string): Promise<ActionEvidence>;
  wheel(deltaX?: number, deltaY?: number): Promise<ActionEvidence>;
  /**
   * Press-drag-release from (x1,y1) to (x2,y2) with a human-like trail:
   * eased steps, small lateral jitter, dwells at the ends. For sliders,
   * puzzle drags, reorder handles.
   */
  drag(x1: number, y1: number, x2: number, y2: number, opts?: { steps?: number; durationMs?: number }): Promise<ActionEvidence>;
}

export interface Page {
  readonly id: string;
  /** Viewport-coordinate mouse input. */
  readonly mouse: InputSurface;
  /** Keyboard input. */
  readonly keyboard: InputSurface;

  // navigation
  goto(url: string): Promise<Record<string, unknown>>;
  goBack(): Promise<Record<string, unknown>>;
  goForward(): Promise<Record<string, unknown>>;
  reload(): Promise<Record<string, unknown>>;
  /** Retain this page across response cycles for the current chat. */
  keep(): Promise<void>;

  // waiting
  waitForTimeout(ms: number): Promise<void>; // capped at 30000
  waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle', timeoutMs?: number): Promise<void>;

  // perception
  screenshot(): Promise<{ path: string }>;
  snapshot(query?: string): Promise<Observation>;
  currentSurface(): Promise<CurrentSurface>;

  // locating (semantic first)
  getByRole(role: string, opts?: { name?: string }): LocatorView;
  getByText(text: string): LocatorView;
  getByLabel(text: string): LocatorView;
  getByPlaceholder(text: string): LocatorView;
  locator(css: string): LocatorView;
  frameLocator(selector: string): LocatorView;
}

/** Bind a Page to a backend page handle. Subagent A implements. */
export interface PageFactory {
  create(backendPage: BackendPage): Page;
}
