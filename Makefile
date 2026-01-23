.PHONY: test test-ts test-rust dev dev-supiki dev-clawd build lint clean codegen-tauri

# Run all tests
test: test-ts test-rust

# Run TypeScript tests
test-ts:
	npm run test

# Run Rust tests (Tauri backend + MCP server)
test-rust:
	cd src-tauri && cargo test

# Development mode (using npx directly to avoid Windows batch job prompt)
dev:
	npx tauri dev || true

# Development mode (Supiki mascot with dev features)
dev-supiki:
	npx cross-env VITE_MASCOT_TYPE=supiki CLAWD_DEV_MODE=1 tauri dev || true

# Development mode (Clawd mascot with dev features)
dev-clawd:
	npx cross-env CLAWD_DEV_MODE=1 tauri dev || true

# Build production
build:
	npm run build

# Run linter
lint:
	npm run lint

# Type check
check: check-ts check-rust

check-ts:
	npm run vite:build

check-rust:
	cd src-tauri && cargo check

# Clean build artifacts
clean:
	rm -rf dist
	rm -rf artifacts
	cd src-tauri && cargo clean

# Generate TypeScript bindings from Rust commands
codegen-tauri:
	cd src-tauri && cargo run --bin codegen
