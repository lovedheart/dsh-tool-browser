/**
 * Process-local handoff sink. The Browser SDK facade calls {@link notifyHandoff}
 * when the model invokes `browser.handoff(...)`; the active Sandbox registers a
 * handler via {@link setHandoffSink} so the kernel can surface the signal on the
 * ExecResult. Only one kernel executes at a time per process in practice, and the
 * sink is reset per run, so a single slot is sufficient.
 */

export type HandoffSink = (reason: string, instructions: string) => void;

let current: HandoffSink | undefined;

/** Register the active handoff sink (called by Sandbox at construction / per run). */
export function setHandoffSink(sink: HandoffSink | undefined): void {
  current = sink;
}

/** Called by the Browser facade on handoff; no-op when no sink is registered. */
export function notifyHandoff(reason: string, instructions: string): void {
  current?.(reason, instructions);
}
