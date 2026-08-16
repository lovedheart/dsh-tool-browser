/**
 * Render an ExecResult into the model-facing text block. Ported from QwenPaw's
 * `tool_entrypoint.render_error_text` + success/handoff text assembly, with an
 * output cap (overflow beyond maxOutputChars is truncated with a notice).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecResult } from '../kernel/types.ts';
import { renderErrorText } from '../governance/teaching.ts';
import { BrowserError } from '../governance/errors.ts';

const TRUNCATION_FOOTER = (file: string | null) =>
  file
    ? `\n\n(Output truncated; full output saved to ${file}. Re-run with a narrower snapshot(query=...) or read that file.)`
    : '\n\n(Output truncated. Re-run with a narrower snapshot(query=...).)';

/**
 * Render one exec outcome to bounded model-facing text. When the text exceeds
 * `maxOutputChars` and `spillDir` is provided, the full text is written to a
 * workspace file (`browser_output_<sha8>.txt`) and only the notice + path is
 * shown to the model — mirroring QwenPaw's overflow stdout spilling.
 */
export function renderExecResult(
  result: ExecResult,
  maxOutputChars: number,
  spillDir?: string,
): string {
  let text: string;
  if (result.error) {
    const err = new BrowserError({
      category: (result.error.category as BrowserError['category']) ?? 'INTERNAL',
      cause: (result.error.cause as BrowserError['cause']) ?? 'internal',
      reason: String(result.error.reason ?? 'browser error'),
      detail: result.error.detail ? String(result.error.detail) : undefined,
      suggested_action: result.error.teaching ? String(result.error.teaching) : undefined,
    });
    text = renderErrorText(err, result.stdout);
  } else if (result.handoff) {
    text = `Handoff requested: ${result.handoff.reason}\n${result.handoff.instructions}\nStopping so a human can take over.`;
  } else {
    text = result.value || '';
    if (result.stdout) text = text ? `${text}\n\n[stdout]\n${result.stdout}` : `[stdout]\n${result.stdout}`;
  }
  if (text.length > maxOutputChars) {
    let file: string | null = null;
    if (spillDir) {
      try {
        mkdirSync(spillDir, { recursive: true });
        const sha8 = createHash('sha256').update(text.slice(0, 4096) + result.requestId, 'utf8').digest('hex').slice(0, 8);
        file = join(spillDir, `browser_output_${sha8}.txt`);
        writeFileSync(file, text, 'utf8');
      } catch {
        file = null; // best-effort; fall back to plain truncation
      }
    }
    const footer = TRUNCATION_FOOTER(file);
    text = `${text.slice(0, Math.max(0, maxOutputChars - footer.length))}${footer}`;
  }
  return text;
}
