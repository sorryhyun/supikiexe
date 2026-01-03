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
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { hostname, platform, userInfo } from "os";

const execAsync = promisify(exec);

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

Keep your responses concise and friendly - you're a small desktop companion, not a lengthy assistant!`;

// Valid emotions
const VALID_EMOTIONS = ["neutral", "happy", "sad", "excited", "thinking", "confused", "surprised"];

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

// ============================================================================
// Tool Definitions using SDK's tool() helper
// ============================================================================

const setEmotionTool = tool(
  "set_emotion",
  "Set Clawd's emotional expression. Use this to show how you're feeling! Call this tool to change your visible emotion during the conversation.",
  {
    emotion: z.enum(VALID_EMOTIONS).describe(
      "The emotion to display: neutral (default), happy (when pleased), sad (when apologizing or delivering bad news), excited (when celebrating success), thinking (when processing), confused (when uncertain), surprised (when something unexpected happens)"
    ),
    duration: z.number().optional().default(5000).describe(
      "How long to show this emotion in milliseconds (default: 5000). After this duration, emotion returns to neutral."
    ),
  },
  async ({ emotion, duration }) => {
    // Emit emotion event directly to Rust via stdout
    emit({ type: "emotion", emotion, duration: duration || 5000 });
    return {
      content: [{ type: "text", text: `Emotion set to: ${emotion} for ${duration || 5000}ms` }],
    };
  }
);

const getCurrentTimeTool = tool(
  "get_current_time",
  "Get the current date and time. Use this when the user asks about the current time, date, day of the week, or when you need to be aware of the current moment.",
  {},
  async () => {
    const now = new Date();
    const options = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    };

    const timeInfo = {
      iso: now.toISOString(),
      formatted: now.toLocaleString('en-US', options),
      date: now.toLocaleDateString('en-US'),
      time: now.toLocaleTimeString('en-US'),
      timestamp: now.getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
      hour: now.getHours(),
      minute: now.getMinutes(),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(timeInfo, null, 2) }],
    };
  }
);

const getActiveWindowTool = tool(
  "get_active_window",
  "Get information about the currently focused/active window on the user's desktop. Returns the window title and process name. Use this to understand what the user is currently working on.",
  {},
  async () => {
    if (platform() !== 'win32') {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Active window detection only supported on Windows" }) }],
      };
    }

    try {
      const psScript = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          using System.Text;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")]
            public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
            [DllImport("user32.dll")]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
          }
"@
        $hwnd = [Win32]::GetForegroundWindow()
        $sb = New-Object System.Text.StringBuilder 256
        [void][Win32]::GetWindowText($hwnd, $sb, 256)
        $processId = 0
        [void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$processId)
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        @{
          title = $sb.ToString()
          processName = if ($process) { $process.ProcessName } else { "Unknown" }
          processId = $processId
        } | ConvertTo-Json
      `;

      const { stdout } = await execAsync(
        `powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
        { timeout: 5000 }
      );

      return {
        content: [{ type: "text", text: stdout.trim() }],
      };
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: "Failed to get active window", details: e.message })
        }],
      };
    }
  }
);

const getSystemInfoTool = tool(
  "get_system_info",
  "Get basic system information including hostname, platform, and current user. Use this when you need to know about the user's system environment.",
  {},
  async () => {
    const user = userInfo();
    const sysInfo = {
      hostname: hostname(),
      platform: platform(),
      username: user.username,
      homeDir: user.homedir,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(sysInfo, null, 2) }],
    };
  }
);

// Create SDK MCP server with all tools
const clawdMcpServer = createSdkMcpServer({
  name: "clawd-tools",
  tools: [setEmotionTool, getCurrentTimeTool, getActiveWindowTool, getSystemInfoTool],
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
