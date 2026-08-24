/**
 * Shared SDK data contracts, ported from QwenPaw's `browser/sdk/contracts.py`.
 * These are the value shapes the model reads back from Browser/Page/Locator
 * calls. Kept dependency-free so kernel, backend, and sdk all import them.
 */

/**
 * A single element from the page's accessibility tree, ported from QwenPaw's
 * `ObservedElement` (browser/sdk/contracts.py).
 */
export interface ObservedElement {
  /** ARIA role, e.g. 'button', 'heading', 'textbox'. */
  readonly role: string;
  /** Accessible name of the element. */
  readonly name: string;
  /** Visible text content (for leaf nodes like paragraphs). */
  readonly text: string;
  /** Stable reference id from the aria snapshot (e.g. 'e12'), if available. */
  readonly ref_id?: string;
}

/** Result of `page.snapshot()` — the primary perception surface. */
export interface Observation {
  /** Page text (accessibility/DOM derived). */
  readonly text: string;
  /**
   * Structured elements extracted from the accessibility tree via
   * `page.ariaSnapshot({ mode: 'ai' })`. Each element carries its role,
   * accessible name, visible text, and a stable `ref_id` for follow-up.
   * May be empty if the page has no accessible structure yet.
   */
  readonly elements?: ObservedElement[];
  /** When a `query` was passed: how many lines matched. */
  readonly match_count?: number;
}

/** Result of `page.current_surface()`. */
export interface CurrentSurface {
  readonly url: string;
  readonly title: string;
  readonly load_state: 'load' | 'domcontentloaded' | 'networkidle' | string;
}

/** A page reference returned by `browser.pages()` / used by switch/close_page. */
export interface PageRef {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly active: boolean;
}

/** Result of `browser.session_status()`. */
export interface SessionStatus {
  readonly owner: { workspace_id: string; session_id: string };
  readonly variant: string; // resolved backend, e.g. 'playwright' | 'chrome'
  readonly context: string; // 'auto' | explicit
  readonly connected: boolean;
}

/** The owner scoping one stateful kernel (workspace + session). */
export interface Owner {
  readonly workspace_id: string;
  readonly session_id: string;
}

/** Short evidence line returned by locator actions (`result.evidence`). */
export interface ActionEvidence {
  readonly evidence: string;
  [key: string]: unknown;
}
