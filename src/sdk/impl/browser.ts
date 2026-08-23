/**
 * Concrete Browser implementation — wraps a BackendSession.
 * Ported from QwenPaw's `browser/sdk/facade.py` Browser class.
 */

import type { Identity, Owner, PageRef, SessionStatus } from '../contracts.ts';
import type { Browser, BrowserFactory, BrowserHooks } from '../facade.ts';
import type { Page } from '../page.ts';
import { createPageFactory } from './page.ts';
import type { BackendSession } from '../../backend/ports.ts';
import { BrowserError } from '../../governance/errors.ts';
import { raceAbort } from '../../kernel/run-control.ts';
import { currentRunSignal } from '../../kernel/run-context.ts';

/** Run a session op under the current run's abort signal (see locator.ts). */
function op<T>(p: Promise<T>): Promise<T> {
  return raceAbort(p, currentRunSignal()) as Promise<T>;
}

/** Concrete Browser bound to one BackendSession. */
export class BrowserImpl implements Browser {
  private readonly session: BackendSession;
  private readonly owner: Owner;
  private readonly pageFactory = createPageFactory();
  private connected = true; // kernel pre-connects the session
  private onHandoff: ((reason: string, instructions: string) => void) | undefined;

  constructor(session: BackendSession, hooks?: BrowserHooks) {
    this.session = session;
    this.owner = hooks?.owner ?? { workspace_id: '', session_id: '' };
    this.onHandoff = hooks?.onHandoff;
  }

  /** Connect as an identity. The session is pre-connected by the kernel. */
  async connect(_opts?: { identity?: Identity }): Promise<Browser> {
    if (!this.connected) {
      throw new BrowserError({
        category: 'FATAL',
        cause: 'config_invalid',
        reason: 'Browser session is not connected.',
        suggested_action: 'The kernel must create the session before the SDK is used.',
      });
    }
    return this;
  }

  /** Close this session's browser and release its context. */
  async close(): Promise<void> {
    await this.session.close();
    this.connected = false;
  }

  /** Hand a step back to a human (captcha/login/2FA); the run stops here. */
  async handoff(reason: string, instructions?: string): Promise<{ status: 'handoff'; reason: string; instructions: string }> {
    // An aborted run must not record a (false) handoff — abort the run instead.
    currentRunSignal()?.throwIfAborted?.();
    if (this.session.isHeadless()) {
      throw new BrowserError({
        category: 'ASK_HUMAN',
        cause: 'headless_handoff',
        reason: 'cannot hand off in a headless session',
        suggested_action: 'Switch to a headed browser session by setting headless=false in the tool config.',
      });
    }
    // Report to the owning sandbox (wired by the kernel) so ExecResult.handoff
    // is populated. Per-sandbox routing means handoff signals never leak across
    // concurrently cached sessions. No-op outside the kernel (e.g. unit tests).
    this.onHandoff?.(reason, instructions ?? '');
    return { status: 'handoff', reason, instructions: instructions ?? '' };
  }

  /** Report owner, variant, context, connected state. */
  async sessionStatus(): Promise<SessionStatus> {
    return {
      owner: this.owner,
      variant: this.session.variant,
      context: 'auto',
      connected: this.connected,
    };
  }

  /** List open pages with url/title/active. */
  async pages(): Promise<PageRef[]> {
    return op(this.session.pages());
  }

  /** Open (or reuse active) page at url. */
  async open(url?: string): Promise<Page> {
    const bp = await op(this.session.openPage(url));
    return this.pageFactory.create(bp);
  }

  /** Open a page retained for the chat lifetime. */
  async present(url?: string): Promise<Page> {
    const bp = await op(this.session.presentPage(url));
    return this.pageFactory.create(bp);
  }

  /** Make a page ref active for later operations. */
  async switchPage(page: PageRef): Promise<void> {
    await op(this.session.switchPage(page.id));
  }

  /** Close a page ref in this session. */
  async closePage(page: PageRef): Promise<void> {
    await op(this.session.closePage(page.id));
  }
}

/** Factory the kernel uses to bind a Browser to a live kernel/backend session. */
export function createBrowserFactory(): BrowserFactory {
  return {
    create(session: BackendSession, hooks?: BrowserHooks): Browser {
      return new BrowserImpl(session, hooks);
    },
  };
}
