//! MCP server for controlling the Clawd desktop mascot.
//!
//! This server provides tools that Claude can use to control the mascot's
//! emotions and movement. The actual mascot control happens when Tauri
//! parses the tool_use events from Claude CLI's output stream.
//!
//! This module is run when the executable is launched with the `--mcp` flag.

use std::future::Future;
use std::io::Cursor;

use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
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
    async fn set_emotion(&self, Parameters(req): Parameters<SetEmotionRequest>) -> String {
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

    /// Capture a screenshot of all monitors.
    /// Use this when you need to see what the user is looking at across all displays.
    #[tool(description = "Capture a screenshot of all monitors to see what the user is looking at")]
    async fn capture_screenshot(
        &self,
        Parameters(req): Parameters<CaptureScreenshotRequest>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let desc = req
            .description
            .unwrap_or_else(|| "general view".to_string());

        // Helper to create error
        let make_error = |msg: String| {
            rmcp::ErrorData::new(
                rmcp::model::ErrorCode::INTERNAL_ERROR,
                msg,
                None::<serde_json::Value>,
            )
        };

        // Get all monitors
        let monitors =
            Monitor::all().map_err(|e| make_error(format!("Failed to get monitors: {}", e)))?;

        if monitors.is_empty() {
            return Err(make_error("No monitors found".to_string()));
        }

        // Capture all monitors and collect their images with positions
        let mut captures: Vec<(i32, i32, image::RgbaImage)> = Vec::new();
        for monitor in &monitors {
            let x = monitor
                .x()
                .map_err(|e| make_error(format!("Failed to get monitor x position: {}", e)))?;
            let y = monitor
                .y()
                .map_err(|e| make_error(format!("Failed to get monitor y position: {}", e)))?;
            let img = monitor
                .capture_image()
                .map_err(|e| make_error(format!("Failed to capture monitor: {}", e)))?;
            captures.push((x, y, img));
        }

        // Calculate the bounding box for all monitors
        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;

        for (x, y, img) in &captures {
            min_x = min_x.min(*x);
            min_y = min_y.min(*y);
            max_x = max_x.max(*x + img.width() as i32);
            max_y = max_y.max(*y + img.height() as i32);
        }

        // Create a canvas that fits all monitors
        let canvas_width = (max_x - min_x) as u32;
        let canvas_height = (max_y - min_y) as u32;
        let mut canvas = image::RgbaImage::new(canvas_width, canvas_height);

        // Paste each monitor's capture onto the canvas at the correct position
        for (x, y, img) in captures {
            let paste_x = (x - min_x) as u32;
            let paste_y = (y - min_y) as u32;
            image::imageops::overlay(&mut canvas, &img, paste_x as i64, paste_y as i64);
        }

        // Resize if too large (Claude has limits on image size)
        // Max ~1MB for MCP, so let's resize to reasonable dimensions
        let (width, height) = (canvas.width(), canvas.height());
        let max_dim = 2560u32; // Slightly larger for multi-monitor setups
        let resized = if width > max_dim || height > max_dim {
            let scale = max_dim as f32 / width.max(height) as f32;
            let new_width = (width as f32 * scale) as u32;
            let new_height = (height as f32 * scale) as u32;
            image::imageops::resize(
                &canvas,
                new_width,
                new_height,
                image::imageops::FilterType::Triangle,
            )
        } else {
            canvas
        };

        // Encode as WebP for smaller file size
        let mut webp_data = Cursor::new(Vec::new());
        resized
            .write_to(&mut webp_data, ImageFormat::WebP)
            .map_err(|e| make_error(format!("Failed to encode WebP: {}", e)))?;

        // Base64 encode
        let base64_data = BASE64.encode(webp_data.into_inner());

        // Return image content with description
        let monitor_count = monitors.len();
        Ok(CallToolResult::success(vec![
            Content::text(format!(
                "Screenshot captured from {} monitor(s) (looking for: {}). Here is what I can see on your screen:",
                monitor_count, desc
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

/// Run the MCP server via stdio
/// This is called when the executable is launched with --mcp flag
pub async fn run() -> Result<()> {
    // Serve via stdio (Claude CLI spawns this process)
    let transport = (tokio::io::stdin(), tokio::io::stdout());
    let service = MascotService::new().serve(transport).await?;
    service.waiting().await?;
    Ok(())
}
