#!/usr/bin/env node
/**
 * MCP Emotion Server for Clawd
 *
 * This is a simple MCP (Model Context Protocol) server that provides
 * a set_emotion tool for Claude to control Clawd's emotional state.
 *
 * Communication with Tauri app is done via a temp file that Tauri watches.
 */

import { createInterface } from "readline";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Emotion file path - Tauri will watch this
const EMOTION_DIR = join(tmpdir(), "clawd-emotion");
const EMOTION_FILE = join(EMOTION_DIR, "current.json");

// Valid emotions
const VALID_EMOTIONS = ["neutral", "happy", "sad", "excited", "thinking", "confused", "surprised"];

// Ensure directory exists
try {
  mkdirSync(EMOTION_DIR, { recursive: true });
} catch (e) {
  // Directory might already exist
}

/**
 * Write emotion to file for Tauri to read
 */
function setEmotion(emotion, duration = 5000) {
  const data = {
    emotion,
    duration,
    timestamp: Date.now(),
  };
  writeFileSync(EMOTION_FILE, JSON.stringify(data));
  return { success: true, emotion, duration };
}

/**
 * Handle JSON-RPC request
 */
function handleRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "clawd-emotion-server",
            version: "1.0.0",
          },
        },
      };

    case "notifications/initialized":
      // No response needed for notifications
      return null;

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "set_emotion",
              description:
                "Set Clawd's emotional expression. Use this to show how you're feeling! Call this tool to change your visible emotion during the conversation.",
              inputSchema: {
                type: "object",
                properties: {
                  emotion: {
                    type: "string",
                    enum: VALID_EMOTIONS,
                    description:
                      "The emotion to display: neutral (default), happy (when pleased), sad (when apologizing or delivering bad news), excited (when celebrating success), thinking (when processing), confused (when uncertain), surprised (when something unexpected happens)",
                  },
                  duration: {
                    type: "number",
                    description:
                      "How long to show this emotion in milliseconds (default: 5000). After this duration, emotion returns to neutral.",
                  },
                },
                required: ["emotion"],
              },
            },
          ],
        },
      };

    case "tools/call":
      const { name, arguments: args } = params;

      if (name === "set_emotion") {
        const emotion = args?.emotion;
        const duration = args?.duration || 5000;

        if (!VALID_EMOTIONS.includes(emotion)) {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `Invalid emotion: ${emotion}. Valid emotions are: ${VALID_EMOTIONS.join(", ")}`,
                },
              ],
              isError: true,
            },
          };
        }

        const result = setEmotion(emotion, duration);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: `Emotion set to: ${emotion} for ${duration}ms`,
              },
            ],
          },
        };
      }

      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Unknown tool: ${name}`,
        },
      };

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}

// Set up stdio communication
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let buffer = "";

rl.on("line", (line) => {
  try {
    const request = JSON.parse(line);
    const response = handleRequest(request);

    if (response) {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  } catch (e) {
    // Log error to stderr (won't interfere with MCP protocol)
    process.stderr.write(`Error parsing request: ${e.message}\n`);
  }
});

// Keep process alive
process.stdin.resume();

// Log startup to stderr
process.stderr.write("Clawd Emotion MCP Server started\n");
