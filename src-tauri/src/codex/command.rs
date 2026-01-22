//! Codex CLI command builder
//!
//! Builds command-line arguments for the Codex CLI.

use std::path::PathBuf;

/// Default model for Codex
const DEFAULT_MODEL: &str = "gpt-5.2";

/// Default reasoning effort level
const DEFAULT_REASONING_EFFORT: &str = "high";

/// Builder for Codex CLI command arguments
pub struct CodexCommandBuilder {
    args: Vec<String>,
}

impl CodexCommandBuilder {
    pub fn new() -> Self {
        Self {
            args: vec!["exec".to_string()],
        }
    }

    pub fn with_session_resume(mut self, session_id: Option<&String>) -> Self {
        if let Some(sid) = session_id {
            self.args.push("resume".to_string());
            self.args.push(sid.clone());
        }
        self
    }

    pub fn with_json_output(mut self) -> Self {
        self.args.push("--json".to_string());
        self
    }

    pub fn with_full_auto(mut self) -> Self {
        self.args.push("--full-auto".to_string());
        self
    }

    pub fn with_skip_git_repo_check(mut self) -> Self {
        self.args.push("--skip-git-repo-check".to_string());
        self
    }

    pub fn with_config(mut self, key: &str, value: &str) -> Self {
        self.args.push("--config".to_string());
        self.args.push(format!("{}={}", key, value));
        self
    }

    pub fn with_default_model_config(self) -> Self {
        self.with_config("model", &format!("\"{}\"", DEFAULT_MODEL))
            .with_config("model_reasoning_effort", &format!("\"{}\"", DEFAULT_REASONING_EFFORT))
    }

    pub fn with_system_prompt(self, prompt: &str) -> Self {
        // Escape quotes and newlines for TOML string
        let escaped = prompt
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n");
        self.with_config("developer_instructions", &format!("\"{}\"", escaped))
    }

    pub fn with_working_directory(mut self, cwd: Option<&String>) -> Self {
        if let Some(dir) = cwd {
            self.args.push("--cd".to_string());
            self.args.push(dir.clone());
        }
        self
    }

    pub fn with_images(mut self, image_paths: &[PathBuf]) -> Self {
        for path in image_paths {
            self.args.push("--image".to_string());
            self.args.push(path.to_string_lossy().to_string());
        }
        self
    }

    pub fn with_prompt(mut self, prompt: String) -> Self {
        self.args.push(prompt);
        self
    }

    pub fn build(self) -> Vec<String> {
        self.args
    }
}

impl Default for CodexCommandBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builder_starts_with_exec() {
        let args = CodexCommandBuilder::new().build();
        assert_eq!(args.first(), Some(&"exec".to_string()));
    }

    #[test]
    fn test_builder_with_json_and_full_auto() {
        let args = CodexCommandBuilder::new()
            .with_json_output()
            .with_full_auto()
            .build();

        assert!(args.contains(&"--json".to_string()));
        assert!(args.contains(&"--full-auto".to_string()));
    }

    #[test]
    fn test_builder_with_session() {
        let session = "thread-123".to_string();
        let args = CodexCommandBuilder::new()
            .with_session_resume(Some(&session))
            .build();

        assert!(args.contains(&"resume".to_string()));
        assert!(args.contains(&session));
    }

    #[test]
    fn test_builder_with_working_directory() {
        let cwd = "/some/path".to_string();
        let args = CodexCommandBuilder::new()
            .with_working_directory(Some(&cwd))
            .build();

        assert!(args.contains(&"--cd".to_string()));
        assert!(args.contains(&cwd));
    }

    #[test]
    fn test_builder_with_prompt() {
        let args = CodexCommandBuilder::new()
            .with_prompt("hello".to_string())
            .build();

        assert_eq!(args.last(), Some(&"hello".to_string()));
    }

    #[test]
    fn test_builder_with_system_prompt() {
        let args = CodexCommandBuilder::new()
            .with_system_prompt("You are a helpful assistant.")
            .build();

        assert!(args.contains(&"--config".to_string()));
        assert!(args.iter().any(|a| a.contains("developer_instructions=")));
        assert!(args.iter().any(|a| a.contains("helpful assistant")));
    }

    #[test]
    fn test_builder_system_prompt_escapes_quotes() {
        let args = CodexCommandBuilder::new()
            .with_system_prompt("Say \"hello\"")
            .build();

        let config_arg = args.iter().find(|a| a.contains("developer_instructions=")).unwrap();
        assert!(config_arg.contains("\\\"hello\\\""));
    }

    #[test]
    fn test_builder_with_config() {
        let args = CodexCommandBuilder::new()
            .with_config("model", "\"gpt-4\"")
            .build();

        assert!(args.contains(&"--config".to_string()));
        assert!(args.contains(&"model=\"gpt-4\"".to_string()));
    }

    #[test]
    fn test_builder_with_default_model_config() {
        let args = CodexCommandBuilder::new()
            .with_default_model_config()
            .build();

        let config_count = args.iter().filter(|a| *a == "--config").count();
        assert_eq!(config_count, 2); // model + reasoning_effort

        assert!(args.iter().any(|a| a.contains("model=") && a.contains("gpt-5.2")));
        assert!(args.iter().any(|a| a.contains("model_reasoning_effort=") && a.contains("high")));
    }

    #[test]
    fn test_builder_with_skip_git_repo_check() {
        let args = CodexCommandBuilder::new()
            .with_skip_git_repo_check()
            .build();

        assert!(args.contains(&"--skip-git-repo-check".to_string()));
    }
}
