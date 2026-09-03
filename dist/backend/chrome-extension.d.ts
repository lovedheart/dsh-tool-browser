/**
 * Chrome-extension backend for the ControlLink port.
 *
 * Drives the user's REAL Chrome — with no --remote-debugging-port flag — via
 * the DSH Browser extension's chrome.debugger channel, bridged through the
 * Native Messaging host and the NMBridge (see ./ext/bridge.ts). Port of
 * QwenPaw's `control_link/chrome/adapter.py` (session/page↔tab mapping) with
 * the CDP verbs executed page-side through injected JS (./ext/cdp-inject.ts).
 *
 * Key behaviours (mirroring the adapter):
 *   - isHeadless() is always false: this is the user's on-screen Chrome;
 *   - close() closes only the tabs THIS session created (tab.create marked
 *     them via createdByDsh); the user's own tabs are never touched;
 *   - every CDP call attaches lazily (tab.attach) and maps stale-tab wire
 *     errors to governed RETRYABLE/state_stale so the model re-opens a page.
 */
import type { BackendOptions, BackendPage, ControlLink } from './ports.ts';
import type { CurrentSurface, Observation, PageRef } from '../sdk/contracts.ts';
import { ExtPage } from './ext/cdp-page.ts';
/** Owner identity threaded to the extension for tab attribution (P5). */
export interface ExtOwner {
    ownerId: string;
    workspaceId: string;
}
declare class ExtSession {
    readonly owner: ExtOwner;
    readonly opts: BackendOptions;
    /** pageId -> Chrome tabId */
    readonly pages: Map<string, number>;
    readonly pageIdsByTab: Map<number, string>;
    private activePageId;
    needsReopen: boolean;
    constructor(owner: ExtOwner, opts: BackendOptions);
    get ownerId(): string;
    get workspaceId(): string;
    /** Best-effort CDP re-enable for tabs that survived a bridge blip. */
    reenablePages(): void;
    cdp<T = Record<string, unknown>>(pageId: string, method: string, params?: Record<string, unknown>): Promise<T>;
    forgetPage(pageId: string, tabId: number): void;
    newPage(url?: string): Promise<ExtPage>;
    /** Reuse the active page when one exists (parity with PlaywrightSession.openPage). */
    openPage(url?: string): Promise<BackendPage>;
    presentPage(url?: string): Promise<BackendPage>;
    listPages(): Promise<PageRef[]>;
    evaluateJson<T>(pageId: string, expression: string, awaitPromise?: boolean): Promise<T>;
    switchPage(pageId: string): void;
    closePage(pageId: string): Promise<void>;
    /** Close only OUR tabs; never the user's browser (QwenPaw parity). */
    close(): Promise<void>;
    isHeadless(): boolean;
    screenshotTo(pageId: string, file: string): Promise<{
        path: string;
    }>;
    get workspaceDir(): string;
    path(...parts: string[]): string;
}
export declare function createChromeExtensionControlLink(owner?: ExtOwner): ControlLink;
export { ExtSession, ExtPage };
export type { Observation, CurrentSurface };
