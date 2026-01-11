//! MCP server for controlling the Clawd desktop mascot.
//!
//! This server provides tools that Claude can use to control the mascot's
//! emotions and movement. The actual mascot control happens when Tauri
//! parses the tool_use events from Claude CLI's output stream.

use std::future::Future;
use std::io::Cursor;

use anyhow::Result;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::ImageFormat;
use rmcp::{
    handler::server::{router::tool::ToolRouter, tool::Parameters},
    model::*,
    schemars, tool, tool_handler, tool_router, ServerHandler, ServiceExt,
};
use xcap::Monitor;

/// Request to set the mascot's emotional expression
#[derive(serde::Deserialize, schemars::JsonSchema)]
pub struct SetEmotionRequest {
    /// The emotion to display: neutral, happy, sad, excited, thinking, surprised, love
    emotion: String,
    /// Duration in milliseconds (default: 5000)
    #[serde(default)]
    duration_ms: Option<u32>,
}

/// Request to move the mascot to a screen position
#[derive(serde::Deserialize, schemars::JsonSchema)]
pub struct MoveToRequest {
    /// Target position: "left", "right", "center", or an x-coordinate number
    target: String,
}

/// Request to capture a screenshot
#[derive(serde::Deserialize, schemars::JsonSchema)]
pub struct CaptureScreenshotRequest {
    /// Optional description of what to look for in the screenshot
    #[serde(default)]
    description: Option<String>,
}

/// The mascot MCP server
pub struct MascotService {
    tool_router: ToolRouter<MascotService>,
}

#[tool_router]
impl MascotService {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }

    /// Set the mascot's emotional expression.
    /// Use this to make Clawd express different emotions like happy, sad, excited, etc.
    #[tool(
        description = "Set the mascot's emotional expression. Available emotions: neutral, happy, sad, excited, thinking, surprised, love"
    )]
    async fn set_emotion(
        &self,
        Parameters(req): Parameters<SetEmotionRequest>,
    ) -> String {
        let duration = req.duration_ms.unwrap_or(5000);
        // The tool result is returned to Claude; Tauri parses tool_use from stream
        // and emits the event to the frontend
        format!(
            "Emotion set to '{}' for {}ms. The mascot is now expressing this emotion.",
            req.emotion, duration
        )
    }

    /// Move the mascot to a position on screen.
    /// Use this to make Clawd walk to different parts of the screen.
    #[tool(
        description = "Move the mascot to a screen position. Target can be: 'left', 'right', 'center', or a specific x-coordinate"
    )]
    async fn move_to(&self, Parameters(req): Parameters<MoveToRequest>) -> String {
        format!(
            "Moving mascot to: {}. The mascot is now walking to this position.",
            req.target
        )
    }

    /// Capture a screenshot of the user's screen.
    /// Use this when you need to see what the user is looking at.
    #[tool(description = "Capture a screenshot of the user's screen to see what they're looking at")]
    async fn capture_screenshot(
        &self,
        Parameters(req): Parameters<CaptureScreenshotRequest>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let desc = req
            .description
            .unwrap_or_else(|| "general view".to_string());

        // Helper to create error
        let make_error = |msg: String| {
            rmcp::ErrorData::new(rmcp::model::ErrorCode::INTERNAL_ERROR, msg, None::<serde_json::Value>)
        };

        // Get the primary monitor
        let monitors = Monitor::all().map_err(|e| make_error(format!("Failed to get monitors: {}", e)))?;

        let monitor = monitors
            .into_iter()
            .next()
            .ok_or_else(|| make_error("No monitors found".to_string()))?;

        // Capture the screen
        let image = monitor
            .capture_image()
            .map_err(|e| make_error(format!("Failed to capture screenshot: {}", e)))?;

        // Resize if too large (Claude has limits on image size)
        // Max ~1MB for MCP, so let's resize to reasonable dimensions
        let (width, height) = (image.width(), image.height());
        let max_dim = 1920u32;
        let resized = if width > max_dim || height > max_dim {
            let scale = max_dim as f32 / width.max(height) as f32;
            let new_width = (width as f32 * scale) as u32;
            let new_height = (height as f32 * scale) as u32;
            image::imageops::resize(
                &image,
                new_width,
                new_height,
                image::imageops::FilterType::Triangle,
            )
        } else {
            image::imageops::resize(&image, width, height, image::imageops::FilterType::Triangle)
        };

        // Encode as WebP for smaller file size
        let mut webp_data = Cursor::new(Vec::new());
        resized
            .write_to(&mut webp_data, ImageFormat::WebP)
            .map_err(|e| make_error(format!("Failed to encode WebP: {}", e)))?;

        // Base64 encode
        let base64_data = BASE64.encode(webp_data.into_inner());

        // Return image content with description
        Ok(CallToolResult::success(vec![
            Content::text(format!(
                "Screenshot captured (looking for: {}). Here is what I can see on your screen:",
                desc
            )),
            Content::image(base64_data, "image/webp"),
        ]))
    }
}

#[tool_handler]
impl ServerHandler for MascotService {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    // Serve via stdio (Claude CLI spawns this process)
    let transport = (tokio::io::stdin(), tokio::io::stdout());
    let service = MascotService::new().serve(transport).await?;
    service.waiting().await?;
    Ok(())
}
