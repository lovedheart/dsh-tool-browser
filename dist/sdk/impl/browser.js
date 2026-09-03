/**
 * Concrete Browser implementation — wraps a BackendSession.
 * Ported from QwenPaw's `browser/sdk/facade.py` Browser class.
 */
import { createPageFactory } from "./page.js";
import { BrowserError } from "../../governance/errors.js";
import { raceAbort } from "../../kernel/run-control.js";
import { currentRunSignal } from "../../kernel/run-context.js";
/** Run a session op under the current run's abort signal (see locator.ts). */
function op(p) {
    return raceAbort(p, currentRunSignal());
}
/** Concrete Browser bound to one BackendSession. */
export class BrowserImpl {
    session;
    owner;
    pageFactory = createPageFactory();
    connected = true; // kernel pre-connects the session
    onHandoff;
    onClose;
    constructor(session, hooks) {
        this.session = session;
        this.owner = hooks?.owner ?? { workspace_id: '', session_id: '' };
        this.onHandoff = hooks?.onHandoff;
        this.onClose = hooks?.onClose;
    }
    /** Connect. The session is pre-connected by the kernel; this is a no-op check. */
    async connect() {
        if (!this.connected) {
            throw new BrowserError({
                category: 'FATAL',
                cause: 'config_invalid',
                reason: 'Browser session is not connected.',
                suggested_action: 'The kernel must create the session before the SDK is used.',
            });
        }
        return this;
    }
    /** Close this session's browser and release its context. */
    async close() {
        await this.session.close();
        this.connected = false;
        this.onClose?.();
    }
    /** Hand a step back to a human (captcha/login/2FA); the run stops here. */
    async handoff(reason, instructions) {
        // An aborted run must not record a (false) handoff — abort the run instead.
        currentRunSignal()?.throwIfAborted?.();
        if (this.session.isHeadless()) {
            throw new BrowserError({
                category: 'ASK_HUMAN',
                cause: 'headless_handoff',
                reason: 'cannot hand off in a headless session',
                suggested_action: 'Switch to a headed browser session by setting headless=false in the tool config.',
            });
        }
        // Report to the owning sandbox (wired by the kernel) so ExecResult.handoff
        // is populated. Per-sandbox routing means handoff signals never leak across
        // concurrently cached sessions. No-op outside the kernel (e.g. unit tests).
        this.onHandoff?.(reason, instructions ?? '');
        return { status: 'handoff', reason, instructions: instructions ?? '' };
    }
    /** Report owner, variant, context, connected state. */
    async sessionStatus() {
        return {
            owner: this.owner,
            variant: this.session.variant,
            context: 'auto',
            connected: this.connected,
        };
    }
    /** List open pages with url/title/active. */
    async pages() {
        return op(this.session.pages());
    }
    /** Open (or reuse active) page at url. */
    async open(url) {
        const bp = await op(this.session.openPage(url));
        return this.pageFactory.create(bp);
    }
    /** Open a page retained for the chat lifetime. */
    async present(url) {
        const bp = await op(this.session.presentPage(url));
        return this.pageFactory.create(bp);
    }
    /** Make a page ref active for later operations. */
    async switchPage(page) {
        await op(this.session.switchPage(page.id));
    }
    /** Close a page ref in this session. */
    async closePage(page) {
        await op(this.session.closePage(page.id));
    }
}
/** Factory the kernel uses to bind a Browser to a live kernel/backend session. */
export function createBrowserFactory() {
    return {
        create(session, hooks) {
            return new BrowserImpl(session, hooks);
        },
    };
}
