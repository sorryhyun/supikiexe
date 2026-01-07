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

/// Dev mode flag (Claude Code features enabled)
static DEV_MODE: Mutex<bool> = Mutex::new(false);

/// Supiki mode flag (Supiki mascot instead of Clawd)
static SUPIKI_MODE: Mutex<bool> = Mutex::new(false);

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

    // Pass dev mode to sidecar via environment variable
    let dev_mode = *DEV_MODE.lock().unwrap();
    if dev_mode {
        cmd.env("CLAWD_DEV_MODE", "1");
        println!("[Rust] Spawning sidecar in DEV mode");
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
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
fn get_session_id() -> Option<String> {
    SESSION_ID.lock().unwrap().clone()
}

/// Stop the sidecar process
#[tauri::command]
#[specta::specta]
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
#[specta::specta]
fn quit_app(app: tauri::AppHandle) {
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
fn is_dev_mode() -> bool {
    *DEV_MODE.lock().unwrap()
}

/// Check if running in supiki mode
#[tauri::command]
#[specta::specta]
fn is_supiki_mode() -> bool {
    *SUPIKI_MODE.lock().unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Check executable name for dev mode and supiki mode
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_name) = exe_path.file_stem().and_then(|s| s.to_str()) {
            if exe_name.contains("_dev") || exe_name.contains("-dev") {
                *DEV_MODE.lock().unwrap() = true;
                println!("[Rust] DEV mode enabled via executable name: {}", exe_name);
            }
            if exe_name.contains("supiki") {
                *SUPIKI_MODE.lock().unwrap() = true;
                println!("[Rust] SUPIKI mode enabled via executable name: {}", exe_name);
            }
        }
    }

    // Check for --dev argument
    let args: Vec<String> = std::env::args().collect();
    if args.contains(&"--dev".to_string()) {
        *DEV_MODE.lock().unwrap() = true;
        println!("[Rust] DEV mode enabled via --dev flag");
    }

    // Also check CLAWD_DEV_MODE environment variable
    if std::env::var("CLAWD_DEV_MODE").unwrap_or_default() == "1" {
        *DEV_MODE.lock().unwrap() = true;
        println!("[Rust] DEV mode enabled via CLAWD_DEV_MODE env var");
    }

    // Setup tauri-specta for type-safe commands
    let builder = tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            send_agent_message,
            clear_agent_session,
            get_session_id,
            stop_sidecar,
            quit_app,
            is_dev_mode,
            is_supiki_mode
        ]);

    // Export TypeScript bindings in debug builds
    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default()
                .header("/* eslint-disable */\n// @ts-nocheck"),
            "../src/bindings.ts",
        )
        .expect("Failed to export TypeScript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(builder.invoke_handler())
        .setup(|app| {
            // Start with fresh session on each launch
            // (Don't load persisted session - each launch is a new conversation)
            // Note: Sessions are still saved for chat history feature

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
                        // Close all windows properly before exiting
                        for (_, window) in app.webview_windows() {
                            let _ = window.close();
                        }
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
