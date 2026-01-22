//! Supiki - Tauri backend
//!
//! This is the main entry point for the Tauri application.
//! The codebase is organized into the following modules:
//!
//! - `state`: Global application state and session persistence
//! - `claude_runner`: Claude CLI process management
//! - `commands`: Tauri IPC commands exposed to the frontend
//! - `mcp_server`: MCP server for mascot control (run with --mcp flag)

mod claude;
mod codex;
mod commands;
pub mod mcp_server;
mod state;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Listener, Manager, WindowEvent,
};


use commands::{
    answer_agent_question, check_claude_cli, check_codex_cli, clear_agent_session,
    clear_claude_session_cmd, clear_codex_session_cmd, get_actual_cwd, get_backend_mode,
    get_codex_session_id, get_recent_cwds, get_session_id, get_sidecar_cwd, is_dev_mode,
    is_supiki_mode, open_image_in_viewer, pick_folder, quit_app, send_agent_message,
    set_backend_mode, set_sidecar_cwd, stop_sidecar,
};
use state::{DEV_MODE, SUPIKI_MODE};

/// Create the tauri-specta builder with all commands registered
/// This is extracted so it can be reused for codegen
pub fn create_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        send_agent_message,
        clear_agent_session,
        get_session_id,
        stop_sidecar,
        quit_app,
        is_dev_mode,
        is_supiki_mode,
        answer_agent_question,
        open_image_in_viewer,
        set_sidecar_cwd,
        get_sidecar_cwd,
        get_actual_cwd,
        get_recent_cwds,
        pick_folder,
        check_claude_cli,
        // Codex-related commands
        check_codex_cli,
        get_backend_mode,
        set_backend_mode,
        get_codex_session_id,
        clear_codex_session_cmd,
        clear_claude_session_cmd
    ])
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

    // Also check VITE_MASCOT_TYPE environment variable for supiki mode
    if std::env::var("VITE_MASCOT_TYPE").unwrap_or_default() == "supiki" {
        *SUPIKI_MODE.lock().unwrap() = true;
        println!("[Rust] SUPIKI mode enabled via VITE_MASCOT_TYPE env var");
    }

    // Check if Claude CLI is available
    match claude::check_claude_available() {
        Ok(version) => {
            println!("[Rust] Claude CLI available: {}", version);
        }
        Err(e) => {
            eprintln!("[Rust] Warning: {}", e);
            // Continue anyway - user might install it later
        }
    }

    // Check if Codex CLI is available
    match codex::check_codex_available() {
        Ok(version) => {
            println!("[Rust] Codex CLI available: {}", version);
        }
        Err(e) => {
            eprintln!("[Rust] Warning: {}", e);
            // Continue anyway - user might install it later
        }
    }

    // Setup tauri-specta for type-safe commands
    let builder = create_specta_builder();

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
        .plugin(tauri_plugin_dialog::init())
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

            // Disable WebView2 status bar and other browser UI on Windows
            #[cfg(windows)]
            {
                use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings;
                use windows_core::Interface;

                fn configure_webview(window: &tauri::WebviewWindow) {
                    let result = window.with_webview(|webview| unsafe {
                        match webview.controller().CoreWebView2() {
                            Ok(core) => {
                                match core.Settings() {
                                    Ok(settings) => {
                                        // Cast to ICoreWebView2Settings to access all methods
                                        if let Ok(settings) = settings.cast::<ICoreWebView2Settings>() {
                                            let _ = settings.SetIsStatusBarEnabled(false);
                                            let _ = settings.SetAreDefaultContextMenusEnabled(false);
                                            println!("[Rust] WebView2 settings configured");
                                        }
                                    }
                                    Err(e) => eprintln!("[Rust] Failed to get settings: {:?}", e),
                                }
                            }
                            Err(e) => eprintln!("[Rust] Failed to get CoreWebView2: {:?}", e),
                        }
                    });
                    if let Err(e) = result {
                        eprintln!("[Rust] Failed to access webview: {:?}", e);
                    }
                }

                // Configure for main window after a delay to ensure WebView is fully ready
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    for (label, window) in app_handle.webview_windows() {
                        println!("[Rust] Configuring WebView2 for: {}", label);
                        configure_webview(&window);
                    }
                });

                // Also listen for new windows
                let app_handle2 = app.handle().clone();
                app.listen("tauri://webview-created", move |_event| {
                    let handle = app_handle2.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        for (_, window) in handle.webview_windows() {
                            configure_webview(&window);
                        }
                    });
                });
            }

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

/// Run the MCP server (called when --mcp flag is passed)
pub fn run_mcp_server() {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(mcp_server::run())
        .expect("MCP server failed");
}
