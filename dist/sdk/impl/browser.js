/**
 * Concrete Browser implementation — wraps a BackendSession.
 * Ported from QwenPaw's `browser/sdk/facade.py` Browser class.
 */
import { createPageFactory } from "./page.js";
import { BrowserError } from "../../governance/errors.js";
/** Concrete Browser bound to one BackendSession. */
export class BrowserImpl {
    session;
    owner;
    pageFactory = createPageFactory();
    connected = true; // kernel pre-connects the session
    onHandoff;
    constructor(session, hooks) {
        this.session = session;
        this.owner = hooks?.owner ?? { workspace_id: '', session_id: '' };
        this.onHandoff = hooks?.onHandoff;
    }
    /** Connect as an identity. The session is pre-connected by the kernel. */
    async connect(_opts) {
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
    }
    /** Hand a step back to a human (captcha/login/2FA); the run stops here. */
    async handoff(reason, instructions) {
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
        return this.session.pages();
    }
    /** Open (or reuse active) page at url. */
    async open(url) {
        const bp = await this.session.openPage(url);
        return this.pageFactory.create(bp);
    }
    /** Open a page retained for the chat lifetime. */
    async present(url) {
        const bp = await this.session.presentPage(url);
        return this.pageFactory.create(bp);
    }
    /** Make a page ref active for later operations. */
    async switchPage(page) {
        await this.session.switchPage(page.id);
    }
    /** Close a page ref in this session. */
    async closePage(page) {
        await this.session.closePage(page.id);
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
