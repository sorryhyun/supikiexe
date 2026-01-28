//! Claude CLI runner
//!
//! Spawns the `claude` CLI process and streams responses back via Tauri events.
//! Uses --print mode with streaming JSON output for real-time updates.
//! Handles interactive tools (ExitPlanMode, AskUserQuestion) via bidirectional stdin/stdout.

use std::io::{BufRead, BufReader, Cursor, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use base64::prelude::*;
use image::ImageFormat;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::command::ClaudeCommandBuilder;
use crate::state::{save_session_to_disk, DEV_MODE, SESSION_ID, SIDECAR_CWD, SUPIKI_MODE};

/// Global stdin handle for sending responses to Claude CLI
static CLAUDE_STDIN: std::sync::LazyLock<Arc<Mutex<Option<ChildStdin>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(None)));

/// Track active subagent (Task) IDs for the current conversation turn
static ACTIVE_SUBAGENTS: std::sync::LazyLock<Arc<Mutex<Vec<String>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(Vec::new())));

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

/// Event emitted when AskUserQuestion tool is used
/// Field names match frontend's AgentQuestionEvent type
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AskUserQuestionEvent {
    pub question_id: String, // This is the tool_use_id
    pub questions: Vec<QuestionData>,
}

/// Question data from AskUserQuestion tool
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuestionData {
    pub question: String,
    #[serde(default)]
    pub header: Option<String>,
    #[serde(default)]
    pub options: Vec<OptionData>,
    #[serde(default, rename = "multiSelect")]
    pub multi_select: bool,
}

/// Option data for AskUserQuestion
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OptionData {
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// Event emitted when ExitPlanMode tool is used
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExitPlanModeEvent {
    pub tool_use_id: String,
}

/// Event emitted when a subagent (Task tool) starts
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubagentStartEvent {
    pub task_id: String,
    pub description: String,
}

/// Event emitted when a subagent (Task tool) completes
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubagentEndEvent {
    pub task_id: String,
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
         Be professional but friendly! When using tables, keep them to 3 columns or fewer."
            .to_string()
    } else {
        "You are Supiki, a friendly mascot that lives on the user's desktop. \
         You can express emotions using set_emotion and walk around using move_to. \
         Be cheerful and helpful! Keep responses concise. When using tables, keep them to 3 columns or fewer."
            .to_string()
    }
}

/// Convert a base64 image to WebP format for smaller size
/// Returns (media_type, base64_data) tuple
fn convert_to_webp(base64_data: &str, original_media_type: &str) -> (String, String) {
    // Skip conversion if already WebP
    if original_media_type == "image/webp" {
        return ("image/webp".to_string(), base64_data.to_string());
    }

    // Try to decode and convert
    match BASE64_STANDARD.decode(base64_data) {
        Ok(image_bytes) => {
            let original_size = image_bytes.len();

            // Try to load the image
            match image::load_from_memory(&image_bytes) {
                Ok(img) => {
                    // Encode as WebP
                    let mut webp_buffer = Cursor::new(Vec::new());
                    match img.write_to(&mut webp_buffer, ImageFormat::WebP) {
                        Ok(()) => {
                            let webp_bytes = webp_buffer.into_inner();
                            let new_size = webp_bytes.len();
                            let savings = if original_size > 0 {
                                100.0 - (new_size as f64 / original_size as f64 * 100.0)
                            } else {
                                0.0
                            };
                            eprintln!(
                                "[Rust] Converted image to WebP: {} -> {} bytes ({:.1}% smaller)",
                                original_size, new_size, savings
                            );
                            let webp_base64 = BASE64_STANDARD.encode(&webp_bytes);
                            ("image/webp".to_string(), webp_base64)
                        }
                        Err(e) => {
                            eprintln!("[Rust] Failed to encode WebP: {}, using original", e);
                            (original_media_type.to_string(), base64_data.to_string())
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[Rust] Failed to load image: {}, using original", e);
                    (original_media_type.to_string(), base64_data.to_string())
                }
            }
        }
        Err(e) => {
            eprintln!("[Rust] Failed to decode base64: {}, using original", e);
            (original_media_type.to_string(), base64_data.to_string())
        }
    }
}

/// Send a tool result back to Claude CLI via stdin
/// Tool results must be wrapped in a user message structure for stream-json format
pub fn send_tool_result(tool_use_id: &str, content: &str, is_error: bool) -> Result<(), String> {
    let mut stdin_guard = CLAUDE_STDIN.lock().map_err(|e| format!("Lock error: {}", e))?;

    if let Some(ref mut stdin) = *stdin_guard {
        // Build the tool_result content block
        let tool_result_block = if is_error {
            serde_json::json!({
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": content,
                "is_error": true
            })
        } else {
            serde_json::json!({
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": content
            })
        };

        // Wrap in user message structure (same format as build_stream_json_message)
        let message = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [tool_result_block]
            }
        });

        let json_str = message.to_string();
        eprintln!("[Rust] Sending tool result: {}", json_str);

        stdin
            .write_all(json_str.as_bytes())
            .map_err(|e| format!("Failed to write tool result: {}", e))?;
        stdin
            .write_all(b"\n")
            .map_err(|e| format!("Failed to write newline: {}", e))?;
        stdin.flush().map_err(|e| format!("Failed to flush: {}", e))?;

        Ok(())
    } else {
        Err("Claude stdin not available".to_string())
    }
}

