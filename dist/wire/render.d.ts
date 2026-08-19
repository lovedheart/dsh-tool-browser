import type { ExecResult } from '../kernel/types.ts';
/**
 * Render one exec outcome to bounded model-facing text. When the text exceeds
 * `maxOutputChars` and `spillDir` is provided, the full text is written to a
 * workspace file (`browser_output_<sha8>.txt`) and only the notice + path is
 * shown to the model — mirroring QwenPaw's overflow stdout spilling.
 */
export declare function renderExecResult(result: ExecResult, maxOutputChars: number, spillDir?: string): string;
