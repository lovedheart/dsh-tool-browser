/**
 * Chrome-over-CDP backend for the ControlLink port.
 *
 * Drives the user's REAL, already-running Chrome (launched with
 * `--remote-debugging-port=<port>`) by attaching to its DevTools Protocol
 * endpoint via Playwright's `chromium.connectOverCDP`. Unlike the managed
 * Playwright backend, this does not launch or own a browser process — it only
 * attaches to one. That distinction drives two behaviours that differ from
 * `playwright.ts`:
 *
 *   1. `isHeadless()` is always `false` — the attached browser is the user's
 *      headed, on-screen Chrome.
 *   2. `close()` does NOT close the user's browser. For a `connectOverCDP`
 *      connection, `browser.close()` only tears down the CDP client connection;
 *      the user's Chrome keeps running with all its windows and tabs intact.
 *
 * The shared {@link PlaywrightPage} / {@link PlaywrightLocator} wrappers (the
 * page + locator port translation) are reused from `./page-wrappers.ts`; only
 * the session + factory here are CDP-specific.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { BrowserError } from '../governance/errors.ts';
import type {
  BackendOptions,
  BackendPage,
  BackendSession,
  ControlLink,
} from './ports.ts';
import type { PageRef } from '../sdk/contracts.ts';
import { PlaywrightPage } from './page-wrappers.ts';

// ---------------------------------------------------------------------------
// Internal page record
//
// Note: `url` / `title` are denormalized per the task spec. They are read live
// from the live `page` when `pages()` is called (mirroring PlaywrightSession);
// the fields are kept on the record so the shape matches the spec exactly.
// ---------------------------------------------------------------------------

interface ChromePageRecord {
  page: Page;
  url: string;
  title: string;
  active: boolean;
}

// ---------------------------------------------------------------------------
// BackendSession
// ---------------------------------------------------------------------------

/**
 * A session attached to the user's real Chrome over CDP. Page management
 * (ids `page-N`, active flag, openPage reuses the active page, presentPage
 * always creates a new one) mirrors {@link PlaywrightSession} in
 * `playwright.ts`, using the shared {@link PlaywrightPage} wrapper.
 */
class ChromeSession implements BackendSession {
  readonly variant = 'chrome';
  private pageMap = new Map<string, ChromePageRecord>();
  private nextPageNum = 1;
  private context: BrowserContext;
  private browser: Browser;
  private readonly opts: BackendOptions;

  /**
   * @param browser A CDP-connected `Browser` (from `chromium.connectOverCDP`).
   * @param context The default (or freshly created) `BrowserContext` to create
   *   pages in. A CDP-attached browser usually already has a default context.
   * @param opts Backend options (persisted, read by later page operations).
   */
  constructor(browser: Browser, context: BrowserContext, opts: BackendOptions) {
    this.browser = browser;
    this.context = context;
    this.opts = opts;
  }

  /** Get or create the active page; optionally navigate to url. */
  async openPage(url?: string): Promise<BackendPage> {
    // Reuse active page if one exists
    let record: ChromePageRecord | undefined;
    for (const rec of this.pageMap.values()) {
      if (rec.active) {
        record = rec;
        break;
      }
    }
    if (!record) {
      const page = await this.context.newPage();
      const id = `page-${this.nextPageNum++}`;
      record = { page, url: page.url(), title: '', active: true };
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
    this.pageMap.set(id, { page, url: page.url(), title: '', active: true });
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

  /**
   * Always `false` — the attached browser is the user's real, headed Chrome.
   * The `opts.headless` flag is irrelevant for a CDP-attached browser.
   */
  isHeadless(): boolean {
    return false;
  }

  /**
   * Tear down this session: close the tabs THIS session created, then disconnect
   * from the user's Chrome.
   *
   * Symmetric with the managed Playwright backend (which closes its context and
   * pages on `close()`), but scoped safely for a shared, user-owned browser:
   *   - closes only the pages in `pageMap` (created by this session via
   *     `context.newPage()`), so we do not leak agent tabs into the user's
   *     browser;
   *   - does NOT `context.close()` (that would close the user's default context
   *     and every one of their tabs);
   *   - does NOT terminate the browser process — for a `connectOverCDP`
   *     connection `browser.close()` only DISCONNECTS the client; the user's
   *     Chrome keeps running with all its pre-existing windows/tabs intact.
   * Each page close is best-effort (a tab may already be gone); failures are
   * swallowed so teardown never throws.
   */
  async close(): Promise<void> {
    for (const rec of [...this.pageMap.values()]) {
      await rec.page.close().catch(() => undefined);
    }
    this.pageMap.clear();
    await this.browser.close().catch(() => undefined);
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
 * Create a Chrome-over-CDP ControlLink.
 *
 * Attaches to the user's real, already-running Chrome via
 * `chromium.connectOverCDP({ endpointUrl: opts.cdpUrl })`. Requires
 * `opts.cdpUrl` (e.g. `http://127.0.0.1:9222`) — the user must have launched
 * Chrome with `--remote-debugging-port=<port>`.
 */
export function createChromeControlLink(): ControlLink {
  return {
    async connect(opts: BackendOptions): Promise<BackendSession> {
      if (!opts.cdpUrl) {
        throw new BrowserError({
          category: 'FATAL',
          cause: 'config_invalid',
          reason: 'backend=chrome requires cdpUrl',
          suggested_action:
            'Set cdpUrl (e.g. http://127.0.0.1:9222) in the tool config, and launch ' +
            'Chrome with --remote-debugging-port=9222.',
        });
      }
      const browser = await chromium.connectOverCDP({ endpointURL: opts.cdpUrl });
      // CDP-attached browsers usually already have a default context; reuse it,
      // or create a fresh one if there is none.
      const context = (await browser.contexts())[0] ?? (await browser.newContext());
      return new ChromeSession(browser, context, opts);
    },
  };
}
