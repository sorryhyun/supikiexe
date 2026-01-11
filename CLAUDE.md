# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Mascot is a desktop mascot application featuring "Clawd" - an animated character that lives on the user's desktop. Built with Tauri v2 (Rust backend) + React + TypeScript (frontend) + AI CLI backends (Claude Code or OpenAI Codex).

## Prerequisites

- Node.js v18+
- Rust toolchain
- **Claude Mode**: [Claude Code CLI](https://claude.ai/download) installed and authenticated
- **Codex Mode**: Download `codex-x86_64-pc-windows-msvc.exe` from [OpenAI Codex Releases](https://github.com/openai/codex/releases) and place in project root

Note: No API keys needed in env - both CLIs handle their own authentication.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Run in development mode (Tauri + Vite)
npm run dev:clawd    # Dev mode with CLAWD_DEV_MODE=1
npm run dev-supiki   # Dev mode for Supiki mascot variant
npm run build        # Build for production (builds MCP server + Tauri)
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
cd mascot-mcp && cargo build   # Build MCP server
```

```bash
make codegen-tauri   # Regenerate TypeScript bindings from Rust commands
```

## Testing

```bash
make test            # Run all tests (TypeScript + Rust + MCP)
make test-ts         # Run TypeScript tests only
make test-rust       # Run Rust tests only
make test-mcp        # Run MCP server tests only
npm run test         # Run TypeScript tests via npm
npm run test:watch   # Run TypeScript tests in watch mode
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Mascot.exe (Tauri)                     │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (React)                                                │
│  └── Chat UI, mascot rendering, event listeners                  │
├─────────────────────────────────────────────────────────────────┤
│  Backend (Rust)                                                  │
│  ├── Spawn `claude` CLI with args                                │
│  ├── Parse streaming JSON from stdout                            │
│  ├── Emit events to frontend                                     │
│  └── Store session_id for resume                                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │ spawn
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  claude (user's installed Claude Code CLI)                       │
│  --print --output-format stream-json --verbose                   │
│  --mcp-config mascot-mcp.json                                    │
│  --allowedTools "mcp__mascot__*"                                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │ stdio (MCP protocol)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  mascot-mcp.exe (Rust binary, ~500KB)                            │
│  └── Provides: set_emotion, move_to, capture_screenshot          │
└─────────────────────────────────────────────────────────────────┘
```

| Directory | Description |
|-----------|-------------|
| `src/` | React frontend - mascot UI, physics, state machine, chat components |
| `src-tauri/` | Rust backend - Tauri app, system tray, Claude CLI runner |
| `mascot-mcp/` | Rust MCP server - tools for controlling the mascot |

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

## Claude CLI Integration

The Rust backend spawns the Claude Code CLI with streaming JSON output:

```bash
claude --print \
  --output-format stream-json \
  --verbose \
  --mcp-config "path/to/mascot-mcp.json" \
  --allowedTools "mcp__mascot__set_emotion" "mcp__mascot__move_to" \
  --system-prompt "You are Clawd..." \
  --resume <session-id> \
  "user prompt here"
```

**Streaming JSON events** (parsed in `claude_runner.rs`):
- `system` - Session initialization with session_id
- `assistant` - Text content and tool_use blocks
- `user` - Tool results
- `result` - Final result with session_id for resume

## MCP Server Tools

Tools available to Claude (implemented in `mascot-mcp/src/main.rs`):
- `set_emotion` - Control Clawd's emotional expression (happy, sad, excited, thinking, etc.)
- `move_to` - Walk Clawd to screen position (left, right, center, or x-coordinate)
- `capture_screenshot` - Capture screen (placeholder for future implementation)

The MCP server uses the [rmcp](https://github.com/modelcontextprotocol/rust-sdk) crate for the Model Context Protocol implementation.

## Backend Modes

The app supports two AI backends, switchable via Settings:

### Claude Mode (default)
- Uses Claude Code CLI (`claude --print --output-format stream-json`)
- MCP config passed via `--mcp-config`
- Session resume via `--resume <session-id>`

### Codex Mode
- Uses bundled `codex-x86_64-pc-windows-msvc.exe`
- Download from: https://github.com/openai/codex/releases
- Command: `codex exec --json --full-auto "<prompt>"`
- MCP config written to `~/.codex/config.toml`
- Session resume via `codex exec resume <thread-id>`

**Implementation files:**
- `src-tauri/src/claude_runner.rs` - Claude CLI integration
- `src-tauri/src/codex_runner.rs` - Codex CLI integration
- `src-tauri/src/state.rs` - `BackendMode` enum and session state
