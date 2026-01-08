//! Tauri IPC commands
//!
//! All commands exposed to the frontend via tauri-specta.

use std::fs;
use std::process::Command;

use tauri::Manager;

use crate::sidecar::{run_query, send_to_current_query};
use crate::state::{
    CURRENT_QUERY_STDIN, DEV_MODE, MAX_RECENT_CWDS, RECENT_CWDS, SESSION_ID, SIDECAR_CWD,
    SUPIKI_MODE,
};

/// Send a message to Claude via a fresh sidecar process
#[tauri::command]
#[specta::specta]
pub async fn send_agent_message(
    app: tauri::AppHandle,
    message: String,
    images: Vec<String>,
) -> Result<(), String> {
    println!(
        "[Rust] send_agent_message called with: {}, images: {}",
        message,
        images.len()
    );

    // Get current session ID
    let session_id = SESSION_ID.lock().unwrap().clone();

    // Build query command
    let cmd = serde_json::json!({
        "type": "query",
        "prompt": message,
        "sessionId": session_id,
        "images": images
    });

    // Run query in a fresh Node.js process
    run_query(app, cmd)?;

    Ok(())
}

/// Clear the current session
#[tauri::command]
#[specta::specta]
pub fn clear_agent_session() -> Result<(), String> {
    *SESSION_ID.lock().unwrap() = None;
    println!("[Rust] Session cleared");
    Ok(())
}

/// Get current session ID
#[tauri::command]
#[specta::specta]
pub fn get_session_id() -> Option<String> {
    SESSION_ID.lock().unwrap().clone()
}

/// Cancel the current query (drops stdin, causing process to exit)
#[tauri::command]
#[specta::specta]
pub fn stop_sidecar() {
    // Drop the stdin handle to signal the process to exit
    *CURRENT_QUERY_STDIN.lock().unwrap() = None;
    println!("[Rust] Current query cancelled");
}

/// Quit the application
#[tauri::command]
#[specta::specta]
pub fn quit_app(app: tauri::AppHandle) {
    stop_sidecar();

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

/// Set custom working directory for sidecar
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

    // Clear session to start fresh with new cwd
    *SESSION_ID.lock().unwrap() = None;

    println!("[Rust] Sidecar CWD set to: {} (session cleared)", path);
    Ok(())
}

/// Get current sidecar working directory (custom setting only)
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
/// questions_json is a JSON string of the questions array (to preserve exact structure)
#[tauri::command]
#[specta::specta]
pub fn answer_agent_question(
    question_id: String,
    questions_json: String,
    answers: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    // Parse the questions JSON to embed in the command
    let questions: serde_json::Value = serde_json::from_str(&questions_json)
        .map_err(|e| format!("Invalid questions JSON: {}", e))?;

    let cmd = serde_json::json!({
        "type": "answer-question",
        "questionId": question_id,
        "questions": questions,
        "answers": answers
    });

    send_to_current_query(&cmd)
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
