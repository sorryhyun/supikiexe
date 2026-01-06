/**
 * Clawd MCP Tools
 *
 * All tools available to Clawd via the Claude Agent SDK.
 */

import { createEmotionTool, VALID_EMOTIONS } from './emotion.mjs';
import { getCurrentTimeTool } from './time.mjs';
import { getActiveWindowTool } from './window.mjs';
import { getSystemInfoTool } from './system.mjs';
import { createScreenshotTool } from './screenshot.mjs';
import { createClipboardTool } from './clipboard.mjs';
import { createInvestigateWindowTool } from './investigateWindow.mjs';

// Re-export for external use
export { createEmotionTool, VALID_EMOTIONS };
export { getCurrentTimeTool };
export { getActiveWindowTool };
export { getSystemInfoTool };
export { createScreenshotTool };
export { createClipboardTool };
export { createInvestigateWindowTool };

/**
 * Create all tools with the required dependencies
 * @param {Object} deps - Dependencies
 * @param {Function} deps.emit - Function to emit events to Rust
 * @param {Function} deps.log - Logging function
 * @returns {Array} Array of all tools
 */
export function createAllTools({ emit, log }) {
  return [
    createEmotionTool(emit),
    getCurrentTimeTool,
    getActiveWindowTool,
    getSystemInfoTool,
    createScreenshotTool(log),
    createClipboardTool(log),
    createInvestigateWindowTool(emit),
  ];
}
