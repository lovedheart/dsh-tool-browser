import type { ControlLink } from './ports.ts';
export declare function __managedPoolSize(): number;
/**
 * Create a managed-CDP ControlLink: launches/attaches a standalone Chrome on
 * a persistent profile and drives it over CDP.
 *
 * `opts.userDataDir` (set by the manager for identity `managed`) selects the
 * pool key; `opts.cdpUrl` switches to attach-only mode on an existing
 * endpoint. The returned link's `release()` reaps every Chrome this link
 * launched but no longer holds.
 */
export declare function createManagedControlLink(holderId: string): ControlLink;
