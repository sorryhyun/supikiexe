//! Claude CLI runner
//!
//! Spawns the `claude` CLI process and streams responses back via Tauri events.
//! Uses --print mode with streaming JSON output for real-time updates.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::command::ClaudeCommandBuilder;
use crate::state::{save_session_to_disk, DEV_MODE, SESSION_ID, SIDECAR_CWD, SUPIKI_MODE};

/// Streaming JSON events from Claude CLI
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    System {
        session_id: Option<String>,
        #[serde(default)]
        subtype: Option<String>,
    },
    Assistant {
        message: AssistantMessage,
    },
    User {
        #[serde(default)]
        #[allow(dead_code)]
        message: Option<serde_json::Value>,
    },
    Result {
        #[serde(default)]
        subtype: Option<String>,
        #[serde(default)]
        result: Option<String>,
        session_id: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
pub struct AssistantMessage {
    #[serde(default)]
    pub content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    ToolUse {
        #[allow(dead_code)]
        id: String,
        name: String,
        input: serde_json::Value,
    },
}

/// Event emitted to frontend when tool is used
#[derive(Debug, Serialize, Clone)]
pub struct ToolUseEvent {
    pub tool: String,
    pub input: serde_json::Value,
}

/// Get the path to the current executable (which runs MCP server with --mcp flag)
fn get_mcp_exe_path(_app: &tauri::AppHandle) -> Option<PathBuf> {
    std::env::current_exe().ok()
}

/// Write the MCP config file with the current executable path and --mcp flag
fn write_mcp_config(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mcp_exe_path =
        get_mcp_exe_path(app).ok_or("Could not find current executable")?;

    let mcp_exe_str = mcp_exe_path
        .canonicalize()
        .unwrap_or(mcp_exe_path.clone())
        .to_string_lossy()
        .to_string();

    // Remove \\?\ prefix on Windows
    let mcp_exe_str = if mcp_exe_str.starts_with(r"\\?\") {
        mcp_exe_str[4..].to_string()
    } else {
        mcp_exe_str
    };

    let config = serde_json::json!({
        "mcpServers": {
            "mascot": {
                "command": mcp_exe_str,
                "args": ["--mcp"]
            }
        }
    });

    // Write to temp directory
    let config_path = std::env::temp_dir().join("mascot-mcp.json");
    std::fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap())
        .map_err(|e| format!("Failed to write MCP config: {}", e))?;

    eprintln!("[Rust] Wrote MCP config to {:?}", config_path);
    Ok(config_path)
}

/// Get system prompt based on mode
fn get_system_prompt() -> String {
    let is_supiki = *SUPIKI_MODE.lock().unwrap();
    let is_dev = *DEV_MODE.lock().unwrap();

    if is_supiki {
        include_str!("../../supiki.txt").to_string()
    } else if is_dev {
        "You are Supiki, a helpful AI assistant mascot on the user's desktop. \
         You have access to Claude Code capabilities and can help with coding tasks. \
         Use set_emotion to express yourself and move_to to navigate the screen. \
         Be professional but friendly!"
            .to_string()
    } else {
        "You are Supiki, a friendly mascot that lives on the user's desktop. \
         You can express emotions using set_emotion and walk around using move_to. \
         Be cheerful and helpful! Keep responses concise."
            .to_string()
    }
}

