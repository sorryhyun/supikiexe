//! Codex CLI runner
//!
//! Spawns the `codex` CLI process and streams responses back via Tauri events.
//! Uses exec mode with JSON output for machine-readable streaming.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use tauri::{Emitter, Manager};

use crate::claude_runner::ToolUseEvent;
use crate::codex_command::CodexCommandBuilder;
use crate::state::{save_codex_session_to_disk, CODEX_SESSION_ID, DEV_MODE, SIDECAR_CWD, SUPIKI_MODE};

/// Codex JSONL event types
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum CodexStreamEvent {
    #[serde(rename = "thread.started")]
    ThreadStarted {
        #[serde(default)]
        thread_id: Option<String>,
    },

    #[serde(rename = "turn.started")]
    TurnStarted {
        #[serde(default)]
        turn_id: Option<String>,
    },

    #[serde(rename = "turn.completed")]
    TurnCompleted {
        #[serde(default)]
        turn_id: Option<String>,
    },

    #[serde(rename = "turn.failed")]
    TurnFailed {
        #[serde(default)]
        error: Option<String>,
    },

    #[serde(rename = "item.started")]
    ItemStarted {
        #[serde(default)]
        item: Option<CodexItem>,
    },

    #[serde(rename = "item.completed")]
    ItemCompleted {
        #[serde(default)]
        item: Option<CodexItem>,
    },

    #[serde(rename = "error")]
    Error {
        #[serde(default)]
        message: Option<String>,
    },
}

/// Codex item types
#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum CodexItem {
    #[serde(rename = "message")]
    Message {
        #[serde(default)]
        content: Vec<CodexContent>,
    },

    #[serde(rename = "tool_call")]
    ToolCall {
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        arguments: Option<serde_json::Value>,
    },

    #[serde(rename = "tool_result")]
    ToolResult {
        #[serde(default)]
        content: Option<String>,
    },

    #[serde(rename = "reasoning")]
    Reasoning {
        #[serde(default)]
        content: Option<String>,
    },

    #[serde(rename = "mcp_tool_call")]
    McpToolCall {
        #[serde(default)]
        server: Option<String>,
        #[serde(default)]
        tool: Option<String>,
        #[serde(default)]
        arguments: Option<serde_json::Value>,
        #[serde(default)]
        result: Option<serde_json::Value>,
        #[serde(default)]
        error: Option<String>,
        #[serde(default)]
        status: Option<String>,
    },

    #[serde(rename = "agent_message")]
    AgentMessage {
        #[serde(default)]
        text: Option<String>,
    },
}

/// Codex content block
#[derive(Debug, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum CodexContent {
    #[serde(rename = "text")]
    Text {
        #[serde(default)]
        text: Option<String>,
    },
    #[serde(rename = "input_text")]
    InputText {
        #[serde(default)]
        text: Option<String>,
    },
    #[serde(rename = "output_text")]
    OutputText {
        #[serde(default)]
        text: Option<String>,
    },
}

/// Codex executable filename (from GitHub releases)
const CODEX_EXE_NAME: &str = "codex-x86_64-pc-windows-msvc.exe";

/// Get the path to codex executable
fn get_codex_exe_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    // In production, exe is in resources directory
    if let Ok(resource_dir) = app.path().resource_dir() {
        let exe_path = resource_dir.join(CODEX_EXE_NAME);
        if exe_path.exists() {
            return Some(exe_path);
        }
    }

    // In development, exe is in project root
    let dev_paths = vec![
        PathBuf::from(format!("../{}", CODEX_EXE_NAME)),
        PathBuf::from(CODEX_EXE_NAME),
    ];

    for path in dev_paths {
        if path.exists() {
            return Some(path);
        }
    }

    None
}

/// Get the path to the current executable (which runs MCP server with --mcp flag)
fn get_mcp_exe_path(_app: &tauri::AppHandle) -> Option<PathBuf> {
    std::env::current_exe().ok()
}

