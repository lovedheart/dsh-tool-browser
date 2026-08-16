/**
 * Owner derivation — stable execution key for one controlled workspace path.
 * Ported from QwenPaw's `tool_entrypoint.derive_workspace_id`.
 */
import { createHash } from 'node:crypto';

/** Return a stable 16-hex-char workspace id for a workspace dir (or 'default'). */
export function deriveWorkspaceId(workspaceDir: string | null | undefined): string {
  if (!workspaceDir) return 'default';
  const resolved = workspaceDir.replace(/^~(?=\/|$)/, process.env.HOME ?? '').replace(/[\\/]+$/, '');
  return createHash('sha256').update(resolved, 'utf8').digest('hex').slice(0, 16);
}
