/**
 * The model-facing `browser` tool. Owns: the tool schema, the system-prompt
 * section, argument validation, the execute→KernelManager→render chain, overflow
 * spill, and presentation cards. Delegates all browser state to the kernel.
 */

import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { BrowserToolConfig } from './config.ts';
import type { KernelManager, ExecResult } from './kernel/types.ts';
import { createKernelManager } from './kernel/manager.ts';
import { renderExecResult } from './wire/render.ts';
import { deriveWorkspaceId } from './wire/owner.ts';

const BROWSER_TOOL_DESCRIPTION = `Drive a live browser by writing async JavaScript against the built-in Browser SDK.
Your code runs in a stateful runtime and the SDK is already in scope as Browser. Begin every session with:
    browser = await Browser.connect()
    page = await browser.open("https://example.com")

Work in a loop: read page state with await page.snapshot(), act through semantic
locators, and re-snapshot to confirm. For login, captcha, or 2FA, call
await browser.handoff(reason, instructions) and stop — never automate them.

The complete, authoritative reference ships with the browser skill. The API surface
is closed: anything not listed does not exist. Re-load the browser skill after
context compaction.

Arg: code — module-level async JavaScript (await; return a value or print()).`;

/** Build the owner key for the current DSH session/workspace. */
function ownerFor(ctx: any): { workspace_id: string; session_id: string } {
  // DSH session identity: prefer an explicit seam if present, else derive from cwd.
  const sessionId: string = ctx?.session?.id ?? 'default';
  const workspaceDir: string = ctx?.workspace?.dir ?? process.cwd();
  return { workspace_id: deriveWorkspaceId(workspaceDir), session_id: sessionId };
}

export function registerBrowserTool(ctx: any, config: BrowserToolConfig): void {
  const manager: KernelManager = createKernelManager({
    backend: config.backend,
    headless: config.headless,
    executablePath: config.executablePath,
    cdpUrl: config.cdpUrl,
    idleTtlMs: config.idleTtlMs,
    workspaceDir: () => (ctx?.workspace?.dir ?? process.cwd()),
  });

  // Effect-scoped teardown: dispose kernels when the plugin fiber unloads.
  ctx.addDispose?.(() => manager.dispose());

  ctx.systemPrompt.section({
    name: 'tool:browser',
    order: 120,
    text: 'Use the browser tool to drive a live web browser by writing async JavaScript against the Browser SDK (already in scope as Browser). Perceive with page.snapshot(), act via semantic locators, re-snapshot to verify. For login/captcha/2FA call browser.handoff(...) and stop.',
  });

  ctx.tools.register(
    defineTool({
      name: 'browser',
      description: BROWSER_TOOL_DESCRIPTION,
      parameters: {
        code: {
          type: 'string',
          required: true,
          description:
            'Module-level async JavaScript to run against the Browser SDK. May `return` a value or use print().',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'string' },
            stdout: { type: 'string' },
            error: { type: 'object', additionalProperties: true },
            handoff: {
              type: 'object',
              additionalProperties: false,
              properties: { reason: { type: 'string' }, instructions: { type: 'string' } },
            },
          },
        },
        render: (_args, value) => {
          const v = value as ExecResult;
          // Spill oversized output into the active workspace dir (idempotent by content hash).
          const spillDir = (ctx?.workspace?.dir ?? process.cwd()) as string | undefined;
          return [{ type: 'text', text: renderExecResult(v, config.maxOutputChars, spillDir) }];
        },
        presentationMeta: (_args, value) => {
          const v = value as ExecResult;
          return {
            ...(v.handoff ? { handoff: v.handoff.reason } : {}),
            isError: v.error !== undefined,
          };
        },
      },
      timeoutMs: config.execTimeoutMs,
      isConcurrencySafe: () => false, // one browser per session; serialize calls
      async execute(args, exec) {
        const code = String((args as { code?: unknown }).code ?? '');
        if (code.trim().length === 0) throw new Error('code must be a non-empty string');
        const owner = ownerFor(ctx);
        const result = await manager.execute({
          requestId: randomUUID(),
          code,
          owner,
        });
        // Forward cooperative cancellation into the kernel on abort.
        if (exec.signal?.aborted) await manager.closeSession(owner);
        if (result.handoff) manager.pin(owner);
        return result;
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'browser',
        kind: 'execute',
        rawInput: String((args as { code?: unknown }).code ?? '').slice(0, 200),
      }),
      presentResult: (args, result) => {
        if (result.isError) return undefined;
        return {
          card: 'generic',
          title: 'browser',
          content: undefined,
        };
      },
    }),
  );
}
