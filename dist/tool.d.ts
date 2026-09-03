/**
 * The model-facing `browser` tool. Owns: the tool schema, the system-prompt
 * section, argument validation, the execute→KernelManager→render chain, overflow
 * spill, and presentation cards. Delegates all browser state to the kernel.
 */
import type { BrowserToolConfig } from './config.ts';
export declare function registerBrowserTool(ctx: any, config: BrowserToolConfig): void;
/**
 * Wire the extension backend's server-side plumbing: the NM bridge WS upgrade,
 * plus `setup` / `status` HTTP routes. Disposes with the plugin fiber.
 */
export declare const extensionBridgePlugin: {
    name: string;
    inject: string[];
    apply(ctx: any, _config: BrowserToolConfig): void;
};
