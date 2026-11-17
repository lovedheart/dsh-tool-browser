/**
 * Chrome extension + Native Messaging installer for the `chrome-extension`
 * backend. Ported from QwenPaw's `plugins/bundle/chrome/extension_setup.py`
 * (Linux-first; macOS paths kept, Windows registry paths dropped).
 *
 * Responsibilities:
 *   - copy the unpacked extension to `$DSH_HOME/chrome-extension/dsh-chrome`
 *     (a stable path for chrome://extensions → Load unpacked);
 *   - mint / reuse the bridge token and write the bridge config (0600);
 *   - write the Native Messaging manifest to the Chrome-hosts dir, pinned to
 *     the extension id derived from the manifest "key";
 *   - write the nm-host launcher.
 *
 * Profile independence: every DSH profile runs on its own port and therefore
 * needs its own bridge target (ws_url) and secret. With a profile name active
 * (config `profile`, else `$DSH_PROFILE`) all four artifacts move under
 * `profiles/<name>/` and the host gets a profile suffix:
 *
 *   config    `profiles/<p>/nm-bridge.json`   (fallback: `$DSH_HOME/nm-bridge.json`)
 *   launcher  `profiles/<p>/bin/dsh-nm-host`  (fallback: `$DSH_HOME/bin/dsh-nm-host`)
 *   manifest  `com.dsh.browser.<p>.json`      (fallback: `com.dsh.browser.json`)
 *   host name `com.dsh.browser.<p>`           (fallback: `com.dsh.browser`)
 *
 * One unpacked extension still serves every profile (its id comes from the
 * manifest key); `bridge_config.js` carries the host name to select. Which
 * profile an extension connects to is thus decided by which profile's setup
 * ran last — reconnect from the extension popup after re-running it.
 */
/** Native Messaging host name (must match the extension's connectNative call). */
export declare const NATIVE_HOST_NAME = "com.dsh.browser";
/** Set by the plugin's `profile` config; `~` and non-slug chars are refused. */
export declare function setProfileName(name: string | undefined): void;
/** The active profile name, or undefined for the legacy single-bridge layout. */
export declare function profileName(): string | undefined;
/**
 * Native Messaging host name for one profile ('com.dsh.browser' when none).
 * Chrome allows only alphanumerics, '_' and '.' in host names and rejects a
 * hyphen outright ("Invalid native messaging host name specified"), so the
 * separator is a dot and any hyphen in the profile name becomes an underscore.
 */
export declare function nativeHostName(profile?: string | undefined): string;
/** Deterministic extension id derived from the manifest "key" (a-p alphabet). */
export declare const EXTENSION_ID = "iaciefbpcipoaiakcihpejbhghpjkiga";
/** DSH home dir (mirrors the dsh-home-paths convention). */
export declare function dshHome(): string;
export declare function nativeManifestPath(platform?: NodeJS.Platform, home?: string, profile?: string | undefined): string;
export declare function extensionInstallDir(home?: string): string;
/**
 * Directory that holds the per-profile bridge artifacts. Profile-scoped under
 * `profiles/<p>/` so co-resident instances never overwrite each other's
 * ws_url/token; without a profile name this is the legacy `$DSH_HOME` root.
 */
export declare function bridgeScopeDir(home?: string, profile?: string | undefined): string;
export declare function nmBridgeConfigPath(home?: string, profile?: string | undefined): string;
export declare function launcherPath(home?: string, profile?: string | undefined): string;
/** Read the current bridge token, minting nothing (undefined when unsetup). */
export declare function readBridgeToken(home?: string, profile?: string | undefined): string | undefined;
export interface SetupOptions {
    /** Bridge websocket url, e.g. ws://127.0.0.1:3080/api/plugins/tool-browser/ws */
    wsUrl: string;
    /** Absolute node binary for the launcher. */
    nodePath?: string;
    home?: string;
    /** Absolute path to the nm-host script (defaults to dist/bin/nm-host.js). */
    hostScript?: string;
    /** Profile scope; defaults to the active profile (`profile` config / $DSH_PROFILE). */
    profile?: string;
}
export interface SetupResult {
    extensionDir: string;
    manifestPath: string;
    launcher: string;
    configPath: string;
    reusedToken: boolean;
    /** Active profile scope (undefined = legacy single-bridge layout). */
    profile?: string;
    /** Native Messaging host name this profile registered. */
    nativeHost: string;
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
    /** Active profile scope (undefined = legacy single-bridge layout). */
    profile?: string;
    nativeHost: string;
    protocol: {
        version: number;
        nmMaxInboundBytes: number;
        nmMaxOutboundBytes: number;
    };
    extensionId: string;
}
/** Diagnostics for the setup/status UI + bridge_disconnected self-test. */
export declare function installStatus(home?: string, profile?: string | undefined): InstallStatus;
