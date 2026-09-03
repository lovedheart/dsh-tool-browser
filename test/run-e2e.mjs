// Sequential e2e runner for `npm test`.
//
// The e2e suites are plain `tsx` scripts (not vitest cases) — see each file.
// Each is executed as a child `node --import tsx <file>` process (its own
// event loop / browser processes), run in order. The runner exits non-zero if
// any suite fails. Set E2E_OFFLINE=1 to skip the real-network suite.
//
// Usage:
//   node test/run-e2e.mjs                 # minloop, integration, abort-preserve, network, cdp, launch-opts
//   E2E_OFFLINE=1 node test/run-e2e.mjs   # skip the network + launch-opts suites
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const offline = process.env.E2E_OFFLINE === '1';

// Suite files live next to this runner. The single-instance probe runs first:
// it fails the suite if `setup-peers.sh` wasn't run (dist would resolve a
// stale bundled dsh-tools instead of the harness's, or the defineTool identity
// would differ). Locate the harness via `HARNESS_DSH=...` if auto-detect
// (nvm/PATH) can't find it.
const suites = [
  ['single-instance', 'probe-single-instance.mjs'],
  ['minloop', 'e2e-minloop.ts'],
  ['integration', 'e2e-plugin-integration.ts'],
  ['abort-preserve', 'e2e-abort-preserve.ts'],
  ...(offline ? [] : [['network', 'e2e-network.ts']]),
  ['cdp', 'e2e-cdp.ts'],
  ['ext-inject', 'e2e-ext-inject.ts'],
  ['ext-seam', 'e2e-ext-seam.ts'],
  ['ext-setup', 'e2e-ext-setup.ts'],
  ['ext-nmhost', 'e2e-ext-nmhost.ts'],
  ['ext-bridge', 'e2e-ext-bridge.ts'],
  ['ext-control', 'e2e-ext-control.ts'],
  ['ext-resilience', 'e2e-ext-resilience.ts'],
  ...(offline ? [] : [['launch-opts', 'e2e-launch-opts.ts']]),
];

let failed = 0;
for (const [name, file] of suites) {
  console.log(`\n===== e2e: ${name} (${file}) =====`);
  const res = spawnSync(process.execPath, ['--import', 'tsx', join(here, file)], {
    stdio: 'inherit',
    env: process.env,
  });
  const code = res.status;
  console.log(`===== e2e: ${name} -> ${code === 0 ? 'PASS' : `FAIL (exit ${code})`} =====`);
  if (code !== 0) failed++;
}

console.log(`\n${failed === 0 ? 'ALL E2E PASS' : `${failed} E2E SUITE(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
