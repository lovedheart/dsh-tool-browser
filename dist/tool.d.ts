/**
 * The model-facing `browser` tool. Owns: the tool schema, the system-prompt
 * section, argument validation, the execute→KernelManager→render chain, overflow
 * spill, and presentation cards. Delegates all browser state to the kernel.
 */
import type { BrowserToolConfig } from './config.ts';
export declare function registerBrowserTool(ctx: any, config: BrowserToolConfig): void;
