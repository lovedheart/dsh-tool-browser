# dsh-tool-browser

A DeepSeek Harness (DSH) plugin that gives the model a **`browser` tool**: drive a
live web browser by writing async JavaScript against a stateful **Browser SDK**.
Pure TypeScript — no Python runtime. Ported from QwenPaw's *Unified Browser SDK*.

## What the model can do

```js
browser = await Browser.connect()
page = await browser.open("https://example.com")
obs = await page.snapshot()                       // perceive
await page.getByRole("button", { name: "Go" }).click()  // act
obs = await page.snapshot()                       // verify
```

Stateful session (variables persist across calls), semantic + CSS locators with
strict mode, multi-page orchestration, screenshots, and human **handoff** for
login/captcha/2FA. Full API: `skills/browser/SKILL.md`.

## Backends

- `playwright` (default) — managed Chromium via the `playwright` package.
- `chrome` — the user's real browser over CDP; `cdpUrl` optional, otherwise
  ports 9222–9232 are probed automatically. *(landed in P5, P10)*
- `chrome-extension` — the user's on-screen Chrome via the bundled MV3
  extension + Native Messaging bridge, no debug flag. *(see below)*

## Identity (whose browser?)

`identity` picks the browser persona, independently of `backend`:

| value | browser | profile / sign-ins |
|---|---|---|
| `user` | your real Chrome (forces `chrome-extension`; ASK_HUMAN with a fix when the bridge is down) | your existing Chrome profile |
| `avatar` | managed Chromium | persistent dir `~/.dsh/tool-browser/avatar/<workspace>` (sign-ins survive) |
| `guest` | managed Chromium | incognito, discarded on close |
| `auto` (default) | `user` when the extension bridge is connected, otherwise `backend` stands (backward compatible) | — |

The resolved identity is surfaced as `sessionStatus().identity`.

## Install (as a DSH profile plugin)

```bash
# from this directory, into a DSH profile
dsh plugin --profile <name> add .
# or, once published:
dsh plugin --profile <name> add dsh-tool-browser
```

First run needs Chromium. Since P10 a missing binary is installed **lazily**:
the first `Browser.connect()` starts a background `playwright install chromium`
and answers `[RETRYABLE] … retry in Ns` instead of a dead-end ENOENT. Manual
install still works (and avoids the first-run wait):

```bash
npx playwright install chromium
```

## Configure

The tool is mounted by `cordis.patch.yml` (row id `tool-browser`). Override config
in your profile's `cordis.patch.yml`:

```yaml
# in your profile's cordis.patch.yml — a same-id row replaces the plugin's
- id: tool-browser
  name: 'dsh-tool-browser'
  config:
    backend: playwright     # or 'chrome' (CDP port) or 'chrome-extension'
    identity: auto          # 'auto' | 'user' | 'avatar' | 'guest' (see Identity above)
    headless: auto          # default; headed on a desktop (required for
                            # handoff()), headless in a container / no display
    closeOrphanTabs: false  # chrome-extension only: auto-close DSH-created
                            # tabs whose owner is gone (default: flag only)
    execTimeoutMs: 120000
    idleTtlMs: 600000
    maxOutputChars: 100000
```

Playwright-launch-only launch knobs: `args`, `proxy`, `viewport`,
`executablePath`, `userDataDir` (an explicit `userDataDir` wins over the
`avatar` default dir). `cdpUrl: http://127.0.0.1:9222` applies to
`backend: chrome` only and may be omitted — the backend then auto-discovers a
Chrome already running with `--remote-debugging-port` by probing ports
9222–9232 (an explicit `cdpUrl` or `executablePath` always wins).

### Chrome-extension backend (drive the user's real Chrome, no debug flag)

`backend: chrome-extension` attaches to the user's on-screen Chrome through the
bundled MV3 extension (chrome.debugger) over Native Messaging — no
`--remote-debugging-port` needed, no browser is launched, `isHeadless()` is
always false and close() only closes tabs this session created.

One-time setup on the user's machine:

1. `curl -X POST http://127.0.0.1:<dsh-port>/api/plugins/tool-browser/chrome/setup`
   (or call `runSetup()`); writes the NM host manifest, the
   `~/.dsh/bin/dsh-nm-host` launcher, the bridge token, and copies the
   extension to `~/.dsh/chrome-extension/dsh-chrome`.
2. In `chrome://extensions` → Developer mode → **Load unpacked** →
   `~/.dsh/chrome-extension/dsh-chrome`. The extension connects automatically
   whenever Chrome runs (no server restart needed; it reconnects with backoff).
3. Status: `GET /api/plugins/tool-browser/chrome/status` (install state +
   bridge connection + last hello info).

