/**
 * Chrome extension + Native Messaging installer for the `chrome-extension`
 * backend. Ported from QwenPaw's `plugins/bundle/chrome/extension_setup.py`
 * (Linux-first; macOS paths kept, Windows registry paths dropped).
 *
 * Responsibilities:
 *   - copy the unpacked extension to `$DSH_HOME/chrome-extension/dsh-chrome`
 *     (a stable path for chrome://extensions → Load unpacked);
 *   - mint / reuse the bridge token and write `$DSH_HOME/nm-bridge.json` (0600);
 *   - write the Native Messaging manifest to the Chrome-hosts dir, pinned to
 *     the extension id derived from the manifest "key";
 *   - write the nm-host launcher (`$DSH_HOME/bin/dsh-nm-host`).
 */
/** Native Messaging host name (must match the extension's connectNative call). */
export declare const NATIVE_HOST_NAME = "com.dsh.browser";
/** Deterministic extension id derived from the manifest "key" (a-p alphabet). */
export declare const EXTENSION_ID = "iaciefbpcipoaiakcihpejbhghpjkiga";
/** DSH home dir (mirrors the dsh-home-paths convention). */
export declare function dshHome(): string;
export declare function nativeManifestPath(platform?: NodeJS.Platform, home?: string): string;
export declare function extensionInstallDir(home?: string): string;
export declare function nmBridgeConfigPath(home?: string): string;
export declare function launcherPath(home?: string): string;
/** Read the current bridge token, minting nothing (undefined when unsetup). */
export declare function readBridgeToken(home?: string): string | undefined;
export interface SetupOptions {
    /** Bridge websocket url, e.g. ws://127.0.0.1:3080/api/plugins/tool-browser/ws */
    wsUrl: string;
    /** Absolute node binary for the launcher. */
    nodePath?: string;
    home?: string;
    /** Absolute path to the nm-host script (defaults to dist/bin/nm-host.js). */
    hostScript?: string;
}
export interface SetupResult {
    extensionDir: string;
    manifestPath: string;
    launcher: string;
    configPath: string;
    reusedToken: boolean;
}
/** Install/refresh everything the extension backend needs. Idempotent. */
export declare function runSetup(opts: SetupOptions): SetupResult;
export interface InstallStatus {
    installed: boolean;
    extensionDir: string;
    extensionDirExists: boolean;
    manifestExists: boolean;
    launcherExists: boolean;
    tokenConfigured: boolean;
    wsUrl?: string;
    protocol: {
        version: number;
        nmMaxInboundBytes: number;
        nmMaxOutboundBytes: number;
    };
    extensionId: string;
}
/** Diagnostics for the setup/status UI + bridge_disconnected self-test. */
export declare function installStatus(home?: string): InstallStatus;
