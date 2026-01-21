#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Check for MCP mode BEFORE starting Tauri
    // When launched with --mcp, run as an MCP server via stdio
    if std::env::args().any(|a| a == "--mcp") {
        claude_mascot_lib::run_mcp_server();
        return;
    }

    claude_mascot_lib::run()
}
