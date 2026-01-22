# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Supiki is a desktop mascot application featuring animated characters that live on the user's desktop. Built with Tauri v2 (Rust backend) + React + TypeScript (frontend) + AI CLI backends (Claude Code or OpenAI Codex). The primary mascot is "Supiki", with "Clawd" available as a secondary option.

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
npm run dev:clawd    # Dev mode with CLAWD_DEV_MODE=1 (secondary mascot)
npm run dev-supiki   # Dev mode for Supiki (primary mascot)
npm run build        # Build for production
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

```
┌─────────────────────────────────────────────────────────────────┐
│                       Supiki.exe (Tauri)                         │
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
│  Supiki.exe --mcp (same binary, MCP server mode)                 │
│  └── Provides: set_emotion, move_to, capture_screenshot          │
└─────────────────────────────────────────────────────────────────┘
```

| Directory | Description |
|-----------|-------------|
| `src/` | React frontend - mascot UI, physics, state machine, chat components |
| `src-tauri/` | Rust backend - Tauri app, system tray, Claude CLI runner, MCP server |

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
  --system-prompt "You are Supiki..." \
  --resume <session-id> \
  "user prompt here"
```

**Streaming JSON events** (parsed in `claude/runner.rs`):
- `system` - Session initialization with session_id
- `assistant` - Text content and tool_use blocks
- `user` - Tool results
- `result` - Final result with session_id for resume

## MCP Server Tools

The main executable runs in two modes:
- **GUI mode** (default): Normal Tauri desktop application
- **MCP mode** (`--mcp` flag): MCP server via stdio for Claude CLI

Tools available to Claude (implemented in `src-tauri/src/mcp_server.rs`):
- `set_emotion` - Control the mascot's emotional expression (happy, sad, excited, thinking, etc.)
- `move_to` - Walk the mascot to screen position (left, right, center, or x-coordinate)
- `capture_screenshot` - Capture screen for visual context

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
- `src-tauri/src/claude/` - Claude CLI integration (command builder + runner)
- `src-tauri/src/codex/` - Codex CLI integration (command builder + runner)
- `src-tauri/src/mcp_server.rs` - MCP server for mascot control
- `src-tauri/src/state.rs` - `BackendMode` enum and session state
