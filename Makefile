.PHONY: test test-ts test-rust dev build lint clean codegen-tauri

# Run all tests
test: test-ts test-rust

# Run TypeScript tests
test-ts:
	npm run test

# Run Rust tests (Tauri backend + MCP server)
test-rust:
	cd src-tauri && cargo test

# Development mode
dev:
	npm run dev

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
