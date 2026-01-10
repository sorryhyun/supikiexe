# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Mascot is a desktop mascot application featuring "Clawd" - an animated character that lives on the user's desktop. Built with Tauri v2 (Rust backend) + React + TypeScript (frontend) + Claude Agent SDK (AI sidecar).

## Prerequisites

- Node.js v18+
- Rust toolchain
- `ANTHROPIC_API_KEY` environment variable

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Run in development mode (Tauri + Vite)
npm run dev:clawd    # Dev mode with CLAWD_DEV_MODE=1
npm run dev-supiki   # Dev mode for Supiki mascot variant
npm run build        # Build for production (bundles sidecar + Tauri build)
npm run vite:build   # Build frontend only (TypeScript + Vite)
npm run icons        # Regenerate icons from source image
```

```bash
npm run lint         # Run ESLint on frontend
npm run lint:fix     # Run ESLint with auto-fix
```

```bash
cd src-tauri && cargo build    # Build Rust backend
cd src-tauri && cargo check    # Type-check Rust code
```

```bash
make codegen-tauri   # Regenerate TypeScript bindings from Rust commands
```

## Testing

```bash
make test            # Run all tests (TypeScript + Rust)
make test-ts         # Run TypeScript tests only
make test-rust       # Run Rust tests only
npm run test         # Run TypeScript tests via npm
npm run test:watch   # Run TypeScript tests in watch mode
```

## Architecture

| Directory | Description |
|-----------|-------------|
| `src/` | React frontend - mascot UI, physics, state machine, chat components |
| `src-tauri/` | Rust backend - Tauri app, system tray, sidecar IPC |
| `sidecar/` | Node.js AI agent - Claude SDK integration, MCP tools |

See README.md in each directory for details.

## Type-Safe IPC (tauri-specta)

Commands between frontend and Rust are type-safe via [tauri-specta](https://github.com/specta-rs/tauri-specta).

**Generated bindings**: `src/bindings.ts` (auto-generated, do not edit)

**Usage in frontend**:
```typescript
import { commands } from "./bindings";

await commands.sendAgentMessage("Hello");  // Type-checked!
const sessionId = await commands.getSessionId();  // Returns string | null
```

**Adding a new command**:
1. Add `#[tauri::command]` and `#[specta::specta]` to Rust function in `commands.rs`
2. Register in `tauri_specta::collect_commands![...]` in `lib.rs`
3. Run `npm run dev` to regenerate bindings (or `make codegen-tauri`)
4. Import from `./bindings` in frontend

## Adding New Windows

When creating a new window, add its label to `src-tauri/capabilities/default.json` in the `windows` array to grant it necessary permissions.

## Sidecar IPC Protocol

The Rust backend communicates with the Node.js sidecar via stdio JSON messages.

**Inbound (Rust → Sidecar)**:
```json
{ "type": "query", "prompt": "...", "sessionId": "..." }
```

**Outbound (Sidecar → Rust)**:
```json
{ "type": "stream", "text": "..." }
{ "type": "emotion", "emotion": "...", "duration": 3000 }
{ "type": "move", "target": "left", "x": 100 }
{ "type": "walk_to_window", "targetX": 500, "windowTitle": "..." }
{ "type": "result", "sessionId": "...", "success": true }
```

## Sidecar Tools

Tools available to the Claude agent (in `sidecar/tools/`):
- `set_emotion` - Control Clawd's emotional expression
- `move_to` - Walk Clawd to screen position
- `capture_screenshot` - Capture screen as base64 PNG
- `read_clipboard` - Read clipboard text/images
- `get_active_window` - Get focused window info
- `investigate_window` - Walk toward active window curiously
