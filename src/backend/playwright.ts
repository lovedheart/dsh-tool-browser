/**
 * Playwright backend for the ControlLink port.
 *
 * Manages a Chromium browser instance via the `playwright` npm package and
 * exposes it through the {@link BackendSession} / {@link BackendPage} /
 * {@link BackendLocator} interfaces defined in `ports.ts`.
 *
 * The shared {@link PlaywrightPage} and {@link PlaywrightLocator} wrappers that
 * translate Playwright's `Page` / `Locator` into the port types live in
 * `./page-wrappers.ts` and are shared with the CDP backend (`chrome-cdp.ts`).
 * This file keeps only the Playwright-specific session + factory.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type {
  BackendOptions,
  BackendPage,
  BackendSession,
  ControlLink,
} from './ports.ts';
import type { PageRef } from '../sdk/contracts.ts';
import { PlaywrightPage } from './page-wrappers.ts';
import { BrowserError } from '../governance/errors.ts';
import { ensureManagedChromium } from './managed-chromium.ts';

// ---------------------------------------------------------------------------
// Internal page record
// ---------------------------------------------------------------------------

interface PageRecord {
  page: Page;
  active: boolean;
}

// ---------------------------------------------------------------------------
// BackendSession
// ---------------------------------------------------------------------------

class PlaywrightSession implements BackendSession {
  readonly variant = 'playwright';
  private pageMap = new Map<string, PageRecord>();
  private nextPageNum = 1;
  private context: BrowserContext;
  /** Undefined for persistent contexts (launchPersistentContext), where the
   * context owns the browser process and closing it closes the browser. */
  private browser?: Browser;
  private readonly opts: BackendOptions;

  constructor(browser: Browser | undefined, context: BrowserContext, opts: BackendOptions) {
    this.browser = browser;
    this.context = context;
    this.opts = opts;
  }

  /** Get or create the active page; optionally navigate to url. */
  async openPage(url?: string): Promise<BackendPage> {
    // Reuse active page if one exists
    let record: PageRecord | undefined;
    for (const rec of this.pageMap.values()) {
      if (rec.active) {
        record = rec;
        break;
      }
    }
    if (!record) {
      const page = await this.context.newPage();
      const id = `page-${this.nextPageNum++}`;
      record = { page, active: true };
      this.pageMap.set(id, record);
    } else {
      record.active = true;
    }
    if (url) {
      await record.page.goto(url);
    }
    return new PlaywrightPage(record.page, this.activeId(), this.opts.workspaceDir);
  }

  /** Always create a new retained page; optionally navigate to url. */
  async presentPage(url?: string): Promise<BackendPage> {
    const page = await this.context.newPage();
    const id = `page-${this.nextPageNum++}`;
    // Deactivate others
    for (const rec of this.pageMap.values()) rec.active = false;
    this.pageMap.set(id, { page, active: true });
    if (url) {
      await page.goto(url);
    }
    return new PlaywrightPage(page, id, this.opts.workspaceDir);
  }

  /** List all open pages. */
  async pages(): Promise<PageRef[]> {
    const refs: PageRef[] = [];
    for (const [id, rec] of this.pageMap) {
      refs.push({
        id,
        url: rec.page.url(),
        title: await rec.page.title(),
        active: rec.active,
      });
    }
    return refs;
  }

  /** Switch the active page. */
  async switchPage(pageId: string): Promise<void> {
    for (const [id, rec] of this.pageMap) {
      rec.active = id === pageId;
    }
  }

  /** Close a page by id. */
  async closePage(pageId: string): Promise<void> {
    const rec = this.pageMap.get(pageId);
    if (rec) {
      await rec.page.close();
      this.pageMap.delete(pageId);
    }
  }

  /** Whether the session is headless. */
  isHeadless(): boolean {
    return this.opts.headless;
  }

  /** Close context + browser. */
  async close(): Promise<void> {
    await this.context.close();
    await this.browser?.close();
  }

  private activeId(): string {
    for (const [id, rec] of this.pageMap) {
      if (rec.active) return id;
    }
    return '';
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Playwright-backed ControlLink.
 *
 * Launches managed Chromium via the `playwright` npm package.
 * If `opts.backend === 'chrome'`, still launches managed Chromium here —
 * the CDP-based Chrome backend is a separate implementation.
 */
export function createPlaywrightControlLink(): ControlLink {
  return {
    async connect(opts: BackendOptions): Promise<BackendSession> {
      // Managed-cache gate (QwenPaw parity): unless the caller pinned their
      // own binary, the driver-matched Chromium must exist. If it does not,
      // kick off a background install and tell the model when to retry —
      // instead of dying inside chromium.launch() with an ENOENT dead end.
      if (!opts.executablePath) {
        const [ready, detail, retryAfter] = await ensureManagedChromium();
        if (!ready) {
          throw new BrowserError({
            category: 'RETRYABLE',
            cause: 'timeout',
            reason: detail
              ? 'Managed Playwright Chromium install failed.'
              : 'Managed Playwright Chromium is downloading in the background.',
            detail,
            suggested_action: `Wait ${Math.max(1, Math.ceil(retryAfter))} seconds, then retry Browser.connect().`,
          });
        }
      }
      // Viewport is a *context* option in Playwright (not a launch option);
      // args/proxy/executablePath are launch options.
      const launchOptions: {
        headless: boolean;
        executablePath?: string;
        args?: string[];
        proxy?: { server: string };
      } = { headless: opts.headless };
      if (opts.executablePath) launchOptions.executablePath = opts.executablePath;
      if (opts.args?.length) launchOptions.args = opts.args;
      if (opts.proxy) launchOptions.proxy = { server: opts.proxy };

      if (opts.userDataDir) {
        const context = await chromium.launchPersistentContext(opts.userDataDir, {
          ...launchOptions,
          viewport: opts.viewport,
        });
        return new PlaywrightSession(undefined, context, opts);
      } else {
        const browser = await chromium.launch(launchOptions);
        const context = await browser.newContext({ viewport: opts.viewport });
        return new PlaywrightSession(browser, context, opts);
      }
    },
  };
}
