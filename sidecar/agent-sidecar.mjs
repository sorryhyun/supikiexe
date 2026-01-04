#!/usr/bin/env node
/**
 * Clawd Agent Sidecar
 *
 * Node.js sidecar process that uses the Claude Agent SDK to handle
 * conversations. Communicates with the Tauri Rust backend via stdio JSON-RPC.
 *
 * Protocol:
 * - Rust → Sidecar (stdin):  { "type": "query", "prompt": "...", "sessionId": "..." }
 * - Sidecar → Rust (stdout): { "type": "stream", "text": "..." }
 *                            { "type": "emotion", "emotion": "...", "duration": ... }
 *                            { "type": "result", "sessionId": "...", "success": true }
 */

import { createInterface } from "readline";
import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createAllTools } from "./tools/index.mjs";

// System prompt for Clawd personality
const SYSTEM_PROMPT = `You are Clawd, a friendly and expressive desktop mascot. You're a cute capybara-like creature who lives on the user's desktop.

IMPORTANT: You have access to the set_emotion tool. Use it to express your feelings during conversations!
- Use "happy" when you're pleased, greeting the user, or saying something positive
- Use "excited" when celebrating success, finishing a task, or something amazing happens
- Use "thinking" when you're processing, analyzing, or considering something
- Use "sad" when you have to deliver bad news, apologize, or something unfortunate happens
- Use "confused" when you don't understand something or need clarification
- Use "surprised" when something unexpected happens
- Use "neutral" for casual conversation

Call set_emotion at the START of your response to show your emotional reaction, and call it again if your emotion changes during the response.

VISUAL CAPABILITIES:
- You can use capture_screenshot to see what's on the user's screen when they ask you to look at something
- You can use read_clipboard to see what the user has copied (both text and images)
- When users say things like "look at this", "what do you see", "check my screen", or "I copied something", proactively use these tools!

Keep your responses concise and friendly - you're a small desktop companion, not a lengthy assistant!`;

// Current session ID
let currentSessionId = null;

/**
 * Emit event to Rust via stdout
 * All stdout output must be valid JSON, one object per line
 */
function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

/**
 * Log to stderr (doesn't interfere with IPC protocol)
 */
function log(...args) {
  process.stderr.write(`[Sidecar] ${args.join(" ")}\n`);
}

// Create all tools with dependencies
const tools = createAllTools({ emit, log });

// Create SDK MCP server with all tools
const clawdMcpServer = createSdkMcpServer({
  name: "clawd-tools",
  tools,
});

/**
 * Handle a query from Rust
 * Uses the Agent SDK to process the message and stream responses
 */
async function handleQuery({ prompt, sessionId }) {
  log(`Handling query: "${prompt.substring(0, 50)}..."`);
  log(`Session ID: ${sessionId || "new session"}`);

  try {
    // Build query options
    const options = {
      systemPrompt: SYSTEM_PROMPT,
      permissionMode: "bypassPermissions",
      mcpServers: {
        "clawd": {
          type: "sdk",
          instance: clawdMcpServer,
        },
      },
    };

    // Resume session if provided
    if (sessionId) {
      options.resume = sessionId;
    }

    let fullText = "";
    let newSessionId = sessionId;

    // Stream the query
    for await (const message of query({ prompt, options })) {
      log(`Message type: ${message.type}${message.subtype ? ` (${message.subtype})` : ""}`);

      // Capture session ID from init
      if (message.type === "system" && message.subtype === "init") {
        newSessionId = message.session_id;
        log(`New session ID: ${newSessionId}`);
      }

      // Handle assistant messages (streaming text)
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === "text") {
            fullText = block.text;
            emit({ type: "stream", text: block.text });
          }
        }
      }

      // Handle result
      if (message.type === "result") {
        currentSessionId = newSessionId;
        emit({
          type: "result",
          sessionId: newSessionId,
          success: message.subtype === "success",
          text: fullText,
        });
      }
    }

    log("Query completed successfully");
  } catch (error) {
    log(`Error: ${error.message}`);
    log(error.stack);
    emit({
      type: "error",
      error: error.message,
      sessionId: currentSessionId,
    });
  }
}

/**
 * Handle incoming commands from Rust
 */
async function handleCommand(line) {
  try {
    const cmd = JSON.parse(line);
    log(`Received command: ${cmd.type}`);

    switch (cmd.type) {
      case "query":
        await handleQuery({
          prompt: cmd.prompt,
          sessionId: cmd.sessionId || currentSessionId,
        });
        break;

      case "clear_session":
        currentSessionId = null;
        emit({ type: "session_cleared" });
        break;

      case "ping":
        emit({ type: "pong" });
        break;

      default:
        log(`Unknown command type: ${cmd.type}`);
        emit({ type: "error", error: `Unknown command: ${cmd.type}` });
    }
  } catch (error) {
    log(`Error parsing command: ${error.message}`);
    emit({ type: "error", error: `Parse error: ${error.message}` });
  }
}

// Set up stdin listener
const rl = createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on("line", handleCommand);

// Keep process alive
process.stdin.resume();

// Signal ready
log("Clawd Agent Sidecar started");
emit({ type: "ready" });
