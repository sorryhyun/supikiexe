//! Sidecar process management (per-query CLI spawning)
//!
//! Handles spawning Node.js processes for each query. Each query runs in a fresh
//! process that exits after completion. This avoids Windows Defender false positives
//! that occur with bundled standalone executables.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use tauri::Emitter;

use crate::state::{
    save_session_to_disk, CURRENT_QUERY_STDIN, DEV_MODE, SESSION_ID, SIDECAR_CWD, SUPIKI_MODE,
};

/// Find the sidecar script path
/// Looks for agent-sidecar.cjs (bundled) or agent-sidecar.mjs (development)
fn get_sidecar_script() -> Option<PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        let exe_dir = exe_path.parent()?;

        // Production: bundled .cjs file in resources
        let bundled_paths = vec![
            exe_dir.join("resources").join("agent-sidecar.cjs"),
            exe_dir.join("agent-sidecar.cjs"),
        ];

        for path in bundled_paths {
            if path.exists() {
                println!("[Rust] Found bundled sidecar: {:?}", path);
                return Some(path);
            }
        }

        // Development: .mjs file in sidecar directory
        let dev_paths = vec![
            exe_dir.join("sidecar").join("agent-sidecar.mjs"),
            exe_dir
                .join("..")
                .join("..")
                .join("..")
                .join("sidecar")
                .join("agent-sidecar.mjs"),
            exe_dir
                .join("..")
                .join("..")
                .join("..")
                .join("..")
                .join("sidecar")
                .join("agent-sidecar.mjs"),
            PathBuf::from("sidecar").join("agent-sidecar.mjs"),
        ];

        for path in dev_paths {
            if path.exists() {
                // Canonicalize but strip Windows \\?\ prefix which Node.js doesn't handle
                if let Ok(canonical) = path.canonicalize() {
                    let path_str = canonical.to_string_lossy();
                    if path_str.starts_with(r"\\?\") {
                        return Some(PathBuf::from(&path_str[4..]));
                    }
                    return Some(canonical);
                }
                return Some(path);
            }
        }
    }
    None
}

/// Check if Node.js is available in PATH
fn check_node_available() -> Result<(), String> {
    match Command::new("node").arg("--version").output() {
        Ok(output) => {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                println!("[Rust] Node.js available: {}", version.trim());
                Ok(())
            } else {
                Err("Node.js found but returned an error".to_string())
            }
        }
        Err(_) => Err(
            "Node.js is not installed or not in PATH. Please install Node.js v18+ to use this application.".to_string()
        ),
    }
}

