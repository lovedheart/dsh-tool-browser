/**
 * ControlLink port — the seam between the Browser SDK and a concrete browser
 * backend (Playwright managed Chromium, or a user's real Chrome over CDP).
 * Ported from QwenPaw's `browser/runtime/ports.py` + `control_link/*`.
 *
 * The SDK (facade/page/locator) programs against this interface only; the
 * backend implements it. This keeps the two backends swappable and lets tests
 * inject a fake link.
 */
export {};
