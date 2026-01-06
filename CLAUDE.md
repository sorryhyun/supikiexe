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