/// Run a query using the Claude CLI
/// Returns immediately after spawning - results come via Tauri events
pub fn run_query(app: tauri::AppHandle, prompt: String, images: Vec<String>) -> Result<(), String> {
    // Write MCP config with correct executable path
    let mcp_config_path = write_mcp_config(&app)?;

    // Get session ID and dev mode state
    let session_id = SESSION_ID.lock().unwrap().clone();
    let is_dev = *DEV_MODE.lock().unwrap();

    // Build command arguments using builder
    let mut builder = ClaudeCommandBuilder::new()
        .with_streaming_output()
        .with_mcp_config(&mcp_config_path);

    // In dev mode, allow all tools and skip permission prompts
    // In normal mode, restrict to only mascot MCP tools
    if is_dev {
        builder = builder.with_skip_permissions();
    } else {
        builder = builder.with_allowed_tools(&[
            "mcp__mascot__set_emotion",
            "mcp__mascot__move_to",
            "mcp__mascot__capture_screenshot",
        ]);
    }

    let args = builder
        .with_system_prompt(get_system_prompt())
        .with_session_resume(session_id.as_ref())
        .with_prompt(prompt)
        .with_images(images)
        .build();

    eprintln!("[Rust] Running claude CLI with {} args", args.len());

    // Build the command
    let mut cmd = Command::new("claude");
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Set working directory if custom cwd is set
    let custom_cwd = SIDECAR_CWD.lock().unwrap().clone();
    if let Some(ref cwd) = custom_cwd {
        cmd.current_dir(cwd);
        eprintln!("[Rust] Using custom CWD: {}", cwd);
    }

    // Spawn the process
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn claude CLI: {}. Is Claude Code installed?", e))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take();

    // Spawn thread to read stdout and emit events
    let app_handle = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("[Rust] Error reading stdout: {}", e);
                    break;
                }
            };

            if line.trim().is_empty() {
                continue;
            }

            // Try to parse as JSON
            match serde_json::from_str::<StreamEvent>(&line) {
                Ok(event) => {
                    handle_stream_event(&app_handle, event);
                }
                Err(_) => {
                    // Not JSON, might be raw text or error
                    eprintln!("[Rust] Non-JSON line: {}", line);
                }
            }
        }

        // Wait for process to complete
        match child.wait() {
            Ok(status) => {
                if !status.success() {
                    let _ = app_handle.emit(
                        "agent-error",
                        serde_json::json!({
                            "error": format!("Claude CLI exited with status: {}", status)
                        }),
                    );
                }
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "agent-error",
                    serde_json::json!({
                        "error": format!("Failed to wait for claude CLI: {}", e)
                    }),
                );
            }
        }

        eprintln!("[Rust] Claude CLI process ended");
    });

    // Spawn thread to read stderr for logging
    if let Some(stderr) = stderr {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line_content) = line {
                    eprintln!("[Claude] {}", line_content);
                }
            }
        });
    }

    Ok(())
}

/// Handle a streaming event from Claude CLI
fn handle_stream_event(app: &tauri::AppHandle, event: StreamEvent) {
    match event {
        StreamEvent::System { session_id, subtype } => {
            eprintln!(
                "[Rust] System event: subtype={:?}, session_id={:?}",
                subtype, session_id
            );
            if let Some(sid) = session_id {
                *SESSION_ID.lock().unwrap() = Some(sid.clone());
                save_session_to_disk(&sid);
            }
        }
        StreamEvent::Assistant { message } => {
            for block in message.content {
                match block {
                    ContentBlock::Text { text } => {
                        let _ = app.emit("agent-stream", &text);
                    }
                    ContentBlock::ToolUse { name, input, .. } => {
                        eprintln!("[Rust] Tool use: {} with input: {:?}", name, input);

                        // Emit specific events based on tool
                        if name.contains("set_emotion") {
                            let _ = app.emit("agent-emotion", &input);
                        } else if name.contains("move_to") {
                            let _ = app.emit("clawd-move", &input);
                        } else if name.contains("capture_screenshot") {
                            // Screenshot handling would go here
                            eprintln!("[Rust] Screenshot requested");
                        }

                        // Also emit a generic tool-use event
                        let _ = app.emit(
                            "agent-tool-use",
                            ToolUseEvent {
                                tool: name,
                                input,
                            },
                        );
                    }
                }
            }
        }
        StreamEvent::Result {
            subtype,
            result,
            session_id,
        } => {
            eprintln!(
                "[Rust] Result: subtype={:?}, session_id={:?}",
                subtype, session_id
            );

            // Update session ID
            if let Some(sid) = session_id {
                *SESSION_ID.lock().unwrap() = Some(sid.clone());
                save_session_to_disk(&sid);
            }

            // Emit result event
            let _ = app.emit(
                "agent-result",
                serde_json::json!({
                    "success": subtype.as_deref() == Some("success"),
                    "text": result.unwrap_or_default()
                }),
            );
        }
        StreamEvent::User { .. } => {
            // Tool results, etc - usually don't need to emit to frontend
        }
    }
}

/// Clear the current session
pub fn clear_session() {
    *SESSION_ID.lock().unwrap() = None;
    eprintln!("[Rust] Session cleared");
}

/// Check if claude CLI is available
pub fn check_claude_available() -> Result<String, String> {
    match Command::new("claude").arg("--version").output() {
        Ok(output) => {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                Ok(version.trim().to_string())
            } else {
                Err("Claude CLI found but returned an error".to_string())
            }
        }
        Err(_) => Err(
            "Claude Code CLI is not installed. Please install it from https://claude.ai/download"
                .to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_system_prompt() {
        let prompt = get_system_prompt();
        assert!(prompt.contains("Supiki"));
    }

    #[test]
    fn test_clear_session() {
        *SESSION_ID.lock().unwrap() = Some("test-123".to_string());
        clear_session();
        assert!(SESSION_ID.lock().unwrap().is_none());
    }
}