/// Write the MCP config to ~/.codex/config.toml
/// This merges with existing config to avoid overwriting user settings
fn write_codex_mcp_config(app: &tauri::AppHandle) -> Result<(), String> {
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

    // Escape backslashes for TOML
    let mcp_exe_str = mcp_exe_str.replace('\\', "\\\\");

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let codex_config_dir = home.join(".codex");
    let config_path = codex_config_dir.join("config.toml");

    // Create config directory if needed
    fs::create_dir_all(&codex_config_dir)
        .map_err(|e| format!("Failed to create .codex directory: {}", e))?;

    // Read existing config or create empty
    let existing_config = if config_path.exists() {
        fs::read_to_string(&config_path).unwrap_or_default()
    } else {
        String::new()
    };

    // Check if mascot server is already configured
    if existing_config.contains("[mcp_servers.mascot]") {
        // Update existing mascot config
        let mut lines: Vec<String> = existing_config.lines().map(String::from).collect();
        let mut in_mascot_section = false;
        let mut command_updated = false;

        for line in &mut lines {
            if line.trim() == "[mcp_servers.mascot]" {
                in_mascot_section = true;
            } else if line.trim().starts_with('[') && in_mascot_section {
                in_mascot_section = false;
            } else if in_mascot_section && line.trim().starts_with("command") {
                *line = format!("command = \"{}\"", mcp_exe_str);
                command_updated = true;
            }
        }

        if !command_updated && in_mascot_section {
            // Find the mascot section and add command after it
            for (i, line) in lines.clone().iter().enumerate() {
                if line.trim() == "[mcp_servers.mascot]" {
                    lines.insert(i + 1, format!("command = \"{}\"", mcp_exe_str));
                    break;
                }
            }
        }

        fs::write(&config_path, lines.join("\n"))
            .map_err(|e| format!("Failed to write config: {}", e))?;
    } else {
        // Append new mascot server config
        let mascot_config = format!(
            "\n[mcp_servers.mascot]\ncommand = \"{}\"\nargs = [\"--mcp\"]\n",
            mcp_exe_str
        );

        let new_config = format!("{}{}", existing_config, mascot_config);
        fs::write(&config_path, new_config)
            .map_err(|e| format!("Failed to write config: {}", e))?;
    }

    eprintln!("[Rust] Wrote Codex MCP config to {:?}", config_path);
    Ok(())
}

/// Save base64 images to temp files for Codex (which needs file paths)
fn save_images_to_temp(images: &[String]) -> Result<Vec<PathBuf>, String> {
    images
        .iter()
        .enumerate()
        .map(|(i, base64_data)| {
            // Parse the data URL to extract mime type and base64 data
            let parts: Vec<&str> = base64_data.splitn(2, ',').collect();
            let (extension, data) = if parts.len() == 2 {
                // Has data URL prefix
                let header = parts[0];
                let ext = if header.contains("image/png") {
                    "png"
                } else if header.contains("image/jpeg") || header.contains("image/jpg") {
                    "jpg"
                } else if header.contains("image/gif") {
                    "gif"
                } else if header.contains("image/webp") {
                    "webp"
                } else {
                    "png"
                };
                (ext, parts[1])
            } else {
                // Raw base64, assume PNG
                ("png", base64_data.as_str())
            };

            // Decode base64
            let image_data = STANDARD
                .decode(data)
                .map_err(|e| format!("Failed to decode base64 image: {}", e))?;

            // Write to temp file
            let temp_path = std::env::temp_dir()
                .join(format!("mascot-codex-image-{}-{}.{}", std::process::id(), i, extension));

            fs::write(&temp_path, &image_data)
                .map_err(|e| format!("Failed to write temp image: {}", e))?;

            eprintln!("[Rust] Saved image to {:?}", temp_path);
            Ok(temp_path)
        })
        .collect()
}