/// Send AskUserQuestion result back to Claude CLI via stdin
/// This uses the special format with toolUseResult for structured data
/// IMPORTANT: We include both a tool_result AND a text message so Claude responds to the answer
pub fn send_ask_user_question_result(
    tool_use_id: &str,
    content: &str,
    tool_use_result: serde_json::Value,
) -> Result<(), String> {
    let mut stdin_guard = CLAUDE_STDIN.lock().map_err(|e| format!("Lock error: {}", e))?;

    if let Some(ref mut stdin) = *stdin_guard {
        // Build the tool_result content block
        let tool_result_block = serde_json::json!({
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": content
        });

        // Also include a text block so Claude responds to the user's answer
        // Without this, Claude just sees a tool_result confirmation and ends the turn
        let text_block = serde_json::json!({
            "type": "text",
            "text": content
        });

        // Build message with both tool_result and text, plus toolUseResult field
        let message = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [tool_result_block, text_block]
            },
            "toolUseResult": tool_use_result
        });

        let json_str = message.to_string();
        eprintln!("[Rust] Sending AskUserQuestion result: {}", json_str);

        stdin
            .write_all(json_str.as_bytes())
            .map_err(|e| format!("Failed to write tool result: {}", e))?;
        stdin
            .write_all(b"\n")
            .map_err(|e| format!("Failed to write newline: {}", e))?;
        stdin.flush().map_err(|e| format!("Failed to flush: {}", e))?;

        Ok(())
    } else {
        Err("Claude stdin not available".to_string())
    }
}

/// Send AskUserQuestion response back to Claude CLI
/// The response must match Claude Code's expected format with human-readable content
/// and structured toolUseResult data
pub fn respond_to_ask_user_question(
    tool_use_id: &str,
    questions_json: &str,
    answers: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    // Parse the questions JSON
    let questions: serde_json::Value = serde_json::from_str(questions_json)
        .map_err(|e| format!("Failed to parse questions JSON: {}", e))?;

    // Build human-readable content string (matching Claude Code's format)
    let answers_text: Vec<String> = answers
        .iter()
        .map(|(q, a)| format!("\"{}\"=\"{}\"", q, a))
        .collect();
    let content = format!(
        "User has answered your questions: {}. You can now continue with the user's answers in mind.",
        answers_text.join(", ")
    );

    // Build the tool_use_result with structured data
    let tool_use_result = serde_json::json!({
        "questions": questions,
        "answers": answers
    });

    send_ask_user_question_result(tool_use_id, &content, tool_use_result)
}

/// Confirm ExitPlanMode - allows Claude to exit plan mode
pub fn confirm_exit_plan_mode(tool_use_id: &str) -> Result<(), String> {
    send_tool_result(tool_use_id, "Plan mode exited.", false)
}

/// Deny ExitPlanMode - keeps Claude in plan mode
pub fn deny_exit_plan_mode(tool_use_id: &str, reason: &str) -> Result<(), String> {
    send_tool_result(tool_use_id, reason, true)
}

