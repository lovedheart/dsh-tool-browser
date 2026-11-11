/**
 * Identity-model unit checks (no browser launched).
 * Ports QwenPaw `browser.identity` semantics; run via `npm test` or
 * `node --import tsx test/e2e-identity.ts`.
 */
import assert from 'node:assert/strict';
import { resolveIdentitySelection, avatarProfileDirFor } from '../src/kernel/manager.ts';

const avatarDir = '/home/x/.dsh/tool-browser/avatar/ws1';

// auto, bridge down -> configured backend stands; playwright implies guest.
assert.deepEqual(
  resolveIdentitySelection({ backend: 'playwright' }, 'auto', false, avatarDir),
  { backend: 'playwright', userDataDir: undefined, identity: 'guest' },
);
// auto, bridge down, explicit extension backend -> user (legacy behavior).
assert.deepEqual(
  resolveIdentitySelection({ backend: 'chrome-extension' }, 'auto', false, avatarDir),
  { backend: 'chrome-extension', userDataDir: undefined, identity: 'user' },
);
// auto, bridge up -> user even on a playwright default.
assert.deepEqual(
  resolveIdentitySelection({ backend: 'playwright' }, 'auto', true, avatarDir),
  { backend: 'chrome-extension', userDataDir: undefined, identity: 'user' },
);
// avatar -> persistent profile default; explicit userDataDir wins.
assert.deepEqual(resolveIdentitySelection({ backend: 'playwright' }, 'avatar', false, avatarDir), {
  backend: 'playwright',
  userDataDir: avatarDir,
  identity: 'avatar',
});
assert.equal(
  resolveIdentitySelection({ backend: 'playwright', userDataDir: '/mine' }, 'avatar', false, avatarDir).userDataDir,
  '/mine',
);
// guest -> incognito even if a userDataDir was configured.
assert.equal(resolveIdentitySelection({ backend: 'playwright', userDataDir: '/mine' }, 'guest', false, avatarDir).userDataDir, undefined);
// user without bridge -> ASK_HUMAN with an actionable message.
assert.throws(
  () => resolveIdentitySelection({ backend: 'playwright' }, 'user', false, avatarDir),
  (e: any) => e.category === 'ASK_HUMAN' && /extension/i.test(e.message ?? String(e)),
);
// user with bridge -> chrome-extension.
assert.equal(resolveIdentitySelection({ backend: 'playwright' }, 'user', true, avatarDir).backend, 'chrome-extension');
// avatar profile dir is sanitized per workspace under ~/.dsh.
const dir = avatarProfileDirFor('a/b:c');
assert.ok(dir.includes('.dsh') && dir.endsWith('a_b_c'), dir);

console.log('e2e-identity: all assertions passed');
