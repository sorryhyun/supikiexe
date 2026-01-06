use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

/// Persistent sidecar process
static SIDECAR_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

/// Sidecar stdin for sending commands
static SIDECAR_STDIN: Mutex<Option<ChildStdin>> = Mutex::new(None);

/// Current session ID (maintained by sidecar, cached here)
static SESSION_ID: Mutex<Option<String>> = Mutex::new(None);

/// Get the session file path for persistence
fn get_session_file_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("claude-mascot").join("session.txt"))
}

/// Save session ID to disk
fn save_session_to_disk(session_id: &str) {
    if let Some(path) = get_session_file_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, session_id);
        println!("[Rust] Session saved to {:?}", path);
    }
}

/// Load session ID from disk
fn load_session_from_disk() -> Option<String> {
    let path = get_session_file_path()?;
    match fs::read_to_string(&path) {
        Ok(content) => {
            let session = content.trim().to_string();
            if !session.is_empty() {
                println!("[Rust] Loaded session from disk: {}", session);
                Some(session)
            } else {
                None
            }
        }
        Err(_) => None,
    }
}

/// Sidecar mode: bundled exe or Node.js script
enum SidecarMode {
    /// Bundled standalone executable (production)
    BundledExe(PathBuf),
    /// Node.js script (development)
    NodeScript(PathBuf),
}

/// Get the sidecar path and mode
fn get_sidecar_mode() -> Option<SidecarMode> {
    if let Ok(exe_path) = std::env::current_exe() {
        let exe_dir = exe_path.parent()?;

        // First, try to find bundled exe (production mode)
        let bundled_exe_paths = vec![
            exe_dir.join("agent-sidecar.exe"),
            exe_dir.join("sidecar").join("agent-sidecar.exe"),
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
fn ensure_sidecar_running(app: tauri::AppHandle) -> Result<(), String> {
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
fn send_to_sidecar(cmd: &serde_json::Value) -> Result<(), String> {
    let mut stdin_guard = SIDECAR_STDIN.lock().unwrap();
    let stdin = stdin_guard.as_mut().ok_or("Sidecar not running")?;

    let cmd_str = serde_json::to_string(cmd).map_err(|e| format!("JSON error: {}", e))?;
    writeln!(stdin, "{}", cmd_str).map_err(|e| format!("Write error: {}", e))?;
    stdin.flush().map_err(|e| format!("Flush error: {}", e))?;

    Ok(())
}

/// Send a message to Claude via the sidecar
#[tauri::command]
async fn send_agent_message(app: tauri::AppHandle, message: String) -> Result<(), String> {
    println!("[Rust] send_agent_message called with: {}", message);

    // Ensure sidecar is running
    ensure_sidecar_running(app)?;

    // Get current session ID
    let session_id = SESSION_ID.lock().unwrap().clone();

    // Send query command to sidecar
    let cmd = serde_json::json!({
        "type": "query",
        "prompt": message,
        "sessionId": session_id
    });

    send_to_sidecar(&cmd)?;

    Ok(())
}

/// Clear the current session
#[tauri::command]
fn clear_agent_session() -> Result<(), String> {
    *SESSION_ID.lock().unwrap() = None;

    // Tell sidecar to clear session too
    let cmd = serde_json::json!({
        "type": "clear_session"
    });

    send_to_sidecar(&cmd)
}

/// Get current session ID
#[tauri::command]
fn get_session_id() -> Option<String> {
    SESSION_ID.lock().unwrap().clone()
}

/// Stop the sidecar process
#[tauri::command]
fn stop_sidecar() {
    let mut process_guard = SIDECAR_PROCESS.lock().unwrap();
    if let Some(mut child) = process_guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        println!("[Rust] Sidecar stopped");
    }
    *SIDECAR_STDIN.lock().unwrap() = None;
}

/// Quit the application
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    stop_sidecar();
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            send_agent_message,
            clear_agent_session,
            get_session_id,
            stop_sidecar,
            quit_app
        ])
        .setup(|app| {
            // Load persisted session ID from disk
            if let Some(session_id) = load_session_from_disk() {
                *SESSION_ID.lock().unwrap() = Some(session_id);
            }

            // Create tray menu
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        // Stop sidecar before quitting
                        stop_sidecar();
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Only hide main window to tray - let other windows close normally
            if let WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if label == "main" {
                    println!("[Rust] Hiding main window to tray");
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
