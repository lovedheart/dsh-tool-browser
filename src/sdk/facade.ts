/**
 * Browser SDK facade — the model-facing `Browser` global. Ported from QwenPaw's
 * `browser/sdk/facade.py`.
 *
 * SUBAGENT A IMPLEMENTS the class bodies; this file pins the public surface so
 * the sandbox (C) and backend (B) compile against a stable contract. The SDK is
 * injected into the model's code scope as the global `Browser`.
 *
 * Usage shape (what the model writes):
 *   browser = await Browser.connect()
 *   page = await browser.open("https://example.com")
 *   obs = await page.snapshot()
 *   await page.getByRole("button", { name: "Go" }).click()
 */

import type {
  Owner,
  PageRef,
  SessionStatus,
} from './contracts.ts';
import type { Page } from './page.ts';

/** Orchestration-only surface: session, multi-page, handoff. */
export interface Browser {
  /** Connect (once per session; the kernel pre-connects the session). */
  connect(): Promise<Browser>;
  /** Close this session's browser and release its context. */
  close(): Promise<void>;
  /** Hand a step back to a human (captcha/login/2FA); the run stops here. */
  handoff(reason: string, instructions?: string): Promise<{ status: 'handoff'; reason: string; instructions: string }>;
  /** Report owner, variant, context, connected state. */
  sessionStatus(): Promise<SessionStatus>;
  /** List open pages with url/title/active. */
  pages(): Promise<PageRef[]>;
  /** Open (or reuse active) page at url. */
  open(url?: string): Promise<Page>;
  /** Open a page retained for the chat lifetime. */
  present(url?: string): Promise<Page>;
  /** Make a page ref active for later operations. */
  switchPage(page: PageRef): Promise<void>;
  /** Close a page ref in this session. */
  closePage(page: PageRef): Promise<void>;
}

/** Kernel wiring for a Browser instance (not model-visible). */
export interface BrowserHooks {
  /** Receive `browser.handoff(...)` calls; wired to the owning sandbox. */
  onHandoff?: (reason: string, instructions: string) => void;
  /** The owner this session belongs to (surfaced by sessionStatus()). */
  owner?: Owner;
}

/**
 * Factory the kernel uses to bind a Browser to a live kernel/backend session.
 */
export interface BrowserFactory {
  create(session: import('../backend/ports.ts').BackendSession, hooks?: BrowserHooks): Browser;
}
