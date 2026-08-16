/**
 * Concrete Browser implementation — wraps a BackendSession.
 * Ported from QwenPaw's `browser/sdk/facade.py` Browser class.
 */

import type { Identity, PageRef, SessionStatus } from '../contracts.ts';
import type { Browser, BrowserFactory } from '../facade.ts';
import type { Page } from '../page.ts';
import { createPageFactory } from './page.ts';
import type { BackendSession } from '../../backend/ports.ts';
import { BrowserError } from '../../governance/errors.ts';
import { notifyHandoff } from '../../kernel/handoff.ts';

/** Concrete Browser bound to one BackendSession. */
export class BrowserImpl implements Browser {
  private readonly session: BackendSession;
  private readonly pageFactory = createPageFactory();
  private connected = true; // kernel pre-connects the session

  constructor(session: BackendSession) {
    this.session = session;
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
    if (this.session.isHeadless()) {
      throw new BrowserError({
        category: 'ASK_HUMAN',
        cause: 'headless_handoff',
        reason: 'cannot hand off in a headless session',
        suggested_action: 'Switch to a headed browser session by setting headless=false in the tool config.',
      });
    }
    // Notify the kernel's sandbox so ExecResult.handoff is populated (the facade
    // return value alone is not interceptable from the kernel). The sandbox injects
    // a handoff sink reachable through the shared module-level ref below; no-op
    // outside the sandbox (e.g. unit tests with a fake session).
    notifyHandoff(reason, instructions ?? '');
    return { status: 'handoff', reason, instructions: instructions ?? '' };
  }

  /** Report owner, variant, context, connected state. */
  async sessionStatus(): Promise<SessionStatus> {
    return {
      owner: { workspace_id: '', session_id: '' },
      variant: this.session.variant,
      context: 'auto',
      connected: true,
    };
  }

  /** List open pages with url/title/active. */
  async pages(): Promise<PageRef[]> {
    return this.session.pages();
  }

  /** Open (or reuse active) page at url. */
  async open(url?: string): Promise<Page> {
    const bp = await this.session.openPage(url);
    return this.pageFactory.create(bp);
  }

  /** Open a page retained for the chat lifetime. */
  async present(url?: string): Promise<Page> {
    const bp = await this.session.presentPage(url);
    return this.pageFactory.create(bp);
  }

  /** Make a page ref active for later operations. */
  async switchPage(page: PageRef): Promise<void> {
    await this.session.switchPage(page.id);
  }

  /** Close a page ref in this session. */
  async closePage(page: PageRef): Promise<void> {
    await this.session.closePage(page.id);
  }
}

/** Factory the sandbox uses to bind a Browser to a live kernel/backend session. */
export function createBrowserFactory(): BrowserFactory {
  return {
    create(session: BackendSession): Browser {
      return new BrowserImpl(session);
    },
  };
}
