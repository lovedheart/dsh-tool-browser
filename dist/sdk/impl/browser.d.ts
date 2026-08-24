/**
 * Concrete Browser implementation — wraps a BackendSession.
 * Ported from QwenPaw's `browser/sdk/facade.py` Browser class.
 */
import type { PageRef, SessionStatus } from '../contracts.ts';
import type { Browser, BrowserFactory, BrowserHooks } from '../facade.ts';
import type { Page } from '../page.ts';
import type { BackendSession } from '../../backend/ports.ts';
/** Concrete Browser bound to one BackendSession. */
export declare class BrowserImpl implements Browser {
    private readonly session;
    private readonly owner;
    private readonly pageFactory;
    private connected;
    private onHandoff;
    constructor(session: BackendSession, hooks?: BrowserHooks);
    /** Connect. The session is pre-connected by the kernel; this is a no-op check. */
    connect(): Promise<Browser>;
    /** Close this session's browser and release its context. */
    close(): Promise<void>;
    /** Hand a step back to a human (captcha/login/2FA); the run stops here. */
    handoff(reason: string, instructions?: string): Promise<{
        status: 'handoff';
        reason: string;
        instructions: string;
    }>;
    /** Report owner, variant, context, connected state. */
    sessionStatus(): Promise<SessionStatus>;
    /** List open pages with url/title/active. */
    pages(): Promise<PageRef[]>;
    /** Open (or reuse active) page at url. */
    open(url?: string): Promise<Page>;
    /** Open a page retained for the chat lifetime. */
    present(url?: string): Promise<Page>;
    /** Make a page ref active for later operations. */
    switchPage(page: PageRef): Promise<void>;
    /** Close a page ref in this session. */
    closePage(page: PageRef): Promise<void>;
}
/** Factory the kernel uses to bind a Browser to a live kernel/backend session. */
export declare function createBrowserFactory(): BrowserFactory;
