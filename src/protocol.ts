/**
 * Frozen wire-protocol source of truth for the chrome-extension backend.
 * Ported from QwenPaw's `control_link/chrome/protocol.py` (+ protocol_mirror).
 * Values here are protocol facts shared by three parties: the host bridge,
 * the NM host process, and (diagnostically) the extension.
 */

export const PROTOCOL_VERSION = 2;
export const MIN_COMPATIBLE_PROTOCOL_VERSION = 2;

/** Chrome Native Messaging hard limits (protocol facts, not tunables). */
export const NM_MAX_INBOUND_BYTES = 64 * 1024 * 1024; // extension → host
export const NM_MAX_OUTBOUND_BYTES = 1024 * 1024; // host → extension (Chrome kills the host above this)

/** WS close codes in the app-reserved 4000-4999 range. */
export const NM_CLOSE_STDIN_EOF = 4000;
export const NM_CLOSE_FRAME_PROTOCOL = 4001;
export const NM_CLOSE_INBOUND_TOO_LARGE = 4002;
export const NM_CLOSE_INTERNAL_ERROR = 4003;

/** The NM host registration name (manifest file + connectNative arg). */
export const NATIVE_HOST_NAME = 'com.dsh.browser';

/** Identity this plugin announces in its hello; stable, not user-facing. */
export const ENTRY_ID = 'dsh-tool-browser';

/** Extension commands the host may invoke over the bridge. */
export const EXTENSION_COMMANDS = [
  'cdp.send',
  'command.execute',
  'command.status',
  'tabs.list',
  'tab.attach',
  'tab.detach',
  'tab.ensure',
  'tab.activate',
  'tab.close',
  'tab.create',
  'tab.metadata.commit',
  'extension.open_extensions_manager',
] as const;
export type ExtensionCommand = (typeof EXTENSION_COMMANDS)[number];

/** Values the NM host and extension mirror for contract comparison. */
export function contractSnapshot(): Record<string, number> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    minCompatibleProtocolVersion: MIN_COMPATIBLE_PROTOCOL_VERSION,
    nmMaxInboundBytes: NM_MAX_INBOUND_BYTES,
    nmMaxOutboundBytes: NM_MAX_OUTBOUND_BYTES,
  };
}
