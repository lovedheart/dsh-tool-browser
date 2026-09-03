/**
 * A page of the chrome-extension backend: BackendPage translated into CDP
 * calls over the NM bridge (chrome.debugger). Port of the verb layer of
 * QwenPaw's `control_link/chrome/cdp_verbs.py`, where rich DOM semantics
 * (locator resolution, act/read) are injected page-side via ./cdp-inject.ts.
 */
import type { BackendLocator, BackendPage, LocatorSpec } from '../ports.ts';
import type { CurrentSurface, Observation } from '../../sdk/contracts.ts';
import type { ExtSession } from '../chrome-extension.ts';
export declare class ExtPage implements BackendPage {
    private readonly session;
    readonly id: string;
    constructor(session: ExtSession, id: string);
    cdp<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
    private evalJson;
    goto(url: string): Promise<Record<string, unknown>>;
    goBack(): Promise<Record<string, unknown>>;
    goForward(): Promise<Record<string, unknown>>;
    reload(): Promise<Record<string, unknown>>;
    /** Poll document.readyState via JS (no event stream dependence). */
    waitForLoadState(state: string, timeoutMs?: number): Promise<void>;
    snapshot(query?: string): Promise<Observation>;
    currentSurface(): Promise<CurrentSurface>;
    screenshot(): Promise<{
        path: string;
    }>;
    input(kind: 'mouse' | 'keyboard', verb: 'click' | 'press' | 'wheel' | 'down' | 'move' | 'up', opts: {
        x?: number;
        y?: number;
        key?: string;
        delta_x?: number;
        delta_y?: number;
    }): Promise<Record<string, unknown>>;
    locator(spec: LocatorSpec): BackendLocator;
    frameLocator(selector: string): BackendLocator;
    close(): Promise<void>;
}
