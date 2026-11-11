/** Seconds to wait before retrying after a failed install attempt. */
export declare const FAILURE_COOLDOWN_SECONDS = 60;
/** Seconds to report while an install is in flight (poll interval). */
export declare const IN_FLIGHT_RETRY_SECONDS = 15;
export declare function __setReadyOverride(fn: (() => boolean) | null): void;
export declare function __setCliPathOverride(p: string | null): void;
/** Test hook: clear in-flight/cooldown state between scenarios. */
export declare function __resetManagedChromiumState(): void;
/**
 * Whether the current Playwright driver's exact Chromium build is on disk.
 * `executablePath()` only computes the expected path, so also stat it.
 */
export declare function managedChromiumReady(): boolean;
/**
 * Ensure one background Chromium install is running; return immediately.
 * Mirrors QwenPaw `ensure_managed_chromium()`: `[ready, detail, retryAfter]`.
 * When not ready, `retryAfter` is the seconds the caller should wait
 * (short poll while in flight, remaining cooldown after a failure).
 */
export declare function ensureManagedChromium(): Promise<[boolean, string, number]>;
