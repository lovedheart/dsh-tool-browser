/**
 * Native Messaging host — a dumb pipe between the DSH Browser Chrome extension
 * and this DSH instance. Ported from QwenPaw's `assets/scripts/nm_host.py`.
 *
 * Chrome starts this process via the NM launcher whenever the extension calls
 * `chrome.runtime.connectNative()`. It then:
 *   1. reads `$DSH_HOME/nm-bridge.json` (ws_url + bearer token),
 *   2. opens the bridge WebSocket (Bearer auth) and runs the hello/hello_ack
 *      handshake (protocol v2),
 *   3. pumps frames both ways: stdio length-prefixed NM frames <-> WS JSON
 *      messages, until either side ends.
 *
 * Stdin is pumped as a STREAM (never a blocking sync loop): a sync read would
 * starve the event loop and deadlock the ws→extension direction. When the WS
 * is down, stdin is paused so extension frames queue in the OS pipe instead.
 *
 * Liveness: a 20s WS ping keepalive terminates half-open peers — without it a
 * zombie host would keep the extension believing the bridge is connected
 * (mirrors the Python host's reliance on websockets' default ping/pong).
 * Reconnect across a (short) core restart: exponential 0.5s..5s within a 120s
 * budget. Permanent hello rejections exit immediately.
 *
 * Flags: --probe echoes one frame (installer self-test); --check-runtime
 * verifies the environment can run this host.
 */
export {};
