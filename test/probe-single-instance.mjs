// Strict verification for the dsh-tool-browser rc.8 fix. After setup-peers.sh:
//  (1) the identity-sensitive SDK peers (dsh-tools, dsh-system-prompt) must
//      resolve from dist/ INTO the harness rc.8 — same package, same module
//      instance (function identity) — NOT a stale bundled rc.6 real dir.
//  (2) the version-synced leaf libs (schemastery, cosmokit) must resolve to the
//      SAME version the harness runs (no drift), whether local or shared.
// Run from the plugin dir with the v22 node:
//   node test/probe-single-instance.mjs
import { createRequire } from 'node:module';
import { realpathSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const here = dirname(new URL(import.meta.url).pathname); // .../dsh-tool-browser/test
const root = join(here, '..');                            // .../dsh-tool-browser
// Resolve EXACTLY as dist/tool.js does (it imports bare specifiers from dist/).
const reqFromDist = createRequire(join(root, 'dist', 'tool.js'));

// Locate the harness's @deepseek-ai package root (the dir CONTAINING dsh-tools/
// etc.), mirroring setup-peers.sh. Override: HARNESS_DSH=<dir containing
// node_modules> OR the @deepseek-ai/dsh package root.
function detectHarnessPeerRoot() {
  const NM = '@deepseek-ai';
  const tryHas = (c) => { try { return c && readFileSync(join(c, 'dsh-tools', 'package.json'), 'utf8'); } catch { return null; } };
  // 1. explicit override
  if (process.env.HARNESS_DSH) {
    for (const c of [join(process.env.HARNESS_DSH, 'node_modules', NM), join(process.env.HARNESS_DSH, NM)]) {
      if (tryHas(c)) return c;
    }
  }
  // 2. global npm/pnpm install root
  try {
    const g = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const c = join(g, NM, 'dsh', 'node_modules', NM);
    if (tryHas(c)) return c;
  } catch { /* ignore */ }
  // 3. walk up from the `dsh` binary
  let dshBin = '';
  try { dshBin = execFileSync('bash', ['-lc', 'command -v dsh'], { encoding: 'utf8' }).trim().split('\n').pop(); } catch { /* ignore */ }
  if (dshBin) {
    let real = dshBin;
    try { real = execFileSync('readlink', ['-f', dshBin], { encoding: 'utf8' }).trim(); } catch { /* ignore */ }
    // real: <prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
    const c = join(dirname(real), '..', '..', 'node_modules', NM);
    if (tryHas(c)) return c;
  }
  return null;
}

const HARNESS = detectHarnessPeerRoot();
if (!HARNESS) {
  console.error('FAIL  could not locate the harness @deepseek-ai package root.');
  console.error('      set HARNESS_DSH=/path/to/@deepseek-ai/dsh (or the dir holding node_modules) and re-run.');
  process.exit(2);
}
const HARNESS_REAL = realpathSync(HARNESS);

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}
function pkgVersionOf(resolvedEntry) {
  let d = dirname(realpathSync(resolvedEntry));
  for (let i = 0; i < 6; i++) {
    try { return JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).version; }
    catch { d = dirname(d); }
  }
  return '?';
}
function harnessVersion(name) {
  try { return JSON.parse(readFileSync(join(HARNESS_REAL, name, 'package.json'), 'utf8')).version; }
  catch { return '?'; }
}

// (1) Identity-sensitive peers: must resolve INTO harness rc.8.
for (const name of ['dsh-tools', 'dsh-system-prompt']) {
  const spec = `@deepseek-ai/${name}`;
  const resolvedEntry = realpathSync(reqFromDist.resolve(spec));
  check(`${name}: dist resolves INTO harness rc.8`,
    resolvedEntry.startsWith(HARNESS_REAL + '/'), resolvedEntry);
  check(`${name}: version is rc.8`, pkgVersionOf(resolvedEntry) === '0.1.0-rc.8', pkgVersionOf(resolvedEntry));
}

// (2) The CRITICAL single-instance identity check for dsh-tools. Two instances
// (bundled rc.6 vs harness rc.8) would yield different function identities.
const distDshTools = reqFromDist('@deepseek-ai/dsh-tools');
const harnessReq = createRequire(join(HARNESS_REAL, 'dsh-tools', 'package.json'));
const harnessDshTools = harnessReq('@deepseek-ai/dsh-tools');
check('defineTool identity: dist === harness (single instance)',
  distDshTools.defineTool === harnessDshTools.defineTool,
  `dist@${distDshTools.defineTool?.name} harness@${harnessDshTools.defineTool?.name}`);
check('validateJsonSchemaValue identity: dist === harness',
  distDshTools.validateJsonSchemaValue === harnessDshTools.validateJsonSchemaValue);

// (3) Version-synced leaf libs: no drift vs harness (local or shared both OK).
for (const name of ['schemastery', 'cosmokit']) {
  const spec = `@deepseek-ai/${name}`;
  const hv = harnessVersion(name);
  const dv = pkgVersionOf(reqFromDist.resolve(spec));
  check(`${name}: version-synced with harness (no drift)`, dv === hv, `dist=${dv} harness=${hv}`);
}

console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
