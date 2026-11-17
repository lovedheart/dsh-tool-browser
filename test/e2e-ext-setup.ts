/**
 * P1 test: the extension/NM installer (runSetup / installStatus) against a
 * throwaway HOME. Run: npx tsx test/e2e-ext-setup.ts
 */
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetup, installStatus, readBridgeToken } from '../src/backend/ext/setup.ts';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}

const home = mkdtempSync(join(tmpdir(), 'dsh-tb-p1-'));
// Isolate the NM manifest (always written to the real user config dir) too.
process.env.DSH_PROFILE = ''; // pin legacy scope (agent shells may export it)
process.env.XDG_CONFIG_HOME = join(home, 'xdg');
const wsUrl = 'ws://127.0.0.1:3080/api/plugins/tool-browser/ws';

const r1 = runSetup({ wsUrl, home });
check('extension dir created', existsSync(join(r1.extensionDir, 'manifest.json')));
check('service worker copied', existsSync(join(r1.extensionDir, 'service_worker.js')));
const swText = readFileSync(join(r1.extensionDir, 'service_worker.js'), 'utf8');
check('extension branded for DSH (no qwenpaw refs)', !/qwenpaw/i.test(swText));
check('NATIVE_HOST renamed', swText.includes('com.dsh.browser'));
const bc = readFileSync(join(r1.extensionDir, 'bridge_config.js'), 'utf8');
check('bridge_config written with port 3080', bc.includes('"localPort":3080'), bc.trim());
const m = JSON.parse(readFileSync(r1.manifestPath, 'utf8'));
check('NM manifest name', m.name === 'com.dsh.browser');
check('NM manifest path = launcher', m.path === r1.launcher);
check(
  'allowed_origins pins extension id',
  Array.isArray(m.allowed_origins) && m.allowed_origins[0] === 'chrome-extension://iaciefbpcipoaiakcihpejbhghpjkiga/',
  JSON.stringify(m.allowed_origins),
);
const token1 = readBridgeToken(home);
check('token minted (43-char base64url)', typeof token1 === 'string' && token1.length === 43, String(token1?.length));
const mode = statSync(r1.configPath).mode & 0o777;
check('nm-bridge.json mode 0600', mode === 0o600, mode.toString(8));
const cfg = JSON.parse(readFileSync(r1.configPath, 'utf8'));
check('ws_url persisted', cfg.ws_url === wsUrl);
check('launcher executable', (statSync(r1.launcher).mode & 0o111) !== 0);
const lch = readFileSync(r1.launcher, 'utf8');
check('launcher execs node + nm-host script', lch.includes(process.execPath) && lch.includes('nm-host.js'), lch.trim());
const st1 = installStatus(home);
check('installStatus installed=true', st1.installed === true, JSON.stringify(st1).slice(0, 120));
check('protocol contract v2', st1.protocol.version === 2 && st1.protocol.nmMaxOutboundBytes === 1048576);

// idempotency: second run reuses the token, no churn
const r2 = runSetup({ wsUrl, home });
check('second setup reuses token', r2.reusedToken === true && readBridgeToken(home) === token1);

// non-loopback endpoint rejected
let rejected = false;
try {
  runSetup({ wsUrl: 'ws://192.168.1.5:3080/x', home });
} catch {
  rejected = true;
}
check('non-loopback ws url rejected', rejected);

// profile scoping: each profile owns its token / launcher / manifest / host name
const pa = runSetup({ wsUrl: 'ws://127.0.0.1:3083/api/plugins/tool-browser/ws', home, profile: 'alpha' });
const pb = runSetup({ wsUrl: 'ws://127.0.0.1:3084/api/plugins/tool-browser/ws', home, profile: 'beta' });
check('profile launcher is profile-scoped', pa.launcher.includes('profiles/alpha/bin/dsh-nm-host'), pa.launcher);
check('profile config is profile-scoped', pa.configPath === join(home, 'profiles/alpha/nm-bridge.json'), pa.configPath);
check('profiles get distinct host names', pa.nativeHost === 'com.dsh.browser.alpha' && pb.nativeHost === 'com.dsh.browser.beta', `${pa.nativeHost} / ${pb.nativeHost}`);
check('profile manifests are distinct files', pa.manifestPath !== pb.manifestPath && existsSync(pa.manifestPath) && existsSync(pb.manifestPath));
const mfA = JSON.parse(readFileSync(pa.manifestPath, 'utf8'));
check('profile manifest name + launcher', mfA.name === 'com.dsh.browser.alpha' && mfA.path === pa.launcher, mfA.name);
check('profile launcher pins --profile', readFileSync(pa.launcher, 'utf8').includes('--profile "alpha"'), readFileSync(pa.launcher, 'utf8').trim());
check('profile tokens are independent', readBridgeToken(home, 'alpha') !== readBridgeToken(home, 'beta'));
check('one profile setup leaves the legacy file alone', JSON.parse(readFileSync(join(home, 'nm-bridge.json'), 'utf8')).ws_url === wsUrl);
// The extension copy is shared, so bridge_config.js tracks the LAST setup —
// this is what makes "re-run setup, then reconnect the popup" switch profiles.
const bcShared = readFileSync(join(pa.extensionDir, 'bridge_config.js'), 'utf8');
check('last setup wins in the shared bridge_config', bcShared.includes('"localPort":3084') && bcShared.includes('"nativeHost":"com.dsh.browser.beta"'), bcShared.trim());
runSetup({ wsUrl: 'ws://127.0.0.1:3083/api/plugins/tool-browser/ws', home, profile: 'alpha' });
const bcA = readFileSync(join(pa.extensionDir, 'bridge_config.js'), 'utf8');
check('re-running setup hands the extension back to alpha', bcA.includes('"localPort":3083') && bcA.includes('"nativeHost":"com.dsh.browser.alpha"') && bcA.includes('"profile":"alpha"'), bcA.trim());

const stA = installStatus(home, 'alpha');
check('installStatus reports scope', stA.profile === 'alpha' && stA.nativeHost === 'com.dsh.browser.alpha' && stA.installed === true, JSON.stringify(stA).slice(0, 140));
check('unscoped status ignores profile dirs', installStatus(home).profile === undefined);
let badProfile = false;
try {
  runSetup({ wsUrl, home, profile: '../escape' });
} catch {
  badProfile = true;
}
check('path-traversal profile name rejected', badProfile);

// Chrome's NM host-name grammar is dot-separated word chars only — a hyphen in
// the name makes connectNative fail with "Invalid native messaging host name
// specified." and the host is never spawned. Profile names may contain
// hyphens, so the derived host name must not.
const pd = runSetup({ wsUrl: 'ws://127.0.0.1:3085/api/plugins/tool-browser/ws', home, profile: 'my-web-2' });
check('hyphenated profile yields a Chrome-legal host name', pd.nativeHost === 'com.dsh.browser.my_web_2', pd.nativeHost);
check('hyphenated profile manifest name is host-safe', /^com\.dsh\.browser(\.[A-Za-z0-9_]+)*$/.test(pd.nativeHost) && JSON.parse(readFileSync(pd.manifestPath, 'utf8')).name === pd.nativeHost, pd.nativeHost);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

