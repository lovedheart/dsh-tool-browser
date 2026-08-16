/**
 * LocatorView — the model-facing chainable locator (Playwright subset, strict
 * mode). Ported from QwenPaw's `browser/runtime/locator.py` + LocatorView.
 * SUBAGENT A implements; this pins the surface. Actions return `.evidence`.
 */

export interface LocatorView {
  // compose / scope (chainable)
  getByRole(role: string, opts?: { name?: string }): LocatorView;
  getByText(text: string): LocatorView;
  getByLabel(text: string): LocatorView;
  getByPlaceholder(text: string): LocatorView;
  filter(opts: { hasText?: string }): LocatorView;
  nth(i: number): LocatorView;
  readonly first: LocatorView;
  readonly last: LocatorView;

  // read (await)
  count(): Promise<number>;
  innerText(): Promise<string>;
  textContent(): Promise<string | null>;
  allTextContents(): Promise<string[]>;
  getAttribute(name: string): Promise<string | null>;
  inputValue(): Promise<string>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;

  // act (await; returns { evidence })
  click(): Promise<{ evidence: string }>;
  fill(value: string): Promise<{ evidence: string }>;
  type(text: string): Promise<{ evidence: string }>;
  press(key: string): Promise<{ evidence: string }>;
  check(): Promise<{ evidence: string }>;
  uncheck(): Promise<{ evidence: string }>;
  setChecked(b: boolean): Promise<{ evidence: string }>;
  selectOption(...values: string[]): Promise<{ evidence: string }>;
  hover(): Promise<{ evidence: string }>;
  dblclick(): Promise<{ evidence: string }>;
  scroll(): Promise<{ evidence: string }>;
  focus(): Promise<{ evidence: string }>;
  blur(): Promise<{ evidence: string }>;
  clear(): Promise<{ evidence: string }>;
  waitFor(state: 'visible' | 'hidden' | 'attached' | 'detached', timeoutMs?: number): Promise<void>;
  screenshot(): Promise<{ path: string }>;
}

/** Bind a LocatorView to a backend locator handle. Subagent A implements. */
export interface LocatorFactory {
  create(backendLocator: import('../backend/ports.ts').BackendLocator): LocatorView;
}
