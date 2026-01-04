# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Mascot is a desktop mascot application featuring "Clawd" - an animated character that lives on the user's desktop. Built with Tauri v2 (Rust backend) + React + TypeScript (frontend) + Claude Agent SDK (AI sidecar).

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Run in development mode (Tauri + Vite)
npm run build        # Build for production
npm run vite:build   # Build frontend only (TypeScript + Vite)
npm run icons        # Regenerate icons from source image
```

For Rust backend development:
```bash
cd src-tauri && cargo build    # Build Rust backend
cd src-tauri && cargo check    # Type-check Rust code
```

## Architecture

### Frontend (React/TypeScript)

- `src/App.tsx` - Main application component orchestrating physics, mascot state, and user interactions (drag, click, double-click)
- `src/Clawd.tsx` - SVG-based mascot component with CSS animations for different states
- `src/useMascotState.ts` - State machine managing mascot states: idle, walking, talking, jumping, falling
- `src/usePhysics.ts` - Physics engine handling gravity, collisions, walking, and window positioning via Tauri APIs
- `src/styles.css` - CSS animations for mascot states (idle bobbing, walking, jumping, falling, talking)

### Backend (Rust/Tauri)

- `src-tauri/src/lib.rs` - Tauri app setup with system tray, spawns Node.js sidecar process, handles stdio IPC
- `src-tauri/src/main.rs` - Entry point
- `src-tauri/tauri.conf.json` - Tauri configuration (transparent window, always-on-top, no decorations, 160x140 size)

### Agent Sidecar (Node.js + Claude Agent SDK)

The sidecar is a long-running Node.js process that handles AI conversations via the Claude Agent SDK. Rust communicates with it via stdio JSON-RPC.

- `sidecar/agent-sidecar.mjs` - Main sidecar process, handles IPC protocol with Rust
- `sidecar/tools/` - Modular MCP tools available to Claude:
  - `emotion.mjs` - `set_emotion` - Control Clawd's emotional expression
  - `time.mjs` - `get_current_time` - Get current date/time
  - `window.mjs` - `get_active_window` - Get focused window info (Windows)
  - `system.mjs` - `get_system_info` - Get system information
  - `screenshot.mjs` - `capture_screenshot` - Capture screen as base64 PNG
  - `clipboard.mjs` - `read_clipboard` - Read clipboard text/images
  - `index.mjs` - Exports `createAllTools({ emit, log })` factory

**IPC Protocol** (Rust ↔ Sidecar via stdio):
- `{ "type": "query", "prompt": "...", "sessionId": "..." }` - Send message to Claude
- `{ "type": "stream", "text": "..." }` - Streaming response text
- `{ "type": "emotion", "emotion": "...", "duration": ... }` - Emotion change
- `{ "type": "result", "sessionId": "...", "success": true }` - Query complete

### Emotions

- `src/emotions.ts` - Emotion types (neutral, happy, sad, excited, thinking, confused, surprised)
- Emotions are separate from physical states (walking, jumping, etc.)
- Claude sets emotions via `set_emotion` tool; frontend receives via Tauri events

### Key Behaviors

- **Physics**: Window moves via Tauri's `setPosition` API with gravity, floor/wall collisions, and bounce effects
- **Auto-walk**: Randomly triggers walking behavior every 3-10 seconds
- **Interactions**: Single-click on Clawd toggles chat mode; double-click toggles physics; drag on background repositions window
- **Direction**: Mascot faces left/right by CSS `scaleX(-1)` transform
- **Visual tools**: Claude can capture screenshots and read clipboard (text/images) to see what user is working on
