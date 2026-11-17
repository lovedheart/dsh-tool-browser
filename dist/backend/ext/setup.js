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
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, cpSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Native Messaging host name (must match the extension's connectNative call). */
export const NATIVE_HOST_NAME = 'com.dsh.browser';
/**
 * Profile name for the current process: the plugin's `profile` config wins,
 * then `$DSH_PROFILE` (set by the dsh launcher for shell envs), then none.
 * Read at call time — setup/status/bridge all consult it per invocation.
 */
let profileNameOverride;
/** Set by the plugin's `profile` config; `~` and non-slug chars are refused. */
export function setProfileName(name) {
    profileNameOverride = normalizeProfileName(name);
}
/** The active profile name, or undefined for the legacy single-bridge layout. */
export function profileName() {
    return profileNameOverride ?? normalizeProfileName(process.env.DSH_PROFILE);
}
function normalizeProfileName(raw) {
    const v = String(raw ?? '').trim();
    if (!v)
        return undefined;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)) {
        throw new Error(`invalid profile name ${JSON.stringify(v)}: use [A-Za-z0-9._-], starting alphanumeric`);
    }
    return v;
}
/**
 * Native Messaging host name for one profile ('com.dsh.browser' when none).
 * Chrome allows only alphanumerics, '_' and '.' in host names and rejects a
 * hyphen outright ("Invalid native messaging host name specified"), so the
 * separator is a dot and any hyphen in the profile name becomes an underscore.
 */
export function nativeHostName(profile = profileName()) {
    return profile ? `${NATIVE_HOST_NAME}.${profile.replace(/-/g, '_')}` : NATIVE_HOST_NAME;
}
/** Deterministic extension id derived from the manifest "key" (a-p alphabet). */
export const EXTENSION_ID = 'iaciefbpcipoaiakcihpejbhghpjkiga';
const PROTOCOL_VERSION = 2;
const NM_MAX_INBOUND_BYTES = 64 * 1024 * 1024;
const NM_MAX_OUTBOUND_BYTES = 1024 * 1024;
const here = dirname(fileURLToPath(import.meta.url));
/** Package root: three levels up from {dist,src}/backend/ext. */
const pkgRoot = join(here, '..', '..', '..');
/** DSH home dir (mirrors the dsh-home-paths convention). */
export function dshHome() {
    return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}