Transport: WS upgrade at `/api/plugins/tool-browser/ws` (Bearer token from
`~/.dsh/nm-bridge.json`, loopback only) ⇄ native host (dumb pipe, 4-byte LE
framing) ⇄ extension. Protocol v2: JSON-RPC 2.0 + hello/hello_ack contract
check. Reconnect resilience: on (re)connect the core reconciles page→tab maps
(surviving tabs stay usable, lost pages raise a governed "reopen" error),
DSH-created tabs without a live owner are flagged as orphans.

## Layout

```
src/index.ts            plugin entry (name/inject/Config/apply)
src/tool.ts             the browser(code) tool definition
src/config.ts           zod Config schema
src/kernel/             stateful kernel: manager / kernel / sandbox(vm)
src/sdk/                Browser / Page / LocatorView (+ impl/)
src/backend/            ControlLink port + playwright backend
src/governance/         BrowserError + teaching-style error text
src/wire/               owner derivation + result rendering
src/backend/managed-chromium.ts  lazy Chromium install gate (P10)
src/backend/cdp-discovery.ts     CDP port scanner for backend=chrome (P10)
skills/browser/SKILL.md the model-facing SDK manual
```

## License

Apache-2.0. Portions ported from
[QwenPaw](https://github.com/agentscope-ai/QwenPaw) (Apache-2.0): the identity model,
the governed error taxonomy, the managed-Chromium provisioning gate, and CDP
endpoint discovery.

## Status

P0–P7 implemented and verified:

- **P0** scaffold + fixed TS interface contracts.
- **P2** Playwright backend (`createPlaywrightControlLink`).
- **P3** stateful kernel (`node:vm` persistent context per workspace+session).
- **P4** SDK (Browser/Page/LocatorView) + governed error/teaching layer.
- **P5** Chrome CDP backend (`createChromeControlLink`, `connectOverCDP`) + manager
  backend branching.
- **P7** overflow stdout spilling to a workspace file + real-network e2e.
- **P8** snapshot structured elements (`ariaSnapshot` ai-mode → `Observation.elements`)
  + launch options `args`/`proxy`/`viewport`/`userDataDir` (persistent profile) +
  `headless: 'auto'` (container/no-display → headless; default).
- **P9** QwenPaw identity model (`auto`/`user`/`avatar`/`guest`, resolved via
  `resolveIdentitySelection()`, surfaced in `sessionStatus().identity`).
- **P10** lazy managed-Chromium provisioning (`backend/managed-chromium.ts`:
  background one-shot install, 60 s failure cooldown, RETRYABLE retry-after —
  QwenPaw `managed_playwright.py` port) + CDP port auto-discovery
  (`backend/cdp-discovery.ts`, 9222–9232, QwenPaw `cdp/discovery.py` port).

Timeout/cancel semantics: a per-call abort (tool `timeoutMs` budget or user
cancel) cuts the run short with a governed `[RETRYABLE]` error and **preserves
the browser session** — pages, state and `browser`/`page` variables survive for
the next call (QwenPaw "kill the worker, keep the browser"). Implemented
cooperatively: SDK ops race against the run's `AbortSignal`
(`src/kernel/run-control.ts` + `run-context.ts`); a synchronous infinite loop
in model code still blocks the main thread (needs worker_threads — deferred).

Verify:

```bash
npx playwright install chromium
./setup-peers.sh    # link dsh-tools/dsh-system-prompt to the installed harness
                    # (re-run after `npm install` — it replaces those links)
npm run build       # DSH loads dist/, not src/ — rebuild before restarting dsh
npm test            # all e2e suites in order: minloop, integration, network, cdp
npm run test:offline  # same, skipping the real-network suite (E2E_OFFLINE=1)
npx tsc --noEmit
```

To run a single suite directly:

```bash
npx tsx test/e2e-minloop.ts             # offline: open→snapshot→act→verify + governed errors
npx tsx test/e2e-identity.ts            # offline: resolveIdentitySelection/avatarProfileDirFor unit asserts
npx tsx test/e2e-managed-chromium.ts    # offline: lazy Chromium gate + CDP port discovery
npx tsx test/e2e-plugin-integration.ts  # plugin apply + tool dispatch-path output-schema guard
npx tsx test/e2e-abort-preserve.ts      # offline: abort/timeout preserves the browser session
npx tsx test/e2e-network.ts             # online: open example.com→click link→re-snapshot
npx tsx test/e2e-cdp.ts                 # chrome/CDP backend (launches real Chromium)
```

> Use `npx tsx` (not `node --experimental-strip-types`) — the latter can't parse TS
> parameter properties. If the system npm cache has root-owned files, install deps
> with `npm install --cache /tmp/dsh-tb-npm-cache`.
