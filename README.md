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
- `chrome` — the user's real browser over CDP (`cdpUrl`). *(landed in P5)*

## Install (as a DSH profile plugin)

```bash
# from this directory, into a DSH profile
dsh plugin --profile <name> add .
# or, once published:
dsh plugin --profile <name> add dsh-tool-browser
```

First run needs Chromium:

```bash
npx playwright install chromium
```

## Configure

The tool is mounted by `cordis.patch.yml` (row id `tool-browser`). Override config
in your profile's `cordis.patch.yml`:

```yaml
- replace:
    - id: tool-browser
      config:
        backend: playwright     # or 'chrome'
        headless: false         # required for handoff(); 'auto' = headless in a
                                # container / when no display server is found
        cdpUrl: http://127.0.0.1:9222   # only for backend=chrome
        args: ['--no-sandbox']  # extra Chromium launch flags (playwright only)
        proxy: http://127.0.0.1:7890    # proxy server (playwright only)
        viewport: { width: 1280, height: 800 }  # new contexts (playwright only)
        userDataDir: /path/to/profile          # persistent profile (playwright only)
        execTimeoutMs: 120000
        idleTtlMs: 600000
        maxOutputChars: 100000
```

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
skills/browser/SKILL.md the model-facing SDK manual
```

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
  `headless: 'auto'` (container/no-display → headless).

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
npm test            # all e2e suites in order: minloop, integration, network, cdp
npm run test:offline  # same, skipping the real-network suite (E2E_OFFLINE=1)
npx tsc --noEmit
```

To run a single suite directly:

```bash
npx tsx test/e2e-minloop.ts             # offline: open→snapshot→act→verify + governed errors
npx tsx test/e2e-plugin-integration.ts  # plugin apply + tool dispatch-path output-schema guard
npx tsx test/e2e-abort-preserve.ts      # offline: abort/timeout preserves the browser session
npx tsx test/e2e-network.ts             # online: open example.com→click link→re-snapshot
npx tsx test/e2e-cdp.ts                 # chrome/CDP backend (launches real Chromium)
```

> Use `npx tsx` (not `node --experimental-strip-types`) — the latter can't parse TS
> parameter properties. If the system npm cache has root-owned files, install deps
> with `npm install --cache /tmp/dsh-tb-npm-cache`.
