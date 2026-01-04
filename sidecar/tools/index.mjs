/**
 * Clawd MCP Tools
 *
 * All tools available to Clawd via the Claude Agent SDK.
 */

export { createEmotionTool, VALID_EMOTIONS } from './emotion.mjs';
export { getCurrentTimeTool } from './time.mjs';
export { getActiveWindowTool } from './window.mjs';
export { getSystemInfoTool } from './system.mjs';
export { createScreenshotTool } from './screenshot.mjs';
export { createClipboardTool } from './clipboard.mjs';

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
  ];
}