/// Get system prompt based on mode
fn get_system_prompt() -> String {
    let is_supiki = *SUPIKI_MODE.lock().unwrap();
    let is_dev = *DEV_MODE.lock().unwrap();

    if is_supiki {
        include_str!("../supiki.txt").to_string()
    } else if is_dev {
        "You are Clawd, a helpful AI assistant mascot on the user's desktop. \
         You have access to coding capabilities and can help with coding tasks. \
         Use mcp__mascot__set_emotion to express yourself and mcp__mascot__move_to to navigate the screen. \
         Be professional but friendly!"
            .to_string()
    } else {
        "You are Clawd, a friendly mascot that lives on the user's desktop. \
         You can express emotions using mcp__mascot__set_emotion and walk around using mcp__mascot__move_to. \
         Be cheerful and helpful! Keep responses concise."
            .to_string()
    }
}

/// Run a query using the Codex CLI
/// Returns immediately after spawning - results come via Tauri events
pub fn run_query(app: tauri::AppHandle, prompt: String, images: Vec<String>) -> Result<(), String> {
    // Get path to bundled codex executable
    let codex_exe = get_codex_exe_path(&app)
        .ok_or_else(|| format!(
            "Could not find {}. Please download it from https://github.com/openai/codex/releases",
            CODEX_EXE_NAME
        ))?;

    // Write MCP config
    write_codex_mcp_config(&app)?;

    // Save images to temp files if provided
    let image_paths = if !images.is_empty() {
        save_images_to_temp(&images)?
    } else {
        Vec::new()
    };

    // Check if we have a session to resume
    let session_id = CODEX_SESSION_ID.lock().unwrap().clone();
    let custom_cwd = SIDECAR_CWD.lock().unwrap().clone();

    // Build command arguments using builder
    let mut builder = CodexCommandBuilder::new()
        .with_session_resume(session_id.as_ref())
        .with_json_output()
        .with_full_auto()
        .with_skip_git_repo_check()
        .with_default_model_config();

    // Add system prompt via developer_instructions on first message
    if session_id.is_none() {
        builder = builder.with_system_prompt(&get_system_prompt());
    }

    let args = builder
        .with_working_directory(custom_cwd.as_ref())
        .with_images(&image_paths)
        .with_prompt(prompt)
        .build();

    eprintln!("[Rust] Running codex CLI: {:?} with {} args", codex_exe, args.len());

    // Build the command
    let mut cmd = Command::new(&codex_exe);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Spawn the process
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn codex CLI at {:?}: {}", codex_exe, e))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take();

    // Spawn thread to read stdout and emit events
    let app_handle = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut accumulated_text = String::new();

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
            match serde_json::from_str::<CodexStreamEvent>(&line) {
                Ok(event) => {
                    handle_codex_event(&app_handle, event, &mut accumulated_text);
                }
                Err(e) => {
                    // Not JSON, might be raw text or error
                    eprintln!("[Rust] Non-JSON line ({}): {}", e, line);
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
                            "error": format!("Codex CLI exited with status: {}", status)
                        }),
                    );
                }
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "agent-error",
                    serde_json::json!({
                        "error": format!("Failed to wait for codex CLI: {}", e)
                    }),
                );
            }
        }

        // Clean up temp images
        for path in image_paths {
            let _ = fs::remove_file(path);
        }

        eprintln!("[Rust] Codex CLI process ended");
    });

    // Spawn thread to read stderr for logging
    if let Some(stderr) = stderr {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line_content) = line {
                    eprintln!("[Codex] {}", line_content);
                }
            }
        });
    }

    Ok(())
}

