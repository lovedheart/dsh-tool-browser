// Sequential e2e runner for `npm test`.
//
// The e2e suites are plain `tsx` scripts (not vitest cases) — see each file.
// Each is executed as a child `node --import tsx <file>` process (its own
// event loop / browser processes), run in order. The runner exits non-zero if
// any suite fails. Set E2E_OFFLINE=1 to skip the real-network suite.
//
// Usage:
//   node test/run-e2e.mjs                 # minloop, integration, network, cdp, launch-opts
//   E2E_OFFLINE=1 node test/run-e2e.mjs   # skip the network + launch-opts suites
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const offline = process.env.E2E_OFFLINE === '1';

// Suite files live next to this runner.
const suites = [
  ['minloop', 'e2e-minloop.ts'],
  ['integration', 'e2e-plugin-integration.ts'],
  ...(offline ? [] : [['network', 'e2e-network.ts']]),
  ['cdp', 'e2e-cdp.ts'],
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
