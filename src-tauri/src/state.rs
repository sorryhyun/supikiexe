//! Global application state and session persistence

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// Backend mode enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BackendMode {
    #[default]
    Claude,
    Codex,
}

/// Current backend mode (Claude or Codex)
pub static BACKEND_MODE: Mutex<BackendMode> = Mutex::new(BackendMode::Claude);

/// Current session ID (maintained by Claude CLI, cached here)
pub static SESSION_ID: Mutex<Option<String>> = Mutex::new(None);

/// Current Codex session/thread ID (separate from Claude session)
pub static CODEX_SESSION_ID: Mutex<Option<String>> = Mutex::new(None);

/// Dev mode flag (Claude Code features enabled)
pub static DEV_MODE: Mutex<bool> = Mutex::new(false);

/// Supiki mode flag (Supiki mascot instead of Clawd)
pub static SUPIKI_MODE: Mutex<bool> = Mutex::new(false);

/// Custom working directory for sidecar (for Claude Code operations)
pub static SIDECAR_CWD: Mutex<Option<String>> = Mutex::new(None);

/// Recent working directories (most recent first, max 5)
pub static RECENT_CWDS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Maximum number of recent cwds to store
pub const MAX_RECENT_CWDS: usize = 5;

/// Get the session file path for persistence
pub fn get_session_file_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("supiki").join("session.txt"))
}

/// Save session ID to disk
pub fn save_session_to_disk(session_id: &str) {
    if let Some(path) = get_session_file_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, session_id);
        println!("[Rust] Session saved to {:?}", path);
    }
}

/// Get the Codex session file path for persistence
pub fn get_codex_session_file_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("supiki").join("codex-session.txt"))
}

/// Save Codex session ID to disk
pub fn save_codex_session_to_disk(session_id: &str) {
    if let Some(path) = get_codex_session_file_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, session_id);
        println!("[Rust] Codex session saved to {:?}", path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_session_file_path() {
        let path = get_session_file_path();
        // Should return Some path on most systems
        if let Some(p) = path {
            assert!(p.ends_with("session.txt"));
            assert!(p.to_string_lossy().contains("supiki"));
        }
    }

    #[test]
    fn test_session_id_mutex_operations() {
        // Test that session ID mutex works correctly
        {
            let mut session = SESSION_ID.lock().unwrap();
            *session = Some("test-session-123".to_string());
        }
        {
            let session = SESSION_ID.lock().unwrap();
            assert_eq!(session.clone(), Some("test-session-123".to_string()));
        }
        // Clean up
        {
            let mut session = SESSION_ID.lock().unwrap();
            *session = None;
        }
    }

    #[test]
    fn test_dev_mode_mutex_operations() {
        // Test that dev mode mutex works correctly
        let original = *DEV_MODE.lock().unwrap();
        {
            let mut dev_mode = DEV_MODE.lock().unwrap();
            *dev_mode = true;
        }
        {
            let dev_mode = DEV_MODE.lock().unwrap();
            assert!(*dev_mode);
        }
        // Restore original
        {
            let mut dev_mode = DEV_MODE.lock().unwrap();
            *dev_mode = original;
        }
    }

    #[test]
    fn test_supiki_mode_mutex_operations() {
        // Test that supiki mode mutex works correctly
        let original = *SUPIKI_MODE.lock().unwrap();
        {
            let mut supiki_mode = SUPIKI_MODE.lock().unwrap();
            *supiki_mode = true;
        }
        {
            let supiki_mode = SUPIKI_MODE.lock().unwrap();
            assert!(*supiki_mode);
        }
        // Restore original
        {
            let mut supiki_mode = SUPIKI_MODE.lock().unwrap();
            *supiki_mode = original;
        }
    }

    #[test]
    fn test_backend_mode_mutex_operations() {
        // Test that backend mode mutex works correctly
        let original = *BACKEND_MODE.lock().unwrap();
        {
            let mut backend_mode = BACKEND_MODE.lock().unwrap();
            *backend_mode = BackendMode::Codex;
        }
        {
            let backend_mode = BACKEND_MODE.lock().unwrap();
            assert_eq!(*backend_mode, BackendMode::Codex);
        }
        // Restore original
        {
            let mut backend_mode = BACKEND_MODE.lock().unwrap();
            *backend_mode = original;
        }
    }

    #[test]
    fn test_codex_session_id_mutex_operations() {
        // Test that Codex session ID mutex works correctly
        {
            let mut session = CODEX_SESSION_ID.lock().unwrap();
            *session = Some("codex-thread-456".to_string());
        }
        {
            let session = CODEX_SESSION_ID.lock().unwrap();
            assert_eq!(session.clone(), Some("codex-thread-456".to_string()));
        }
        // Clean up
        {
            let mut session = CODEX_SESSION_ID.lock().unwrap();
            *session = None;
        }
    }

    #[test]
    fn test_get_codex_session_file_path() {
        let path = get_codex_session_file_path();
        // Should return Some path on most systems
        if let Some(p) = path {
            assert!(p.ends_with("codex-session.txt"));
            assert!(p.to_string_lossy().contains("supiki"));
        }
    }

}
