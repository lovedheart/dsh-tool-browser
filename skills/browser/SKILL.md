---
name: browser
description: Drive a live web browser by writing async JavaScript against the built-in Browser SDK. Use for any task that needs to open pages, read content, click, fill forms, navigate, screenshot, or handle login/captcha via human handoff.
---

# Browser SDK — complete reference

This is the ENTIRE API. The SDK is already in scope as the global `Browser` —
call its methods directly. Write **async JavaScript**. Work in a loop:
**perceive → act → verify.**

## Start every session

```js
browser = await Browser.connect()                  // connect once; reused all session
page = await browser.open("https://example.com")   // open a page
obs = await page.snapshot()                        // PERCEIVE — page text is obs.text
```

## Session state (stateful)

This is a **stateful session** — variables you assign (`browser`, `page`) persist
across `browser(code)` calls, so connect once and reuse them. If a call reports
the session was reset, re-run `await Browser.connect()`.

## Browser (orchestration)

| method | returns |
|---|---|
| `await Browser.connect({identity}?)` | `Browser` (identity: 'auto'\|'user'\|'avatar'\|'guest') |
| `await browser.close()` | none — release this session's browser |
| `await browser.open(url?)` | `Page` — reuse active page or create one |
| `await browser.present(url?)` | `Page` — retained for the chat lifetime |
| `await browser.pages()` | list of page refs `{id,url,title,active}` |
| `await browser.switchPage(ref)` | make a page ref active |
| `await browser.closePage(ref)` | close a page ref |
| `await browser.sessionStatus()` | `{owner,variant,context,connected}` |
| `await browser.handoff(reason, instructions?)` | STOP for a human (captcha/login/2FA) |

## Page (operation)

Navigation: `await page.goto(url)` · `goBack()` · `goForward()` · `reload()` ·
`await page.keep()` (retain across cycles).

Waiting: `await page.waitForLoadState('load'|'domcontentloaded'|'networkidle', timeoutMs?)` ·
`await page.waitForTimeout(ms)` (capped at 30000; prefer locator.waitFor).

Perception: `await page.snapshot(query?)` → `{text, match_count?}` ·
`await page.currentSurface()` → `{url,title,load_state}` ·
`await page.screenshot()` → `{path}`.

Locating (semantic first): `page.getByRole(role,{name})` · `page.getByText(text)` ·
`page.getByLabel(text)` · `page.getByPlaceholder(text)` · `page.locator(css)` ·
`page.frameLocator(sel)`.

Input: `await page.mouse.click(x,y)` · `await page.mouse.wheel(dx?,dy?)` ·
`await page.keyboard.press(key)`.

## Locator (Playwright subset, strict mode)

Compose/scope (chainable): `getByRole/getByText/getByLabel/getByPlaceholder`,
`filter({hasText})`, `nth(i)`, `.first`, `.last`.

Read (await): `count()`→int · `innerText()`→str · `textContent()`→str|null ·
`allTextContents()`→list · `getAttribute(name)`→str|null · `inputValue()`→str ·
`isVisible()`→bool · `isEnabled()`→bool · `boundingBox()`→`{x,y,width,height}|null`.

Act (await; returns `{evidence}`): `click()` · `fill(v)` · `type(t)` · `press(key)` ·
`check()` · `uncheck()` · `setChecked(b)` · `selectOption(...v)` · `hover()` ·
`dblclick()` · `scroll()` · `focus()` · `blur()` · `clear()` ·
`waitFor(state, timeoutMs?)` · `screenshot()`.

**Strict mode:** an action fails if the locator resolves to more than one element.
Check `count()` first, or narrow with `.first`/`.nth(i)`/a filter.

## Reading results

- `snapshot()` → read `.text`; `.match_count` when you pass a query.
- `currentSurface()` → `.url`, `.title`, `.load_state`.
- page refs → `.id`, `.url`, `.title`, `.active`.
- `screenshot()` → result dict; read `["path"]`.
- actions → `.evidence` (a short line saying what happened); verify with `snapshot()`.
- locator reads return plain string/number/boolean/list directly.

For large pages, don't dump everything:
```js
obs = await page.snapshot()
if (obs.text.length < 6000) print(obs.text)
else {
  lines = obs.text.split("\n").filter(l => l.includes("keyword"))
  print(`${obs.text.length} chars total; ${lines.length} matching:`)
  print(lines.slice(0, 80).join("\n"))
}
// focused count: await page.snapshot("keyword")
```

## If a locator fails — step DOWN one rung (don't jump)

1. **semantic** `page.get_by_role/label/text` — first choice
2. **css** `page.locator(css)` — role missing/unstable
3. **coordinates** use `locator.boundingBox()` first for an exact viewport rect;
   use a screenshot to explore only when the element is absent from `snapshot()`

## Human-only steps

For captcha / login / 2FA or any human-only step:
`await browser.handoff(reason, instructions)` and **stop** — never automate them.
(Requires a headed session; in headless mode handoff raises an error telling you
to enable headed mode.)

## Backend notes

- `playwright` backend: managed Chromium, true strict-mode accessible names.
- `chrome` backend: operates inside the user's real browser over CDP. A session is
  a tab-ownership group — tabs are isolated per session, but identity (cookies,
  logins, storage) is shared with the user's profile. Do not rely on session-level
  identity isolation there. Accessible-name matching is a heuristic, so strict-mode
  errors are more likely; narrow with `filter({hasText})` or a more specific role.
