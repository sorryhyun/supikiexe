//! Sidecar process management
//!
//! Handles spawning, communicating with, and monitoring the AI agent sidecar process.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use tauri::Emitter;

use crate::state::{
    save_session_to_disk, DEV_MODE, SESSION_ID, SIDECAR_PROCESS, SIDECAR_STDIN, SUPIKI_MODE,
};

/// Sidecar mode: bundled exe or Node.js script
pub enum SidecarMode {
    /// Bundled standalone executable (production)
    BundledExe(PathBuf),
    /// Node.js script (development)
    NodeScript(PathBuf),
}

/// Get the sidecar path and mode
pub fn get_sidecar_mode() -> Option<SidecarMode> {
    if let Ok(exe_path) = std::env::current_exe() {
        let exe_dir = exe_path.parent()?;

        // First, try to find bundled exe (production mode)
        // Tauri extracts resources to a "resources" subdirectory on Windows
        let bundled_exe_paths = vec![
            exe_dir.join("agent-sidecar.exe"),
            exe_dir.join("sidecar").join("agent-sidecar.exe"),
            exe_dir.join("resources").join("agent-sidecar.exe"), // Tauri bundled resources
        ];

        for path in bundled_exe_paths {
            if path.exists() {
                println!("[Rust] Found bundled sidecar exe: {:?}", path);
                return Some(SidecarMode::BundledExe(path));
            }
        }

        // Fall back to Node.js script (development mode)
        let script_paths = vec![
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

        for path in script_paths {
            if path.exists() {
                // Canonicalize but strip Windows \\?\ prefix which Node.js doesn't handle
                if let Ok(canonical) = path.canonicalize() {
                    let path_str = canonical.to_string_lossy();
                    if path_str.starts_with(r"\\?\") {
                        return Some(SidecarMode::NodeScript(PathBuf::from(&path_str[4..])));
                    }
                    return Some(SidecarMode::NodeScript(canonical));
                }
                return Some(SidecarMode::NodeScript(path));
            }
        }
    }
    None
}

/// Spawn the sidecar process if not already running
pub fn ensure_sidecar_running(app: tauri::AppHandle) -> Result<(), String> {
    let mut process_guard = SIDECAR_PROCESS.lock().unwrap();

    // Check if sidecar is already running
    if let Some(ref mut child) = *process_guard {
        // Check if still alive
        match child.try_wait() {
            Ok(None) => return Ok(()), // Still running
            Ok(Some(_)) => {
                println!("[Rust] Sidecar exited, will restart");
            }
            Err(e) => {
                println!("[Rust] Error checking sidecar status: {}", e);
            }
        }
    }

    // Spawn new sidecar
    let sidecar_mode = get_sidecar_mode().ok_or("Could not find sidecar (exe or script)")?;

    let mut cmd = match &sidecar_mode {
        SidecarMode::BundledExe(exe_path) => {
            println!("[Rust] Starting bundled sidecar exe: {:?}", exe_path);
            let mut c = Command::new(exe_path);
            // Set working directory to exe location for prompt.txt
            if let Some(exe_dir) = exe_path.parent() {
                c.current_dir(exe_dir);
            }
            c
        }
        SidecarMode::NodeScript(script_path) => {
            println!("[Rust] Starting sidecar via Node.js: {:?}", script_path);
            let mut c = Command::new("node");
            c.arg(script_path);
            // Set working directory to project root for module resolution
            if let Some(parent) = script_path.parent() {
                if let Some(project_root) = parent.parent() {
                    c.current_dir(project_root);
                }
            }
            c
        }
    };

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Pass dev mode to sidecar via environment variable
    let dev_mode = *DEV_MODE.lock().unwrap();
    if dev_mode {
        cmd.env("CLAWD_DEV_MODE", "1");
        println!("[Rust] Spawning sidecar in DEV mode");
    }

    // Pass supiki mode to sidecar via environment variable
    let supiki_mode = *SUPIKI_MODE.lock().unwrap();
    if supiki_mode {
        cmd.env("CLAWD_SUPIKI_MODE", "1");
        println!("[Rust] Spawning sidecar in SUPIKI mode");
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Take stdin for sending commands
    let stdin = child.stdin.take().ok_or("Failed to capture sidecar stdin")?;
    *SIDECAR_STDIN.lock().unwrap() = Some(stdin);

    // Take stdout for reading responses
    let stdout = child.stdout.take().ok_or("Failed to capture sidecar stdout")?;

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
                            println!("[Rust] Sidecar is ready");
                        }
                        "stream" => {
                            if let Some(text) = json.get("text").and_then(|t| t.as_str()) {
                                let _ = app_handle.emit("agent-stream", text);
                            }
                        }
                        "emotion" => {
                            // Emit emotion event directly - no file polling needed!
                            let _ = app_handle.emit("agent-emotion", &json);
                        }
                        "walk_to_window" => {
                            // Emit walk-to-window event for frontend
                            let _ = app_handle.emit("walk-to-window", &json);
                        }
                        "move" => {
                            // Emit move event for frontend
                            let _ = app_handle.emit("clawd-move", &json);
                        }
                        "result" => {
                            // Update cached session ID and persist to disk
                            if let Some(sid) = json.get("sessionId").and_then(|s| s.as_str()) {
                                *SESSION_ID.lock().unwrap() = Some(sid.to_string());
                                save_session_to_disk(sid);
                            }
                            let _ = app_handle.emit("agent-result", &json);
                        }
                        "error" => {
                            let _ = app_handle.emit("agent-error", &json);
                        }
                        "ask-question" => {
                            // Forward AskUserQuestion to frontend
                            let _ = app_handle.emit("agent-ask-question", &json);
                        }
                        _ => {
                            // Emit raw for debugging
                            let _ = app_handle.emit("agent-raw", &line_content);
                        }
                    }
                }
            }
        }
        println!("[Rust] Sidecar stdout reader ended");
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

    *process_guard = Some(child);
    println!("[Rust] Sidecar started successfully");
    Ok(())
}

/// Send a command to the sidecar
pub fn send_to_sidecar(cmd: &serde_json::Value) -> Result<(), String> {
    let mut stdin_guard = SIDECAR_STDIN.lock().unwrap();
    let stdin = stdin_guard.as_mut().ok_or("Sidecar not running")?;

    let cmd_str = serde_json::to_string(cmd).map_err(|e| format!("JSON error: {}", e))?;
    writeln!(stdin, "{}", cmd_str).map_err(|e| format!("Write error: {}", e))?;
    stdin.flush().map_err(|e| format!("Flush error: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sidecar_mode_enum() {
        // Test that SidecarMode variants can be created
        let exe_path = PathBuf::from("/test/agent-sidecar.exe");
        let script_path = PathBuf::from("/test/agent-sidecar.mjs");

        let _mode1 = SidecarMode::BundledExe(exe_path.clone());
        let _mode2 = SidecarMode::NodeScript(script_path.clone());

        // Verify paths match
        if let SidecarMode::BundledExe(p) = SidecarMode::BundledExe(exe_path.clone()) {
            assert_eq!(p, exe_path);
        }
        if let SidecarMode::NodeScript(p) = SidecarMode::NodeScript(script_path.clone()) {
            assert_eq!(p, script_path);
        }
    }

    #[test]
    fn test_send_to_sidecar_without_running_sidecar() {
        // Ensure stdin is None
        *SIDECAR_STDIN.lock().unwrap() = None;

        let cmd = serde_json::json!({
            "type": "test",
            "data": "hello"
        });

        let result = send_to_sidecar(&cmd);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Sidecar not running");
    }
}
