/**
 * Chrome-extension backend for the ControlLink port.
 *
 * Drives the user's REAL Chrome — with no --remote-debugging-port flag — via
 * the DSH Browser extension's chrome.debugger channel, bridged through the
 * Native Messaging host and the NMBridge (see ./ext/bridge.ts). Port of
 * QwenPaw's `control_link/chrome/adapter.py` (session/page↔tab mapping) with
 * the CDP verbs executed page-side through injected JS (./ext/cdp-inject.ts).
 *
 * Key behaviours (mirroring the adapter):
 *   - isHeadless() is always false: this is the user's on-screen Chrome;
 *   - close() closes only the tabs THIS session created (tab.create marked
 *     them via createdByDsh); the user's own tabs are never touched;
 *   - every CDP call attaches lazily (tab.attach) and maps stale-tab wire
 *     errors to governed RETRYABLE/state_stale so the model re-opens a page.
 */

import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { BrowserError } from '../governance/errors.ts';
import type {
  BackendOptions,
  BackendPage,
  ControlLink,
} from './ports.ts';
import type { CurrentSurface, Observation, PageRef } from '../sdk/contracts.ts';
import { nmBridge } from './ext/bridge.ts';
import { ExtPage } from './ext/cdp-page.ts';
import type { Owner } from '../../sdk/contracts.ts';

/** Owner identity threaded to the extension for tab attribution (P5). */
export interface ExtOwner {
  ownerId: string; // session id
  workspaceId: string;
}

class ExtSession {
  /** pageId -> Chrome tabId */
  readonly pages = new Map<string, number>();
  readonly pageIdsByTab = new Map<number, string>();
  private activePageId: string | null = null;

  constructor(readonly owner: ExtOwner, readonly opts: BackendOptions) {}

  async cdp<T = Record<string, unknown>>(pageId: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    const tabId = this.pages.get(pageId);
    if (tabId === undefined) {
      throw new BrowserError({
        category: 'RETRYABLE',
        cause: 'state_stale',
        reason: 'page has been closed',
        suggested_action: 'Open a new page if you need to continue',
        detail: `unknown pageId ${pageId}`,
      });
    }
    try {
      await nmBridge.request('tab.attach', { tabId });
      return (await nmBridge.request('cdp.send', { tabId, method, params })) as T;
    } catch (e) {
      if (e instanceof BrowserError && /no tab with id|tab (?:was )?closed|Cannot attach/i.test(e.reason)) {
        this.forgetPage(pageId, tabId);
        throw new BrowserError({
          category: 'RETRYABLE',
          cause: 'state_stale',
          reason: 'page has been closed',
          suggested_action: 'Open a new page if you need to continue',
          detail: e.reason,
        });
      }
      throw e;
    }
  }

  forgetPage(pageId: string, tabId: number): void {
    this.pages.delete(pageId);
    this.pageIdsByTab.delete(tabId);
    if (this.activePageId === pageId) this.activePageId = null;
  }

  async newPage(url?: string): Promise<ExtPage> {
    const created = (await nmBridge.request('tab.create', {
      url: url ?? 'about:blank',
      ownerId: this.owner.ownerId,
      workspaceId: this.owner.workspaceId,
      protocolVersion: 2,
      active: false,
    })) as { tabId: number; url?: string };
    const pageId = randomBytes(4).toString('hex');
    const tabId = Number(created.tabId);
    this.pages.set(pageId, tabId);
    this.pageIdsByTab.set(tabId, pageId);
    this.activePageId = pageId;
    const page = new ExtPage(this, pageId);
    try {
      await page.cdp('Page.enable');
      await page.cdp('Runtime.enable');
    } catch (e) {
      await this.closePage(pageId).catch(() => undefined);
      throw e;
    }
    if (url) await page.goto(url);
    return page;
  }

  /** Reuse the active page when one exists (parity with PlaywrightSession.openPage). */
  async openPage(url?: string): Promise<BackendPage> {
    if (this.activePageId && this.pages.has(this.activePageId)) {
      const page = new ExtPage(this, this.activePageId);
      if (url) await page.goto(url);
      return page;
    }
    return this.newPage(url);
  }

