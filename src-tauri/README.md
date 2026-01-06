# Backend (Rust / Tauri v2)

## Files

- `src/lib.rs` - Tauri app setup with system tray, spawns Node.js sidecar process, handles stdio IPC
- `src/main.rs` - Entry point
- `tauri.conf.json` - Tauri configuration

## Window Configuration

Defined in `tauri.conf.json`:
- Size: 160x140 pixels
- Transparent, no decorations, always-on-top
- Skips taskbar, no shadow

## Commands

```bash
cargo build    # Build backend
cargo check    # Type-check Rust code
```

## Sidecar Communication

The Rust backend spawns and communicates with the Node.js sidecar (`sidecar/agent-sidecar.mjs`) via stdio. See `../sidecar/README.md` for the IPC protocol.
