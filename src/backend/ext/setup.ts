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

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, cpSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Native Messaging host name (must match the extension's connectNative call). */
export const NATIVE_HOST_NAME = 'com.dsh.browser';
/** Deterministic extension id derived from the manifest "key" (a-p alphabet). */
export const EXTENSION_ID = 'iaciefbpcipoaiakcihpejbhghpjkiga';
const PROTOCOL_VERSION = 2;
const NM_MAX_INBOUND_BYTES = 64 * 1024 * 1024;
const NM_MAX_OUTBOUND_BYTES = 1024 * 1024;

const here = dirname(fileURLToPath(import.meta.url));
/** Package root: three levels up from {dist,src}/backend/ext. */
const pkgRoot = join(here, '..', '..', '..');

/** DSH home dir (mirrors the dsh-home-paths convention). */
export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}

export function nativeManifestPath(platform: NodeJS.Platform = process.platform, home = dshHome()): string {
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${NATIVE_HOST_NAME}.json`);
  }
  // Linux (and other XDG platforms). win32 registry support is out of scope.
  return join(home, '.config', 'google-chrome', 'NativeMessagingHosts', `${NATIVE_HOST_NAME}.json`);
}

export function extensionInstallDir(home = dshHome()): string {
  return join(home, 'chrome-extension', 'dsh-chrome');
}

export function nmBridgeConfigPath(home = dshHome()): string {
  return join(home, 'nm-bridge.json');
}

export function launcherPath(home = dshHome()): string {
  return join(home, 'bin', 'dsh-nm-host');
}

function atomicWrite(path: string, data: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data, mode === undefined ? 'utf8' : { mode });
  chmodSync(tmp, mode ?? 0o644);
  renameSync(tmp, path);
}

/** Read the current bridge token, minting nothing (undefined when unsetup). */
export function readBridgeToken(home = dshHome()): string | undefined {
  try {
    const v = JSON.parse(readFileSync(nmBridgeConfigPath(home), 'utf8'));
    return typeof v.token === 'string' && v.token ? v.token : undefined;
  } catch {
    return undefined;
  }
}

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
export function runSetup(opts: SetupOptions): SetupResult {
  const home = opts.home ?? dshHome();
  const nodePath = opts.nodePath ?? process.execPath;
  const hostScript = opts.hostScript ?? join(pkgRoot, 'dist', 'bin', 'nm-host.js');
  const assetSrc = join(pkgRoot, 'assets', 'extensions', 'chrome');

  // 1. extension copy (stable unpacked location)
  const extDir = extensionInstallDir(home);
  cpSync(assetSrc, extDir, { recursive: true });
  // bridge_config.js: port hint the service worker uses for origin checks
  const port = Number(new URL(opts.wsUrl).port || 80);
  const bridgeConfig = {
    initialReconnectBackoffSeconds: 5,
    maxReconnectBackoffSeconds: 60,
    localPort: port,
    protocolVersion: PROTOCOL_VERSION,
  };
  writeFileSync(
    join(extDir, 'bridge_config.js'),
    `globalThis.DSH_BRIDGE_CONFIG = ${JSON.stringify(bridgeConfig)};\n`,
    'utf8',
  );

  // 2. token + bridge config (0600, loopback-only url)
  const host = new URL(opts.wsUrl).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
    throw new Error(`bridge endpoint must be loopback-only, got ${host}`);
  }
  const existing = readBridgeToken(home);
  const token = existing ?? randomBytes(32).toString('base64url');
  atomicWrite(nmBridgeConfigPath(home), JSON.stringify({ ws_url: opts.wsUrl, token }), 0o600);

  // 3. launcher (node + nm-host.js)
  const launcher = launcherPath(home);
  mkdirSync(dirname(launcher), { recursive: true });
  writeFileSync(
    launcher,
    `#!/bin/sh\nexec ${JSON.stringify(nodePath)} ${JSON.stringify(hostScript)} "$@"\n`,
    { mode: 0o755 },
  );

  // 4. Native Messaging manifest (allowed_origins pinned to the extension id)
  const manifest = nativeManifestPath(process.platform, home);
  atomicWrite(
    manifest,
    JSON.stringify(
      {
        name: NATIVE_HOST_NAME,
        description: 'DSH Browser bridge',
        path: launcher,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
      },
      null,
      2,
    ),
  );

  return {
    extensionDir: extDir,
    manifestPath: manifest,
    launcher,
    configPath: nmBridgeConfigPath(home),
    reusedToken: existing !== undefined,
  };
}

export interface InstallStatus {
  installed: boolean;
  extensionDir: string;
  extensionDirExists: boolean;
  manifestExists: boolean;
  launcherExists: boolean;
  tokenConfigured: boolean;
  wsUrl?: string;
  protocol: { version: number; nmMaxInboundBytes: number; nmMaxOutboundBytes: number };
  extensionId: string;
}

/** Diagnostics for the setup/status UI + bridge_disconnected self-test. */
export function installStatus(home = dshHome()): InstallStatus {
  const extDir = extensionInstallDir(home);
  let wsUrl: string | undefined;
  try {
    wsUrl = JSON.parse(readFileSync(nmBridgeConfigPath(home), 'utf8')).ws_url;
  } catch {
    /* not configured */
  }
  return {
    installed: existsSync(extDir) && existsSync(nativeManifestPath(process.platform, home)) && readBridgeToken(home) !== undefined,
    extensionDir: extDir,
    extensionDirExists: existsSync(extDir),
    manifestExists: existsSync(nativeManifestPath(process.platform, home)),
    launcherExists: existsSync(launcherPath(home)),
    tokenConfigured: readBridgeToken(home) !== undefined,
    wsUrl,
    protocol: { version: PROTOCOL_VERSION, nmMaxInboundBytes: NM_MAX_INBOUND_BYTES, nmMaxOutboundBytes: NM_MAX_OUTBOUND_BYTES },
    extensionId: EXTENSION_ID,
  };
}