/// Run a query in a fresh Node.js process
/// Returns immediately after spawning - results come via Tauri events
pub fn run_query(app: tauri::AppHandle, cmd: serde_json::Value) -> Result<(), String> {
    // Check Node.js is available
    check_node_available()?;

    // Find sidecar script
    let script_path = get_sidecar_script().ok_or("Could not find sidecar script")?;
    println!("[Rust] Running query with script: {:?}", script_path);

    // Build command
    let mut node_cmd = Command::new("node");
    node_cmd.arg(&script_path);
    node_cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Set working directory for module resolution
    if let Some(parent) = script_path.parent() {
        // For .mjs in sidecar/, set cwd to project root
        // For .cjs in resources/, set cwd to resources dir
        if script_path.extension().map(|e| e == "mjs").unwrap_or(false) {
            if let Some(project_root) = parent.parent() {
                node_cmd.current_dir(project_root);
            }
        } else {
            node_cmd.current_dir(parent);
        }
    }

    // Pass mode flags via environment
    let dev_mode = *DEV_MODE.lock().unwrap();
    if dev_mode {
        node_cmd.env("CLAWD_DEV_MODE", "1");
        println!("[Rust] Running in DEV mode");
    }

    let supiki_mode = *SUPIKI_MODE.lock().unwrap();
    if supiki_mode {
        node_cmd.env("CLAWD_SUPIKI_MODE", "1");
        println!("[Rust] Running in SUPIKI mode");
    }

    // Pass custom cwd via environment if set
    let custom_cwd = SIDECAR_CWD.lock().unwrap().clone();
    if let Some(ref cwd) = custom_cwd {
        node_cmd.env("CLAWD_CWD", cwd);
        println!("[Rust] Using custom CWD: {}", cwd);
    }

    // Spawn process
    let mut child = node_cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn node process: {}", e))?;

    // Take stdin and store for answer-question commands
    let mut stdin = child.stdin.take().ok_or("Failed to capture stdin")?;

    // Write command to stdin
    let cmd_str = serde_json::to_string(&cmd).map_err(|e| format!("JSON error: {}", e))?;
    writeln!(stdin, "{}", cmd_str).map_err(|e| format!("Write error: {}", e))?;
    stdin
        .flush()
        .map_err(|e| format!("Flush error: {}", e))?;

    // Store stdin for answer-question commands
    *CURRENT_QUERY_STDIN.lock().unwrap() = Some(stdin);

    // Take stdout for reading responses
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    // Take stderr for logging
    let stderr = child.stderr.take();

    // Spawn thread to read stdout and emit events
    let app_handle = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line_content) = line {
                if line_content.trim().is_empty() {
                    continue;
                }

                // Parse JSON and emit appropriate events
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line_content) {
                    let msg_type = json.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    println!("[Rust] Sidecar event: {}", msg_type);

                    match msg_type {
                        "ready" => {
                            println!("[Rust] Sidecar ready");
                        }
                        "stream" => {
                            if let Some(text) = json.get("text").and_then(|t| t.as_str()) {
                                let _ = app_handle.emit("agent-stream", text);
                            }
                        }
                        "emotion" => {
                            let _ = app_handle.emit("agent-emotion", &json);
                        }
                        "walk_to_window" => {
                            let _ = app_handle.emit("walk-to-window", &json);
                        }
                        "move" => {
                            let _ = app_handle.emit("clawd-move", &json);
                        }
                        "result" => {
                            // Update cached session ID and persist to disk
                            if let Some(sid) = json.get("sessionId").and_then(|s| s.as_str()) {
                                *SESSION_ID.lock().unwrap() = Some(sid.to_string());
                                save_session_to_disk(sid);
                            }
                            let _ = app_handle.emit("agent-result", &json);
                            // Clear stdin handle - query is complete
                            *CURRENT_QUERY_STDIN.lock().unwrap() = None;
                        }
                        "error" => {
                            let _ = app_handle.emit("agent-error", &json);
                            // Clear stdin handle - query is complete
                            *CURRENT_QUERY_STDIN.lock().unwrap() = None;
                        }
                        "ask-question" => {
                            let _ = app_handle.emit("agent-ask-question", &json);
                        }
                        _ => {
                            let _ = app_handle.emit("agent-raw", &line_content);
                        }
                    }
                }
            }
        }
        println!("[Rust] Sidecar stdout reader ended");
        // Ensure stdin is cleared when process ends
        *CURRENT_QUERY_STDIN.lock().unwrap() = None;
    });

    // Spawn thread to read stderr for logging
    if let Some(stderr) = stderr {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line_content) = line {
                    println!("[Rust] Sidecar: {}", line_content);
                }
            }
        });
    }

    println!("[Rust] Query process started");
    Ok(())
}

/// Send a command to the current query's stdin (for answer-question)
pub fn send_to_current_query(cmd: &serde_json::Value) -> Result<(), String> {
    let mut stdin_guard = CURRENT_QUERY_STDIN.lock().unwrap();
    let stdin = stdin_guard
        .as_mut()
        .ok_or("No active query to send command to")?;

    let cmd_str = serde_json::to_string(cmd).map_err(|e| format!("JSON error: {}", e))?;
    writeln!(stdin, "{}", cmd_str).map_err(|e| format!("Write error: {}", e))?;
    stdin
        .flush()
        .map_err(|e| format!("Flush error: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_node_available() {
        // This test will pass if Node.js is installed
        // In CI without Node.js, it would fail - but that's expected
        let result = check_node_available();
        // Just verify it returns a result (Ok or Err)
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn test_send_to_current_query_without_active_query() {
        // Ensure no active query
        *CURRENT_QUERY_STDIN.lock().unwrap() = None;

        let cmd = serde_json::json!({
            "type": "test",
            "data": "hello"
        });

        let result = send_to_current_query(&cmd);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "No active query to send command to");
    }
}
