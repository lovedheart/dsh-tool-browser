/**
 * P5 test: reconnect resilience — reconcile on (re)connect, orphan flagging
 * (default: flag-only; opt-in: close), tab event handling, needsReopen error.
 * Uses the bridge + fake WS extension (controllable tabs.list).
 * Run: npx tsx test/e2e-ext-resilience.ts
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { nmBridge, mountBridge } from '../src/backend/ext/bridge.ts';
import { runSetup } from '../src/backend/ext/setup.ts';
import {
  registerSession,
  unregisterSession,
  configureResilience,
  orphanedTabs,
  needsReopenError,
  resetResilience,
  type ExtSessionLike,
} from '../src/backend/ext/resilience.ts';
import { BrowserError } from '../src/governance/errors.ts';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 8000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await wait(20);
  }
  return cond();
}

// webserver seam + bridge ------------------------------------------------------
const upgrades = new Map<string, any>();
const http = createServer((_q, res) => {
  res.writeHead(404);
  res.end();
});
http.on('upgrade', (req, socket, head) => {
  const p = new URL(req.url ?? '/', 'http://x').pathname;
  const h = upgrades.get(p);
  if (!h) return socket.destroy();
  h(req, socket, head);
});
await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
const port = (http.address() as { port: number }).port;
mountBridge({
  register: () => () => undefined,
  registerUpgrade: (route: any) => {
    upgrades.set(route.path, route.handler);
    return () => upgrades.delete(route.path);
  },
  port,
});
const home = mkdtempSync(join(tmpdir(), 'p5-res-'));
process.env.DSH_HOME = home;
runSetup({ wsUrl: `ws://127.0.0.1:${port}/api/plugins/tool-browser/ws`, home });
const token = JSON.parse(readFileSync(join(home, 'nm-bridge.json'), 'utf8')).token;

// controllable fake extension over WS ------------------------------------------
interface Fake {
  ws: WebSocket;
  tabs: Array<Record<string, unknown>>;
  closedTabs: number[];
  eventsSent: number;
}
function connectFake(initialTabs: Array<Record<string, unknown>> = []): Promise<Fake> {
  const fake: Partial<Fake> = { tabs: initialTabs, closedTabs: [], eventsSent: 0 };
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/plugins/tool-browser/ws`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fake.ws = ws;
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', entryId: 'fake', protocolVersion: 2, contract: { protocolVersion: 2 } })));
    ws.on('message', (data: Buffer) => {
      const m = JSON.parse(data.toString());
      if (m.type === 'hello_ack') return;
      if (typeof m.id === 'number') {
        if (m.method === 'tabs.list') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: (fake as Fake).tabs }));
        } else if (m.method === 'tab.close') {
          (fake as Fake).closedTabs!.push(m.params.tabId);
          (fake as Fake).tabs = (fake as Fake).tabs!.filter((t) => t.tabId !== m.params.tabId);
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { closed: true } }));
        } else {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: {} }));
        }
      }
    });
    ws.on('open', () => setTimeout(() => resolve(fake as Fake), 150));
  });
}
function sendEvent(fake: Fake, method: string, params: Record<string, unknown>): void {
  fake.eventsSent++;
  fake.ws.send(JSON.stringify({ id: `evt-${fake.eventsSent}`, method, params }));
}

// fake session shape -------------------------------------------------------------
function fakeSession(ownerId: string): ExtSessionLike & { pages: Map<string, number>; pageIdsByTab: Map<number, string>; reenabled: number } {
  const pages = new Map<string, number>();
  const pageIdsByTab = new Map<number, string>();
  return {
    ownerId,
    workspaceId: 'ws1',
    pages,
    pageIdsByTab,
    needsReopen: false,
    reenabled: 0,
    forgetPage(pageId: string, tabId: number) {
      pages.delete(pageId);
      pageIdsByTab.delete(tabId);
    },
    reenablePages() {
      (this as any).reenabled++;
    },
  };
}

resetResilience();
configureResilience({ closeOrphanTabs: false });

const s1 = fakeSession('sess-A');
s1.pages.set('p1', 11);
s1.pageIdsByTab.set(11, 'p1');
s1.pages.set('p2', 12);
s1.pageIdsByTab.set(12, 'p2');
registerSession(s1);

// connect: tab 11 alive, 12 gone; plus an orphan tab 99 (created by dsh, other owner)
let fake = await connectFake([
  { tabId: 11, url: 'a', createdByDsh: true, ownerId: 'sess-A', workspaceId: 'ws1' },
  { tabId: 99, url: 'orphan', createdByDsh: true, ownerId: 'sess-GONE', workspaceId: 'ws1' },
  { tabId: 5, url: 'user-tab', createdByDsh: false },
]);
check('reconcile on connect: lost page forgotten', await waitFor(() => !s1.pages.has('p2') && s1.pages.has('p1'), 4000), `p1=${s1.pages.has('p1')} p2=${s1.pages.has('p2')}`);
check('lost pages mark needsReopen', s1.needsReopen === true);
check('surviving pages re-enabled', s1.reenabled >= 1, String(s1.reenabled));
check('orphan flagged, NOT closed (default)', orphanedTabs().some((o) => o.tabId === 99) && fake.closedTabs!.length === 0, JSON.stringify(orphanedTabs()));
check('user tabs untouched', fake.tabs.some((t) => t.tabId === 5));

// tab.detached event forgets the live page immediately
sendEvent(fake, 'tab.detached', { tabId: 11 });
check('tab.detached forgets page', await waitFor(() => !s1.pages.has('p1')));

// needsReopen error shape
const err: BrowserError = needsReopenError();
check('needsReopenError governed RETRYABLE/state_stale', err.category === 'RETRYABLE' && err.cause === 'state_stale');

// opt-in orphan closing -----------------------------------------------------------
configureResilience({ closeOrphanTabs: true });
fake.ws.close(4000, 'restart');
check('bridge down after close', await waitFor(() => !nmBridge.isConnected));
fake = await connectFake([{ tabId: 77, url: 'orphan2', createdByDsh: true, ownerId: 'sess-X', workspaceId: 'ws1' }]);
check('opt-in: orphan closed on reconnect', await waitFor(() => fake.closedTabs!.includes(77), 4000), JSON.stringify(fake.closedTabs));
check('orphans map empty after close', orphanedTabs().length === 0);

unregisterSession(s1);
resetResilience();
http.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
