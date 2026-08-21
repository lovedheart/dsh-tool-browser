#!/usr/bin/env bash
# Repoint this plugin's IDENTITY-SENSITIVE SDK peers onto the harness's ACTUAL
# rc.x install (as symlinks), so a `link:`-installed dsh-tool-browser resolves
# `defineTool` / the system-prompt service to the SAME single copy the harness
# runs — instead of a stale frozen real dir that `npm i` left under
# node_modules/@deepseek-ai/.
#
# WHY only these two:
#   • dsh-tools           — the plugin calls `defineTool(...)` and hands the result
#                           to the harness's `ctx.tools.register(...)`. If the
#                           plugin's dsh-tools and the harness's dsh-tools are two
#                           different instances, an rc.x contract change to
#                           ToolDefinition / register validation can silently
#                           desync. One instance guarantees they can't drift.
#   • dsh-system-prompt   — same reason for `ctx.systemPrompt.section(...)`.
#
# WHAT we deliberately do NOT symlink (and why):
#   • schemastery (3.18.1) / cosmokit (1.8.2) — these are version-SYNCED leaf
#     data-lib deps, not identity-sensitive. More importantly, cosmokit is a
#     transitive dep of schemastery and its `.Dict` type leaks into the EMITTED
#     `Config` inferred type (dist/config.d.ts). Symlinking cosmokit to a path
#     OUTSIDE the project makes TypeScript declaration emit fail with
#     TS2742 ("cannot be named without a reference to '...' — not portable").
#     Keep them as LOCAL real dirs so the build stays portable.
#   • the remaining rc.6 dirs (dsh-agent, dsh-llm, dsh-scope, dsh-session, ...) —
#     these were only ever the OLD dsh-tools' transitive deps. Once dsh-tools is
#     a symlink into the harness, the harness copy resolves ITS deps in ITS OWN
#     node_modules, so these local copies are dead weight. They are harmless (the
#     harness never loads them), and keeping them local preserves build
#     portability. We leave them untouched rather than delete (avoids surprising
#     `npm i` diffs); a future `npm i` regenerates them from package.json.
#
# Idempotent: safe to re-run. Re-run after a dsh install/upgrade that moves the
# package (symlinks are absolute, so they go stale if the install moves).
#
# Usage:  bash setup-peers.sh            # or: npm run setup:peers

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NM="@deepseek-ai"
HERE_NM="$HERE/node_modules/$NM"

# Identity-sensitive SDK peers to share with the harness (single instance).
SHARED_PEERS=(dsh-tools dsh-system-prompt)

# --- locate the harness's @deepseek-ai package root --------------------------
# We want the DIRECTORY that CONTAINS the subpackages:
#   <dsh-install>/node_modules/@deepseek-ai     (has dsh-tools/, dsh-system-prompt/, ...)
detect_dsh_peer_root() {
  local c
  # 1. explicit override (dir containing node_modules, or the package itself)
  if [ -n "${DSH_INSTALL:-}" ]; then
    for c in "$DSH_INSTALL/node_modules/$NM" "$DSH_INSTALL/$NM"; do
      [ -d "$c" ] && [ -d "$c/dsh-tools" ] && { echo "$c"; return 0; }
    done
  fi
  # 2. global npm/pnpm install root (covers nvm, pnpm global, system)
  if nm="$(npm root -g 2>/dev/null)" && [ -d "$nm/$NM/dsh/node_modules/$NM/dsh-tools" ]; then
    echo "$nm/$NM/dsh/node_modules/$NM"; return 0
  fi
  # 3. walk up from the `dsh` binary to its package's nested node_modules
  local bin real
  bin="$(command -v dsh 2>/dev/null || true)"
  if [ -n "$bin" ]; then
    real="$(readlink -f "$bin" 2>/dev/null || true)"
    # real: <prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
    # peer root: <prefix>/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
    if [ -n "$real" ] && [ -d "$(dirname "$real")/../../node_modules/$NM/dsh-tools" ]; then
      echo "$(dirname "$real")/../../node_modules/$NM"; return 0
    fi
  fi
  return 1
}

if [ ! -d "$HERE_NM" ]; then
  echo "error: $HERE_NM does not exist — run a dsh install/link first." >&2
  exit 1
fi

if ! SRC_ROOT="$(detect_dsh_peer_root)"; then
  echo "error: could not find the harness @deepseek-ai package root from your dsh install." >&2
  echo "       install dsh (npm i -g @deepseek-ai/dsh) or set DSH_INSTALL=/path/to/@deepseek-ai/dsh." >&2
  exit 1
fi

HARNESS_TOOLS_VER="$(node -e 'console.log(require(process.argv[1]+"/package.json").version)' "$SRC_ROOT/dsh-tools" 2>/dev/null || echo '?')"
echo "harness @deepseek-ai root : $SRC_ROOT"
echo "harness dsh-tools version : $HARNESS_TOOLS_VER"
echo

for name in "${SHARED_PEERS[@]}"; do
  target="$SRC_ROOT/$name"
  if [ ! -d "$target" ]; then
    echo "error: harness has no $name at $target" >&2
    exit 1
  fi
  # remove existing (local real dir, or a stale symlink) then link
  rm -rf "$HERE_NM/$name"
  ln -s "$target" "$HERE_NM/$name"
  echo "link  @deepseek-ai/$name -> $target"
done

echo
echo "done. (schemastery/cosmokit + transitive deps intentionally left local.)"
echo "Re-run after a dsh install/upgrade that moves the package."
