//! Claude CLI integration
//!
//! This module provides the Claude Code CLI integration for the mascot application.

mod command;
mod runner;

pub use runner::{check_claude_available, clear_session, run_query, ToolUseEvent};