export function nativeManifestPath(platform = process.platform, home = dshHome(), profile = profileName()) {
    const host = nativeHostName(profile);
    if (platform === 'darwin') {
        return join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${host}.json`);
    }
    // Linux (and other XDG platforms): Chrome reads the manifest from the REAL
    // user config dir, not under DSH_HOME — honor XDG_CONFIG_HOME for tests.
    const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
    return join(configHome, 'google-chrome', 'NativeMessagingHosts', `${host}.json`);
}
export function extensionInstallDir(home = dshHome()) {
    return join(home, 'chrome-extension', 'dsh-chrome');
}
/**
 * Directory that holds the per-profile bridge artifacts. Profile-scoped under
 * `profiles/<p>/` so co-resident instances never overwrite each other's
 * ws_url/token; without a profile name this is the legacy `$DSH_HOME` root.
 */
export function bridgeScopeDir(home = dshHome(), profile = profileName()) {
    return profile ? join(home, 'profiles', profile) : home;
}
export function nmBridgeConfigPath(home = dshHome(), profile = profileName()) {
    return join(bridgeScopeDir(home, profile), 'nm-bridge.json');
}
export function launcherPath(home = dshHome(), profile = profileName()) {
    return join(bridgeScopeDir(home, profile), 'bin', 'dsh-nm-host');
}
function atomicWrite(path, data, mode) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, data, mode === undefined ? 'utf8' : { mode });
    chmodSync(tmp, mode ?? 0o644);
    renameSync(tmp, path);
}
/** Read the current bridge token, minting nothing (undefined when unsetup). */
export function readBridgeToken(home = dshHome(), profile = profileName()) {
    try {
        const v = JSON.parse(readFileSync(nmBridgeConfigPath(home, profile), 'utf8'));
        return typeof v.token === 'string' && v.token ? v.token : undefined;
    }
    catch {
        return undefined;
    }
}
/** Install/refresh everything the extension backend needs. Idempotent. */
export function runSetup(opts) {
    const home = opts.home ?? dshHome();
    const profile = opts.profile === undefined ? profileName() : normalizeProfileName(opts.profile);
    const nodePath = opts.nodePath ?? process.execPath;
    const hostScript = opts.hostScript ?? join(pkgRoot, 'dist', 'bin', 'nm-host.js');
    const assetSrc = join(pkgRoot, 'assets', 'extensions', 'chrome');
    // 1. extension copy (stable unpacked location)
    const extDir = extensionInstallDir(home);
    cpSync(assetSrc, extDir, { recursive: true });
    // bridge_config.js: the port + host name this profile registered, used by the
    // service worker for origin checks and its connectNative target.
    const port = Number(new URL(opts.wsUrl).port || 80);
    const nativeHost = nativeHostName(profile);
    const bridgeConfig = {
        initialReconnectBackoffSeconds: 5,
        maxReconnectBackoffSeconds: 60,
        localPort: port,
        nativeHost,
        profile: profile ?? null,
        protocolVersion: PROTOCOL_VERSION,
    };
    writeFileSync(join(extDir, 'bridge_config.js'), `globalThis.DSH_BRIDGE_CONFIG = ${JSON.stringify(bridgeConfig)};\n`, 'utf8');
    // 2. token + bridge config (0600, loopback-only url)
    const host = new URL(opts.wsUrl).hostname;
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
        throw new Error(`bridge endpoint must be loopback-only, got ${host}`);
    }
    const configPath = nmBridgeConfigPath(home, profile);
    const existing = readBridgeToken(home, profile);
    const token = existing ?? randomBytes(32).toString('base64url');
    atomicWrite(configPath, JSON.stringify({ ws_url: opts.wsUrl, token, profile: profile ?? null }), 0o600);
    // 3. launcher (node + nm-host.js, profile-scoped so each instance's Chrome
    // host targets its own ws_url/token instead of overwriting a shared file)
    const launcher = launcherPath(home, profile);
    mkdirSync(dirname(launcher), { recursive: true });
    const hostArgs = profile ? `--profile ${JSON.stringify(profile)} ` : '';
    writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(nodePath)} ${JSON.stringify(hostScript)} ${hostArgs}"$@"\n`, { mode: 0o755 });
    // 4. Native Messaging manifest (allowed_origins pinned to the extension id)
    const manifest = nativeManifestPath(process.platform, home, profile);
    atomicWrite(manifest, JSON.stringify({
        name: nativeHost,
        description: 'DSH Browser bridge',
        path: launcher,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    }, null, 2));
    return {
        extensionDir: extDir,
        manifestPath: manifest,
        launcher,
        configPath,
        reusedToken: existing !== undefined,
        profile,
        nativeHost,
    };
}
/** Diagnostics for the setup/status UI + bridge_disconnected self-test. */
export function installStatus(home = dshHome(), profile = profileName()) {
    const extDir = extensionInstallDir(home);
    let wsUrl;
    try {
        wsUrl = JSON.parse(readFileSync(nmBridgeConfigPath(home, profile), 'utf8')).ws_url;
    }
    catch {
        /* not configured */
    }
    return {
        installed: existsSync(extDir)
            && existsSync(nativeManifestPath(process.platform, home, profile))
            && readBridgeToken(home, profile) !== undefined,
        extensionDir: extDir,
        extensionDirExists: existsSync(extDir),
        manifestExists: existsSync(nativeManifestPath(process.platform, home, profile)),
        launcherExists: existsSync(launcherPath(home, profile)),
        tokenConfigured: readBridgeToken(home, profile) !== undefined,
        wsUrl,
        profile,
        nativeHost: nativeHostName(profile),
        protocol: { version: PROTOCOL_VERSION, nmMaxInboundBytes: NM_MAX_INBOUND_BYTES, nmMaxOutboundBytes: NM_MAX_OUTBOUND_BYTES },
        extensionId: EXTENSION_ID,
    };
}
