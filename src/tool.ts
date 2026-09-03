/**
 * The model-facing `browser` tool. Owns: the tool schema, the system-prompt
 * section, argument validation, the execute→KernelManager→render chain, overflow
 * spill, and presentation cards. Delegates all browser state to the kernel.
 */

import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { BrowserToolConfig } from './config.ts';
import type { KernelManager, ExecResult } from './kernel/types.ts';
import { createKernelManager, resolveHeadless } from './kernel/manager.ts';
import { renderExecResult } from './wire/render.ts';
import { deriveWorkspaceId } from './wire/owner.ts';

const BROWSER_TOOL_DESCRIPTION = `Drive a live browser by writing async JavaScript against the built-in Browser SDK.
Your code runs in a stateful runtime and the SDK is already in scope as Browser. Begin every session with:
    browser = await Browser.connect()
    page = await browser.open("https://example.com")

Work in a loop: read page state with await page.snapshot(), act through semantic
locators, and re-snapshot to confirm. For login, captcha, or 2FA, call
await browser.handoff(reason, instructions) and stop — never automate them.

Long calls are cut short by the per-call timeout: the call returns a RETRYABLE
error and your browser session (pages, state, variables) stays alive — retry
with a shorter step.

The complete, authoritative reference ships with the browser skill. The API surface
is closed: anything not listed does not exist. Re-load the browser skill after
context compaction.

Arg: code — module-level async JavaScript (await; return a value or print()).`;

/** Build the owner key for the current DSH session/workspace. */
function ownerFor(sessionId: string | undefined): { workspace_id: string; session_id: string } {
  // The dsh web process runs with its working directory set to the active
  // workspace; kernel state and output spills live there. The runtime does NOT
  // expose a singular `workspace` service on the plugin ctx (it provides
  // `workspaces`, plural, in the client runtime), so deriving from cwd is the
  // stable, throw-free seam — the proxy ctx rejects undeclared props.
  const workspaceDir: string = process.cwd();
  return { workspace_id: deriveWorkspaceId(workspaceDir), session_id: sessionId ?? 'default' };
}

export function registerBrowserTool(ctx: any, config: BrowserToolConfig): void {
  // The extension backend needs the WS bridge + setup routes on the webserver.
  // Mount them through a nested plugin so `webServer` is a declared inject —
  // other backends never touch it (the strict Cordis ctx proxy rejects
  // undeclared properties, and non-web deployments have no such service).
  if (config.backend === 'chrome-extension') {
    ctx.plugin(extensionBridgePlugin, config);
  }
  const manager: KernelManager = createKernelManager({
    backend: config.backend,
    headless: config.headless,
    executablePath: config.executablePath,
    cdpUrl: config.cdpUrl,
    args: config.args,
    proxy: config.proxy,
    viewport: config.viewport,
    userDataDir: config.userDataDir,
    idleTtlMs: config.idleTtlMs,
    workspaceDir: () => process.cwd(),
  });

  // Effect-scoped teardown: Cordis auto-mixes `effect` onto the ctx (no inject
  // needed). Registering the disposer as an effect disposes the kernels when
  // the plugin fiber unloads. (ctx.addDispose does not exist on the real
  // runtime; the e2e fake ctx invented it.)
  ctx.effect(() => {
    return () => {
      try {
        manager.dispose();
      } catch {
        /* ignore */
      }
    };
  }, 'dsh-tool-browser: kernel manager');

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
            // The kernel stamps every ExecResult with a requestId; it MUST be
            // declared here, or the dsh-tools runtime's output-schema validation
            // (createSuccessResult) rejects every successful call with a
            // ToolOutputError.
            requestId: { type: 'string' },
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
          const spillDir = process.cwd();
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
        // Real session seam: the dispatch exec carries the calling agent, whose
        // session.id is stable per conversation. `exec.agent` is undefined for
        // the global view, in which case ownerFor falls back to 'default'.
        const owner = ownerFor(exec?.agent?.session?.id);
        const result = await manager.execute(
          { requestId: randomUUID(), code, owner },
          {
            // Headed deployments only: a handoff means a human takes over the
            // browser, so hold the kernel against the idle TTL until the model
            // resumes. (In headless mode handoff raises an error instead.)
            pinAfterHandoff: !resolveHeadless(config.headless),
            // Per-run cancellation: the host's tool timeoutMs / turn cancel
            // aborts this signal. The run then ends in a governed RETRYABLE
            // error and the browser SESSION survives — aborting a call must
            // never destroy open pages or state (QwenPaw: kill the worker,
            // keep the browser).
            signal: exec.signal,
          },
        );
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

/**
 * Wire the extension backend's server-side plumbing: the NM bridge WS upgrade,
 * plus `setup` / `status` HTTP routes. Disposes with the plugin fiber.
 */
export const extensionBridgePlugin = {
  name: 'tool-browser-extension-bridge',
  inject: ['webServer'],
  apply(ctx: any, config: BrowserToolConfig): void {
    void mountExtensionBridge(ctx, config.closeOrphanTabs);
  },
};

async function mountExtensionBridge(ctx: any, closeOrphanTabs = false): Promise<void> {
  const [bridgeMod, setupMod, resilienceMod] = await Promise.all([
    import('./backend/ext/bridge.ts'),
    import('./backend/ext/setup.ts'),
    import('./backend/ext/resilience.ts'),
  ]);
  resilienceMod.configureResilience({ closeOrphanTabs });
  const { mountBridge, BRIDGE_UPGRADE_PATH } = bridgeMod;
  const { installStatus, runSetup } = setupMod;
  const disposers: Array<() => void> = [mountBridge(ctx.webServer)];
  const base = '/api/plugins/tool-browser';
  disposers.push(
    ctx.webServer.register({
      kind: 'exact' as const,
      path: `${base}/chrome/status`,
      handler: (_req: any, res: any) => {
        try {
          const status = { ...installStatus(), bridge: bridgeMod.nmBridge.status() };
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(status));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
      },
    }),
  );
  disposers.push(
    ctx.webServer.register({
      kind: 'exact' as const,
      path: `${base}/chrome/setup`,
      handler: (_req: any, res: any) => {
        try {
          const wsUrl = `ws://127.0.0.1:${ctx.webServer.port}${BRIDGE_UPGRADE_PATH}`;
          const r = runSetup({ wsUrl });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...r }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
        }
      },
    }),
  );
  ctx.effect(() => () => {
    for (const d of disposers) {
      try {
        d();
      } catch {
        /* ignore */
      }
    }
  }, 'dsh-tool-browser: extension bridge');
}