/// Handle a streaming event from Codex CLI
fn handle_codex_event(app: &tauri::AppHandle, event: CodexStreamEvent, accumulated_text: &mut String) {
    match event {
        CodexStreamEvent::ThreadStarted { thread_id } => {
            eprintln!("[Rust] Codex thread started: {:?}", thread_id);
            if let Some(tid) = thread_id {
                *CODEX_SESSION_ID.lock().unwrap() = Some(tid.clone());
                save_codex_session_to_disk(&tid);
            }
        }

        CodexStreamEvent::TurnStarted { turn_id } => {
            eprintln!("[Rust] Codex turn started: {:?}", turn_id);
        }

        CodexStreamEvent::ItemStarted { item } => {
            if let Some(item) = item {
                match item {
                    CodexItem::Message { content } => {
                        for block in content {
                            if let Some(text) = extract_text_from_content(&block) {
                                if !text.is_empty() {
                                    accumulated_text.push_str(&text);
                                    let _ = app.emit("agent-stream", &text);
                                }
                            }
                        }
                    }
                    CodexItem::ToolCall { name, arguments } => {
                        handle_tool_call(app, name.as_deref(), &arguments);
                    }
                    CodexItem::McpToolCall { tool, arguments, .. } => {
                        handle_tool_call(app, tool.as_deref(), &arguments);
                    }
                    CodexItem::AgentMessage { text } => {
                        if let Some(t) = text {
                            if !t.is_empty() {
                                accumulated_text.push_str(&t);
                                let _ = app.emit("agent-stream", &t);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        CodexStreamEvent::ItemCompleted { item } => {
            if let Some(item) = item {
                match item {
                    CodexItem::Message { content } => {
                        for block in content {
                            if let Some(text) = extract_text_from_content(&block) {
                                if !text.is_empty() && !accumulated_text.contains(&text) {
                                    accumulated_text.push_str(&text);
                                    let _ = app.emit("agent-stream", &text);
                                }
                            }
                        }
                    }
                    CodexItem::ToolCall { name, arguments } => {
                        handle_tool_call(app, name.as_deref(), &arguments);
                    }
                    CodexItem::McpToolCall { tool, arguments, .. } => {
                        handle_tool_call(app, tool.as_deref(), &arguments);
                    }
                    CodexItem::AgentMessage { text } => {
                        if let Some(t) = text {
                            if !t.is_empty() && !accumulated_text.contains(&t) {
                                accumulated_text.push_str(&t);
                                let _ = app.emit("agent-stream", &t);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        CodexStreamEvent::TurnCompleted { turn_id } => {
            eprintln!("[Rust] Codex turn completed: {:?}", turn_id);
            let _ = app.emit(
                "agent-result",
                serde_json::json!({
                    "success": true,
                    "text": accumulated_text.clone()
                }),
            );
            accumulated_text.clear();
        }

        CodexStreamEvent::TurnFailed { error } => {
            eprintln!("[Rust] Codex turn failed: {:?}", error);
            let _ = app.emit(
                "agent-error",
                serde_json::json!({
                    "error": error.unwrap_or_else(|| "Turn failed".to_string())
                }),
            );
        }

        CodexStreamEvent::Error { message } => {
            eprintln!("[Rust] Codex error: {:?}", message);
            let _ = app.emit(
                "agent-error",
                serde_json::json!({
                    "error": message.unwrap_or_else(|| "Unknown error".to_string())
                }),
            );
        }
    }
}

/// Extract text from content block
fn extract_text_from_content(content: &CodexContent) -> Option<String> {
    match content {
        CodexContent::Text { text } => text.clone(),
        CodexContent::InputText { text } => text.clone(),
        CodexContent::OutputText { text } => text.clone(),
    }
}

/// Handle tool call events
fn handle_tool_call(app: &tauri::AppHandle, name: Option<&str>, arguments: &Option<serde_json::Value>) {
    let name = match name {
        Some(n) => n,
        None => return,
    };

    let input = arguments.clone().unwrap_or(serde_json::json!({}));

    eprintln!("[Rust] Codex tool call: {} with input: {:?}", name, input);

    // Emit specific events based on tool
    if name.contains("set_emotion") {
        let _ = app.emit("agent-emotion", &input);
    } else if name.contains("move_to") {
        let _ = app.emit("clawd-move", &input);
    } else if name.contains("capture_screenshot") {
        eprintln!("[Rust] Screenshot requested via Codex");
    }

    // Also emit a generic tool-use event
    let _ = app.emit(
        "agent-tool-use",
        ToolUseEvent {
            tool: name.to_string(),
            input,
        },
    );
}

/// Clear the current Codex session
pub fn clear_session() {
    *CODEX_SESSION_ID.lock().unwrap() = None;
    eprintln!("[Rust] Codex session cleared");
}

/// Check if codex CLI is available (checks bundled binary locations)
pub fn check_codex_available() -> Result<String, String> {
    // Check known locations for bundled codex executable
    let dev_paths = vec![
        PathBuf::from(format!("../{}", CODEX_EXE_NAME)),
        PathBuf::from(CODEX_EXE_NAME),
    ];

    for path in dev_paths {
        if path.exists() {
            match Command::new(&path).arg("--version").output() {
                Ok(output) => {
                    if output.status.success() {
                        let version = String::from_utf8_lossy(&output.stdout);
                        return Ok(format!("{} (bundled)", version.trim()));
                    }
                }
                Err(e) => {
                    eprintln!("[Rust] Failed to run codex at {:?}: {}", path, e);
                }
            }
        }
    }

    Err(format!(
        "Codex CLI not found. Please download {} from https://github.com/openai/codex/releases",
        CODEX_EXE_NAME
    ))
}

/// Check if codex CLI is available (with app handle for resource path)
pub fn check_codex_available_with_app(app: &tauri::AppHandle) -> Result<String, String> {
    match get_codex_exe_path(app) {
        Some(path) => {
            match Command::new(&path).arg("--version").output() {
                Ok(output) => {
                    if output.status.success() {
                        let version = String::from_utf8_lossy(&output.stdout);
                        Ok(format!("{} (bundled)", version.trim()))
                    } else {
                        Err("Codex CLI found but returned an error".to_string())
                    }
                }
                Err(e) => Err(format!("Failed to run codex at {:?}: {}", path, e)),
            }
        }
        None => Err(format!(
            "Codex CLI not found. Please download {} from https://github.com/openai/codex/releases",
            CODEX_EXE_NAME
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_system_prompt() {
        let prompt = get_system_prompt();
        assert!(prompt.contains("Clawd") || prompt.contains("Supiki"));
    }

    #[test]
    fn test_clear_session() {
        *CODEX_SESSION_ID.lock().unwrap() = Some("test-thread-123".to_string());
        clear_session();
        assert!(CODEX_SESSION_ID.lock().unwrap().is_none());
    }

    #[test]
    fn test_parse_thread_started() {
        let json = r#"{"type": "thread.started", "thread_id": "abc123"}"#;
        let event: CodexStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            CodexStreamEvent::ThreadStarted { thread_id } => {
                assert_eq!(thread_id, Some("abc123".to_string()));
            }
            _ => panic!("Expected ThreadStarted event"),
        }
    }

    #[test]
    fn test_parse_turn_completed() {
        let json = r#"{"type": "turn.completed", "turn_id": "xyz789"}"#;
        let event: CodexStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            CodexStreamEvent::TurnCompleted { turn_id } => {
                assert_eq!(turn_id, Some("xyz789".to_string()));
            }
            _ => panic!("Expected TurnCompleted event"),
        }
    }

    #[test]
    fn test_parse_error() {
        let json = r#"{"type": "error", "message": "Something went wrong"}"#;
        let event: CodexStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            CodexStreamEvent::Error { message } => {
                assert_eq!(message, Some("Something went wrong".to_string()));
            }
            _ => panic!("Expected Error event"),
        }
    }
}
