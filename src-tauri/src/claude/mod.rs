//! Claude CLI integration
//!
//! This module provides the Claude Code CLI integration for the mascot application.

mod command;
mod runner;

pub use runner::{
    check_claude_available, clear_session, confirm_exit_plan_mode, deny_exit_plan_mode,
    respond_to_ask_user_question, run_query, ToolUseEvent,
};
