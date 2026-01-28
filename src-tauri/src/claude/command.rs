//! Claude CLI command builder
//!
//! Builds command-line arguments for the Claude CLI.

use std::path::PathBuf;

/// Builder for Claude CLI command arguments
pub struct ClaudeCommandBuilder {
    args: Vec<String>,
}

impl ClaudeCommandBuilder {
    pub fn new() -> Self {
        Self { args: Vec::new() }
    }

    /// Configure for streaming JSON output in interactive mode (waits for tool results)
    /// Use this instead of with_streaming_output when bidirectional communication is needed
    pub fn with_interactive_streaming(mut self) -> Self {
        self.args.extend([
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
        ]);
        self
    }

    pub fn with_streaming_input(mut self) -> Self {
        self.args.extend([
            "--input-format".to_string(),
            "stream-json".to_string(),
        ]);
        self
    }

    pub fn with_mcp_config(mut self, config_path: &PathBuf) -> Self {
        self.args.push("--mcp-config".to_string());
        self.args.push(config_path.to_string_lossy().to_string());
        self
    }

    pub fn with_allowed_tools(mut self, tools: &[&str]) -> Self {
        self.args.push("--allowedTools".to_string());
        for tool in tools {
            self.args.push(tool.to_string());
        }
        self
    }

    pub fn with_system_prompt(mut self, prompt: String) -> Self {
        self.args.push("--system-prompt".to_string());
        self.args.push(prompt);
        self
    }

    pub fn with_session_resume(mut self, session_id: Option<&String>) -> Self {
        if let Some(sid) = session_id {
            self.args.push("--resume".to_string());
            self.args.push(sid.clone());
        }
        self
    }

    pub fn with_skip_permissions(mut self) -> Self {
        self.args.push("--dangerously-skip-permissions".to_string());
        self
    }

    pub fn build(self) -> Vec<String> {
        self.args
    }
}

impl Default for ClaudeCommandBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builder_basic() {
        let args = ClaudeCommandBuilder::new()
            .with_interactive_streaming()
            .build();

        assert!(args.contains(&"--output-format".to_string()));
        assert!(args.contains(&"stream-json".to_string()));
        assert!(args.contains(&"--verbose".to_string()));
    }

    #[test]
    fn test_builder_with_session() {
        let session = "test-session-123".to_string();
        let args = ClaudeCommandBuilder::new()
            .with_session_resume(Some(&session))
            .build();

        assert!(args.contains(&"--resume".to_string()));
        assert!(args.contains(&session));
    }

    #[test]
    fn test_builder_with_tools() {
        let args = ClaudeCommandBuilder::new()
            .with_allowed_tools(&["tool1", "tool2"])
            .build();

        assert!(args.contains(&"--allowedTools".to_string()));
        assert!(args.contains(&"tool1".to_string()));
        assert!(args.contains(&"tool2".to_string()));
    }

    #[test]
    fn test_builder_with_streaming_input() {
        let args = ClaudeCommandBuilder::new()
            .with_streaming_input()
            .build();

        assert!(args.contains(&"--input-format".to_string()));
        assert!(args.contains(&"stream-json".to_string()));
    }
}
