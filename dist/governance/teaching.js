/**
 * Teaching-style error rendering, ported from QwenPaw's worker helpers
 * (`_api_misuse_teaching`, `_name_error_teaching`, `render_error_text`).
 *
 * The goal: when the model's browser code fails, the returned text teaches the
 * correct API shape rather than just dumping a stack. Pure functions over an
 * {@link BrowserError} (or unknown throw) + optional stdout.
 */
import { BrowserError } from "./errors.js";
/** Render a governed error into stable model-facing text. */
export function renderErrorText(error, stdout = '') {
    const parts = [`[${error.category}] ${error.reason}`];
    if (error.detail && !error.suggested_action.includes(error.detail)) {
        parts.push(error.detail);
    }
    if (error.suggested_action)
        parts.push(error.suggested_action);
    const text = parts.join('\n');
    return stdout ? `${text}\n\n[stdout]\n${stdout}` : text;
}
/** Map a raw thrown value to a governed {@link BrowserError}. */
export function toBrowserError(err) {
    if (err instanceof BrowserError)
        return err;
    const message = err instanceof Error ? err.message : String(err);
    // Heuristic teaching for common model mistakes (mirrors QwenPaw NameError teaching).
    if (/is not defined/.test(message)) {
        return new BrowserError({
            category: 'API_MISUSE',
            cause: 'api_misuse',
            reason: message,
            suggested_action: 'The Browser SDK is already in scope as `Browser`. Begin with ' +
                '`browser = await Browser.connect()`, then `page = await browser.open(url)`. ' +
                'Do not import anything.',
        });
    }
    if (/strict mode violation/i.test(message)) {
        return new BrowserError({
            category: 'API_MISUSE',
            cause: 'strict_mode_violation',
            reason: 'Locator resolved to more than one element (strict mode).',
            suggested_action: 'Narrow the locator: add a name/text filter, use .first/.nth(i), or a more ' +
                'specific role. Check count() first.',
        });
    }
    return new BrowserError({
        category: 'INTERNAL',
        cause: 'internal',
        reason: message,
    });
}
/**
 * Locator-failure "ladder" guidance (QwenPaw `_BLOCK_LADDER`): step down one rung,
 * don't jump. Returned when a semantic locator fails so the model degrades
 * predictably.
 */
export function locatorLadderTeaching() {
    return [
        'If a locator fails, step DOWN one rung (do not jump):',
        '  1. semantic  page.getByRole / getByLabel / getByText   first choice',
        '  2. css       page.locator(css)                          role missing/unstable',
        '  3. coordinates use locator.boundingBox() first for an exact viewport rect;',
        '     use a screenshot to explore only when the element is absent from snapshot()',
        'For captcha/login/2FA or any human-only step: await browser.handoff(reason, instructions) and stop.',
    ].join('\n');
}