/// Build a stream-json user message with text and optional images
fn build_stream_json_message(prompt: &str, images: &[String]) -> String {
    let mut content = vec![serde_json::json!({
        "type": "text",
        "text": prompt
    })];

    for image in images {
        // Parse base64 data URL to extract media type and data
        let (original_media_type, raw_data) = if image.starts_with("data:") {
            // Format: data:image/png;base64,<data>
            if let Some(comma_pos) = image.find(',') {
                let header = &image[5..comma_pos]; // skip "data:"
                let media_type = header.split(';').next().unwrap_or("image/png");
                let data = &image[comma_pos + 1..];
                (media_type.to_string(), data.to_string())
            } else {
                ("image/png".to_string(), image.clone())
            }
        } else {
            // Raw base64, assume PNG
            ("image/png".to_string(), image.clone())
        };

        // Convert to WebP for smaller size
        let (media_type, data) = convert_to_webp(&raw_data, &original_media_type);

        content.push(serde_json::json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": data
            }
        }));
    }

    let message = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": content
        }
    });

    message.to_string()
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
    // Use interactive streaming mode for bidirectional communication (needed for interactive tools)
    // Don't use --print flag as it causes the turn to complete immediately without waiting for tool results
    let mut builder = ClaudeCommandBuilder::new()
        .with_interactive_streaming()
        .with_streaming_input()
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

    builder = builder
        .with_system_prompt(get_system_prompt())
        .with_session_resume(session_id.as_ref());

    // Don't add prompt as CLI arg - we send everything via stdin for interactive mode
    // This ensures proper handling of tool results for AskUserQuestion etc.

    let args = builder.build();

    eprintln!(
        "[Rust] Running claude CLI with {} args, images={}",
        args.len(),
        images.len()
    );

    // Build the command
    // Always pipe stdin for bidirectional communication
    let mut cmd = Command::new("claude");
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // On Windows, hide the terminal window
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

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

    // Take stdin and store it globally for interactive tool responses
    if let Some(mut stdin) = child.stdin.take() {
        // Send the initial user message
        let message = build_stream_json_message(&prompt, &images);
        eprintln!(
            "[Rust] Sending stream-json message with {} images",
            images.len()
        );
        if let Err(e) = stdin.write_all(message.as_bytes()) {
            eprintln!("[Rust] Failed to write to stdin: {}", e);
        }
        if let Err(e) = stdin.write_all(b"\n") {
            eprintln!("[Rust] Failed to write newline: {}", e);
        }
        if let Err(e) = stdin.flush() {
            eprintln!("[Rust] Failed to flush stdin: {}", e);
        }

        // Store stdin globally for later interactive tool responses
        *CLAUDE_STDIN.lock().unwrap() = Some(stdin);
    }

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

        // Clean up global stdin reference
        *CLAUDE_STDIN.lock().unwrap() = None;

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
                        eprintln!("[Rust] Emitting agent-stream with {} chars", text.len());
                        let _ = app.emit("agent-stream", &text);
                    }
                    ContentBlock::ToolUse { id, name, input } => {
                        eprintln!("[Rust] Tool use: {} with input: {:?}", name, input);

                        // Handle Task tool - emit subagent start event
                        if name == "Task" {
                            let description = input
                                .get("description")
                                .and_then(|v| v.as_str())
                                .unwrap_or("task")
                                .to_string();
                            let task_id = format!("{}_{}", id.clone(), description.replace(' ', "_"));
                            eprintln!("[Rust] Task tool detected, emitting subagent-start: {}", task_id);

                            // Track this subagent
                            if let Ok(mut subagents) = ACTIVE_SUBAGENTS.lock() {
                                subagents.push(task_id.clone());
                            }

                            let _ = app.emit(
                                "subagent-start",
                                SubagentStartEvent {
                                    task_id,
                                    description,
                                },
                            );
                        }

                        // Handle interactive tools that need user response
                        if name == "ExitPlanMode" {
                            eprintln!("[Rust] ExitPlanMode tool detected, emitting event");
                            let _ = app.emit(
                                "agent-exit-plan-mode",
                                ExitPlanModeEvent {
                                    tool_use_id: id.clone(),
                                },
                            );
                        } else if name == "AskUserQuestion" {
                            eprintln!("[Rust] AskUserQuestion tool detected, emitting event");
                            // Parse questions from input
                            let questions: Vec<QuestionData> = input
                                .get("questions")
                                .and_then(|q| serde_json::from_value(q.clone()).ok())
                                .unwrap_or_default();

                            // Emit with the event name the frontend expects
                            let _ = app.emit(
                                "agent-ask-question",
                                AskUserQuestionEvent {
                                    question_id: id.clone(),
                                    questions,
                                },
                            );
                        } else if name.contains("set_emotion") {
                            // Emit specific events based on MCP tool
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

            // Emit subagent-end for all active subagents when conversation turn completes
            if let Ok(mut subagents) = ACTIVE_SUBAGENTS.lock() {
                for task_id in subagents.drain(..) {
                    eprintln!("[Rust] Emitting subagent-end for: {}", task_id);
                    let _ = app.emit(
                        "subagent-end",
                        SubagentEndEvent {
                            task_id,
                        },
                    );
                }
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
    let mut cmd = Command::new("claude");
    cmd.arg("--version");

    // On Windows, hide the terminal window
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.output() {
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
