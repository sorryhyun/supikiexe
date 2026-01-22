//! Tauri IPC commands
//!
//! All commands exposed to the frontend via tauri-specta.

use std::fs;
use std::process::Command;

use tauri::Manager;

use crate::claude::{check_claude_available, clear_session as clear_claude_session, run_query as run_claude_query};
use crate::codex::{check_codex_available_with_app, clear_session as clear_codex_session, run_query as run_codex_query};
use crate::state::{BackendMode, BACKEND_MODE, CODEX_SESSION_ID, DEV_MODE, MAX_RECENT_CWDS, RECENT_CWDS, SESSION_ID, SIDECAR_CWD, SUPIKI_MODE};

/// Send a message to the AI backend (Claude or Codex)
#[tauri::command]
#[specta::specta]
pub async fn send_agent_message(
    app: tauri::AppHandle,
    message: String,
    images: Vec<String>,
    _language: Option<String>,
) -> Result<(), String> {
    let mode = *BACKEND_MODE.lock().unwrap();

    println!(
        "[Rust] send_agent_message called with: {}, images: {}, backend: {:?}",
        message,
        images.len(),
        mode
    );

    // Route to appropriate backend
    match mode {
        BackendMode::Claude => run_claude_query(app, message, images),
        BackendMode::Codex => run_codex_query(app, message, images),
    }
}

/// Clear the current session (for active backend)
#[tauri::command]
#[specta::specta]
pub fn clear_agent_session() -> Result<(), String> {
    let mode = *BACKEND_MODE.lock().unwrap();
    match mode {
        BackendMode::Claude => {
            clear_claude_session();
            println!("[Rust] Claude session cleared");
        }
        BackendMode::Codex => {
            clear_codex_session();
            println!("[Rust] Codex session cleared");
        }
    }
    Ok(())
}

/// Get current session ID
#[tauri::command]
#[specta::specta]
pub fn get_session_id() -> Option<String> {
    SESSION_ID.lock().unwrap().clone()
}

/// Cancel the current query (no-op for CLI mode, process runs to completion)
#[tauri::command]
#[specta::specta]
pub fn stop_sidecar() {
    // In CLI mode, we can't easily cancel a running query
    // The process will run to completion
    println!("[Rust] Stop requested (CLI mode - no action taken)");
}

/// Quit the application
#[tauri::command]
#[specta::specta]
pub fn quit_app(app: tauri::AppHandle) {
    // Close all windows properly before exiting
    for (_, window) in app.webview_windows() {
        let _ = window.close();
    }

    app.exit(0);
}

/// Check if running in dev mode
#[tauri::command]
#[specta::specta]
pub fn is_dev_mode() -> bool {
    *DEV_MODE.lock().unwrap()
}

/// Check if running in supiki mode
#[tauri::command]
#[specta::specta]
pub fn is_supiki_mode() -> bool {
    *SUPIKI_MODE.lock().unwrap()
}

/// Set custom working directory for Claude CLI
/// Also clears the session to start fresh with the new cwd
#[tauri::command]
#[specta::specta]
pub fn set_sidecar_cwd(path: String) -> Result<(), String> {
    // Validate path exists
    if !std::path::Path::new(&path).is_dir() {
        return Err(format!("Directory does not exist: {}", path));
    }

    // Add to recent cwds (if not already the most recent)
    {
        let mut recent = RECENT_CWDS.lock().unwrap();
        // Remove if already in list
        recent.retain(|p| p != &path);
        // Add to front
        recent.insert(0, path.clone());
        // Trim to max size
        if recent.len() > MAX_RECENT_CWDS {
            recent.truncate(MAX_RECENT_CWDS);
        }
    }

    // Set current cwd
    *SIDECAR_CWD.lock().unwrap() = Some(path.clone());

    // Clear both sessions to start fresh with new cwd
    clear_claude_session();
    clear_codex_session();

    println!("[Rust] CWD set to: {} (sessions cleared)", path);
    Ok(())
}

/// Get current working directory (custom setting only)
#[tauri::command]
#[specta::specta]
pub fn get_sidecar_cwd() -> Option<String> {
    SIDECAR_CWD.lock().unwrap().clone()
}

/// Get actual working directory (custom if set, otherwise app's cwd)
#[tauri::command]
#[specta::specta]
pub fn get_actual_cwd() -> String {
    SIDECAR_CWD
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| {
            std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| ".".to_string())
        })
}

