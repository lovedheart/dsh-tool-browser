/**
 * dsh-tool-browser — Cordis plugin entry.
 *
 * Exports the four plugin metadata members Cordis reads (`name`, `inject`,
 * `Config`, `apply`). `apply` registers the model-facing `browser` tool and its
 * system-prompt guidance, and owns the KernelManager lifecycle.
 *
 * This is the integration seam: it composes the kernel (C), backend (B), and SDK
 * (A) behind the `browser(code)` tool. See tool.ts for the tool definition.
 */

import { Config, type BrowserToolConfig } from './config.ts';
import { registerBrowserTool } from './tool.ts';

/** Cordis loader diagnostic name. */
export const name = 'tool-browser';

/** Services this plugin requires; it only loads while all are available. */
export const inject = ['tools', 'systemPrompt'];

export { Config };

/**
 * Register the browser tool. The KernelManager is created here and disposed with
 * the plugin fiber (effect-scoped), so kernels are torn down on unload.
 */
export function apply(ctx: any, config: BrowserToolConfig): void {
  if (!config.enabled) return;
  registerBrowserTool(ctx, config);
}
