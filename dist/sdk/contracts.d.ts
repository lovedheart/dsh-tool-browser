/**
 * Shared SDK data contracts, ported from QwenPaw's `browser/sdk/contracts.py`.
 * These are the value shapes the model reads back from Browser/Page/Locator
 * calls. Kept dependency-free so kernel, backend, and sdk all import them.
 */
/** Result of `page.snapshot()` — the primary perception surface. */
export interface Observation {
    /** Page text (accessibility/DOM derived). */
    readonly text: string;
    /** When a `query` was passed: how many lines matched. */
    readonly match_count?: number;
}
/** Result of `page.current_surface()`. */
export interface CurrentSurface {
    readonly url: string;
    readonly title: string;
    readonly load_state: 'load' | 'domcontentloaded' | 'networkidle' | string;
}
/** A page reference returned by `browser.pages()` / used by switch/close_page. */
export interface PageRef {
    readonly id: string;
    readonly url: string;
    readonly title: string;
    readonly active: boolean;
}
/** Identity a browser session connects as (QwenPaw `connect(identity=...)`). */
export type Identity = 'auto' | 'user' | 'avatar' | 'guest';
/** Result of `browser.session_status()`. */
export interface SessionStatus {
    readonly owner: {
        workspace_id: string;
        session_id: string;
    };
    readonly variant: string;
    readonly context: string;
    readonly connected: boolean;
}
/** The owner scoping one stateful kernel (workspace + session). */
export interface Owner {
    readonly workspace_id: string;
    readonly session_id: string;
}
/** Short evidence line returned by locator actions (`result.evidence`). */
export interface ActionEvidence {
    readonly evidence: string;
    [key: string]: unknown;
}
