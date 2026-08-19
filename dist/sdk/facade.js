/**
 * Browser SDK facade — the model-facing `Browser` global. Ported from QwenPaw's
 * `browser/sdk/facade.py`.
 *
 * SUBAGENT A IMPLEMENTS the class bodies; this file pins the public surface so
 * the sandbox (C) and backend (B) compile against a stable contract. The SDK is
 * injected into the model's code scope as the global `Browser`.
 *
 * Usage shape (what the model writes):
 *   browser = await Browser.connect()
 *   page = await browser.open("https://example.com")
 *   obs = await page.snapshot()
 *   await page.getByRole("button", { name: "Go" }).click()
 */
export {};