  async presentPage(url?: string): Promise<BackendPage> {
    return this.newPage(url);
  }

  async listPages(): Promise<PageRef[]> {
    const refs: PageRef[] = [];
    for (const [pageId, tabId] of this.pages) {
      let url = '';
      let title = '';
      try {
        url = await this.evaluateJson<string>(pageId, 'location.href');
        const t = await this.evaluateJson<{ title: string }>(pageId, '({title: document.title})');
        title = t.title;
      } catch {
        /* page may be mid-navigation; report what we know */
      }
      refs.push({ id: pageId, url, title, active: pageId === this.activePageId });
    }
    return refs;
  }

  async evaluateJson<T>(pageId: string, expression: string, awaitPromise = false): Promise<T> {
    const res = await this.cdp<{ result?: { value?: T }; exceptionDetails?: unknown }>(
      pageId,
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise },
    );
    if (res.exceptionDetails) {
      throw new BrowserError({
        category: 'RETRYABLE',
        cause: 'internal',
        reason: `page-side evaluation failed: ${JSON.stringify(res.exceptionDetails).slice(0, 300)}`,
      });
    }
    return res.result?.value as T;
  }

  switchPage(pageId: string): void {
    if (!this.pages.has(pageId)) {
      throw new BrowserError({ category: 'RETRYABLE', cause: 'state_stale', reason: `unknown page ${pageId}` });
    }
    this.activePageId = pageId;
  }

  async closePage(pageId: string): Promise<void> {
    const tabId = this.pages.get(pageId);
    if (tabId === undefined) return;
    this.forgetPage(pageId, tabId);
    await nmBridge.request('tab.close', { tabId }).catch(() => undefined);
  }

  /** Close only OUR tabs; never the user's browser (QwenPaw parity). */
  async close(): Promise<void> {
    for (const [pageId, tabId] of [...this.pages]) {
      await this.closePage(pageId).catch(() => undefined);
      void tabId;
    }
    this.pages.clear();
    this.pageIdsByTab.clear();
  }

  isHeadless(): boolean {
    return false; // the attached browser is the user's on-screen Chrome
  }

  async screenshotTo(pageId: string, file: string): Promise<{ path: string }> {
    const shot = await this.cdp<{ data?: string }>(pageId, 'Page.captureScreenshot', { format: 'png' });
    if (!shot?.data) {
      throw new BrowserError({ category: 'RETRYABLE', cause: 'internal', reason: 'screenshot returned no data' });
    }
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return { path: file };
  }

  get workspaceDir(): string {
    return this.opts.workspaceDir;
  }

  path(...parts: string[]): string {
    return path.join(this.workspaceDir, ...parts);
  }
}

export function createChromeExtensionControlLink(owner?: ExtOwner): ControlLink {
  return {
    async connect(opts: BackendOptions) {
      if (!nmBridge.isConnected) {
        throw new BrowserError({
          category: 'RETRYABLE',
          cause: 'bridge_disconnected',
          reason: 'the DSH Browser extension is not connected',
          suggested_action:
            'Ensure Chrome is running with the DSH Browser extension enabled. If the popup says "never connected", ask the user to run the browser setup once.',
        });
      }
      const session = new ExtSession(
        { ownerId: owner?.ownerId ?? 'default', workspaceId: owner?.workspaceId ?? 'default' },
        opts,
      );
      return adaptSession(session);
    },
    async selfTest() {
      return nmBridge.status();
    },
  };
}

/** Map the ExtSession's rich surface onto the BackendSession port shape. */
function adaptSession(session: ExtSession) {
  return {
    variant: 'chrome-extension',
    openPage: (url?: string) => session.openPage(url),
    presentPage: (url?: string) => session.presentPage(url),
    pages: () => session.listPages(),
    switchPage: async (pageId: string) => session.switchPage(pageId),
    closePage: (pageId: string) => session.closePage(pageId),
    isHeadless: () => session.isHeadless(),
    close: () => session.close(),
  };
}

export { ExtSession, ExtPage };
export type { Observation, CurrentSurface };
