//! Codex CLI integration
//!
//! This module provides the OpenAI Codex CLI integration for the mascot application.

mod command;
mod runner;

pub use runner::{check_codex_available, check_codex_available_with_app, clear_session, run_query};