/// Open native folder picker dialog
#[tauri::command]
#[specta::specta]
pub async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;

    let result = app.dialog().file().blocking_pick_folder();
    result.map(|path| path.to_string())
}

/// Get recent working directories
#[tauri::command]
#[specta::specta]
pub fn get_recent_cwds() -> Vec<String> {
    RECENT_CWDS.lock().unwrap().clone()
}

/// Answer an AskUserQuestion from the agent
/// Note: In CLI mode, this is not supported as we use --print mode
#[tauri::command]
#[specta::specta]
pub fn answer_agent_question(
    _question_id: String,
    _questions_json: String,
    _answers: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    // In CLI mode with --print, we don't support interactive questions
    // The CLI runs to completion without interaction
    Err("Interactive questions not supported in CLI mode. Please use --print mode.".to_string())
}

/// Open a base64-encoded image in the system's default image viewer
/// The base64 string should include the data URL prefix (e.g., "data:image/png;base64,...")
#[tauri::command]
#[specta::specta]
pub fn open_image_in_viewer(base64_data: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    // Parse the data URL to extract mime type and base64 data
    let parts: Vec<&str> = base64_data.splitn(2, ',').collect();
    if parts.len() != 2 {
        return Err("Invalid base64 data URL format".to_string());
    }

    // Extract extension from mime type (e.g., "data:image/png;base64" -> "png")
    let header = parts[0];
    let extension = if header.contains("image/png") {
        "png"
    } else if header.contains("image/jpeg") || header.contains("image/jpg") {
        "jpg"
    } else if header.contains("image/gif") {
        "gif"
    } else if header.contains("image/webp") {
        "webp"
    } else if header.contains("image/bmp") {
        "bmp"
    } else {
        "png" // Default to png
    };

    // Decode base64
    let image_data = STANDARD
        .decode(parts[1])
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Create temp file path
    let temp_dir = std::env::temp_dir();
    let filename = format!("clawd-image-{}.{}", std::process::id(), extension);
    let temp_path = temp_dir.join(filename);

    // Write to temp file
    fs::write(&temp_path, &image_data)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    println!("[Rust] Opening image: {:?}", temp_path);

    // Open with system default viewer using shell
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &temp_path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to open image: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&temp_path)
            .spawn()
            .map_err(|e| format!("Failed to open image: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&temp_path)
            .spawn()
            .map_err(|e| format!("Failed to open image: {}", e))?;
    }

    Ok(())
}

/// Check if Claude CLI is available
#[tauri::command]
#[specta::specta]
pub fn check_claude_cli() -> Result<String, String> {
    check_claude_available()
}

/// Check if Codex CLI is available
#[tauri::command]
#[specta::specta]
pub fn check_codex_cli(app: tauri::AppHandle) -> Result<String, String> {
    check_codex_available_with_app(&app)
}

/// Get current backend mode (claude or codex)
#[tauri::command]
#[specta::specta]
pub fn get_backend_mode() -> String {
    match *BACKEND_MODE.lock().unwrap() {
        BackendMode::Claude => "claude".to_string(),
        BackendMode::Codex => "codex".to_string(),
    }
}

/// Set backend mode (claude or codex)
#[tauri::command]
#[specta::specta]
pub fn set_backend_mode(mode: String) -> Result<(), String> {
    let backend = match mode.as_str() {
        "claude" => BackendMode::Claude,
        "codex" => BackendMode::Codex,
        _ => return Err(format!("Invalid backend mode: {}. Use 'claude' or 'codex'.", mode)),
    };
    *BACKEND_MODE.lock().unwrap() = backend;
    println!("[Rust] Backend mode set to: {:?}", backend);
    Ok(())
}

/// Get Codex session ID
#[tauri::command]
#[specta::specta]
pub fn get_codex_session_id() -> Option<String> {
    CODEX_SESSION_ID.lock().unwrap().clone()
}

/// Clear Codex session specifically
#[tauri::command]
#[specta::specta]
pub fn clear_codex_session_cmd() -> Result<(), String> {
    clear_codex_session();
    println!("[Rust] Codex session cleared");
    Ok(())
}

/// Clear Claude session specifically
#[tauri::command]
#[specta::specta]
pub fn clear_claude_session_cmd() -> Result<(), String> {
    clear_claude_session();
    println!("[Rust] Claude session cleared");
    Ok(())
}
