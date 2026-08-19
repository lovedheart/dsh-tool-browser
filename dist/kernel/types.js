/**
 * Kernel contracts — the stateful execution core. Ported from QwenPaw's
 * `browser/execution/kernel.py` (KernelRuntime / BrowserKernelManager) and the
 * wire ExecRequest/ExecResult shapes.
 *
 * A {@link Kernel} is one connected Browser session for one Owner
 * (workspace+session). The {@link KernelManager} caches kernels per Owner,
 * enforces idle TTL, pins handoff-pending kernels, and tears them down on
 * session/workspace close. The model's `code` runs inside a Kernel via the
 * sandbox, so variables/pages persist across `browser(code)` calls.
 */
export {};
