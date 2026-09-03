/**
 * Fake Chrome extension for offline e2e of the chrome-extension backend.
 *
 * Stands in for the MV3 service worker + nm-host pair: it speaks the same
 * JSON-RPC dialect over stdio NM frames (launched like a native host), but
 * implements each command by translating it onto a REAL Chromium's CDP
 * session (Playwright-launched with --remote-debugging-port), including
 * Page/Runtime/Input domains — so ExtPage/ExtLocator run their real code.
 *
 * Commands implemented: tabs.list, tab.create, tab.attach (no-op), tab.close,
 * tab.ensure, cdp.send. Events: none (the offline harness drives sync).
 */

import { readFileSync, writeSync, read } from 'node:fs';
import { chromium } from 'playwright';
import type { CDPSession } from 'playwright';

const PORT = Number(process.env.FAKE_EXT_PORT ?? 9444);
const START_URL = 'about:blank';

interface FakeTab {
  tabId: number;
  url: string;
  cdp: CDPSession;
  closed: boolean;
  created: boolean;
}

let nextTabId = 100;
const tabs = new Map<number, FakeTab>();

const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${PORT}`] });
const context = (await browser.contexts())[0] ?? (await browser.newContext());

async function ensureTab(tabId: number): Promise<FakeTab> {
  const tab = tabs.get(tabId);
  if (!tab || tab.closed) throw new Error(`no tab with id: ${tabId}`);
  return tab;
}

async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'tabs.list': {
      return [...tabs.values()]
        .filter((t) => !t.closed)
        .map((t) => ({ tabId: t.tabId, url: t.url, createdByDsh: t.created }));
    }
    case 'tab.create': {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const tab: FakeTab = { tabId: nextTabId++, url: String(params.url ?? 'about:blank'), cdp, closed: false, created: true };
      tabs.set(tab.tabId, tab);
      if (params.url) await page.goto(String(params.url)).catch(() => undefined);
      // keep url fresh
      page.on('framenavigated', (f) => {
        if (f === page.mainFrame()) tab.url = f.url();
      });
      return { tabId: tab.tabId, url: tab.url };
    }
    case 'tab.attach':
      await ensureTab(Number(params.tabId));
      return { attached: true };
    case 'tab.ensure': {
      const t = await ensureTab(Number(params.tabId));
      return { tabId: t.tabId, url: t.url };
    }
    case 'tab.close': {
      const t = tabs.get(Number(params.tabId));
      if (t && !t.closed) {
        t.closed = true;
        await t.cdp.detach().catch(() => undefined);
      }
      return { closed: true };
    }
    case 'cdp.send': {
      const t = await ensureTab(Number(params.tabId));
      return await t.cdp.send(String(params.method) as never, (params.params ?? {}) as never);
    }
    case 'status.get':
      return { ok: true, fake: true };
    default:
      throw new Error(`method_not_allowed: ${method}`);
  }
}

// ---- stdio NM frame loop -----------------------------------------------------

let buf = Buffer.alloc(0);
function send(msg: Record<string, unknown>): void {
  const payload = Buffer.from(JSON.stringify(msg));
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  let off = 0;
  while (off < frame.length) off += writeSync(1, frame, off, frame.length - off);
}

async function pump(): Promise<void> {
  for (;;) {
    const chunk = await readChunk();
    if (chunk === null) return; // EOF
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 4) break;
      const n = buf.readUInt32LE(0);
      if (buf.length < 4 + n) break;
      const payload = buf.subarray(4, 4 + n);
      buf = buf.subarray(4 + n);
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(payload.toString('utf8'));
      } catch {
        continue;
      }
      if (msg.type === 'hello') {
        send({ type: 'hello_ack', status: 'ok' });
        continue;
      }
      if (typeof msg.id === 'number') {
        try {
          const result = await dispatch(String(msg.method), (msg.params ?? {}) as Record<string, unknown>);
          send({ jsonrpc: '2.0', id: msg.id, result });
        } catch (e) {
          send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: (e as Error).message } });
        }
      }
    }
  }
}

function readChunk(): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const tmp = Buffer.allocUnsafe(64 * 1024);
    read(0, tmp, 0, tmp.length, null, (err, n) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === 'EAGAIN') resolve(Buffer.alloc(0));
        else reject(err);
        return;
      }
      resolve(n === 0 ? null : tmp.subarray(0, n));
    });
  });
}

void readFileSync;
void START_URL;
process.on('SIGTERM', () => process.exit(0));
void pump().finally(() => browser.close());
