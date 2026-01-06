# Agent Sidecar (Node.js + Claude Agent SDK)

Long-running Node.js process that handles AI conversations via the Claude Agent SDK. Rust communicates with it via stdio JSON-RPC.

For production builds, bundled into an executable via `@yao-pkg/pkg` (`npm run bundle:sidecar`).

## Files

- `agent-sidecar.mjs` - Main sidecar process, handles IPC protocol with Rust
- `tools/index.mjs` - Exports `createAllTools({ emit, log })` factory

## Tools

| Tool | File | Description |
|------|------|-------------|
| `set_emotion` | `emotion.mjs` | Control Clawd's emotional expression |
| `get_current_time` | `time.mjs` | Get current date/time |
| `get_active_window` | `window.mjs` | Get focused window info (Windows) |
| `get_system_info` | `system.mjs` | Get system information |
| `capture_screenshot` | `screenshot.mjs` | Capture screen as base64 PNG |
| `read_clipboard` | `clipboard.mjs` | Read clipboard text/images |
| `move_to` | `move.mjs` | Walk Clawd to screen position (left/right/center/coordinates) |
| `investigate_window` | `investigateWindow.mjs` | Walk toward active window curiously |

## IPC Protocol (Rust <-> Sidecar via stdio)

**Inbound (from Rust):**
- `{ "type": "query", "prompt": "...", "sessionId": "..." }` - Send message to Claude

**Outbound (to Rust):**
- `{ "type": "stream", "text": "..." }` - Streaming response text
- `{ "type": "emotion", "emotion": "...", "duration": ... }` - Emotion change
- `{ "type": "move", "target": "...", "x": ... }` - Move Clawd to position
- `{ "type": "walk_to_window", "targetX": ..., "windowTitle": "..." }` - Walk to window
- `{ "type": "result", "sessionId": "...", "success": true }` - Query complete
