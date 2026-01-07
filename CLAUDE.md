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
npm run build        # Build for production (bundles sidecar + Tauri build)
npm run vite:build   # Build frontend only (TypeScript + Vite)
npm run icons        # Regenerate icons from source image
```

```bash
cd src-tauri && cargo build    # Build Rust backend
cd src-tauri && cargo check    # Type-check Rust code
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
1. Add `#[tauri::command]` and `#[specta::specta]` to Rust function in `lib.rs`
2. Register in `tauri_specta::collect_commands![...]`
3. Run `npm run dev` to regenerate bindings
4. Import from `./bindings` in frontend
