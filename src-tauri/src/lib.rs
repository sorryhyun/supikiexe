use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

/// Persistent sidecar process
static SIDECAR_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

/// Sidecar stdin for sending commands
static SIDECAR_STDIN: Mutex<Option<ChildStdin>> = Mutex::new(None);

/// Current session ID (maintained by sidecar, cached here)
static SESSION_ID: Mutex<Option<String>> = Mutex::new(None);

/// Get the sidecar script path
fn get_sidecar_path() -> Option<PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        let exe_dir = exe_path.parent()?;

        // Try various paths for development and production
        let possible_paths = vec![
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

        for path in possible_paths {
            if path.exists() {
                return Some(path.canonicalize().unwrap_or(path));
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
    let sidecar_path = get_sidecar_path().ok_or("Could not find sidecar script")?;
    println!("[Rust] Starting sidecar: {:?}", sidecar_path);

    let mut cmd = Command::new("node");
    cmd.arg(&sidecar_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Set working directory to project root for module resolution
    if let Some(parent) = sidecar_path.parent() {
        if let Some(project_root) = parent.parent() {
            cmd.current_dir(project_root);
        }
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
                        "result" => {
                            // Update cached session ID
                            if let Some(sid) = json.get("sessionId").and_then(|s| s.as_str()) {
                                *SESSION_ID.lock().unwrap() = Some(sid.to_string());
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            send_agent_message,
            clear_agent_session,
            get_session_id,
            stop_sidecar
        ])
        .setup(|app| {
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
