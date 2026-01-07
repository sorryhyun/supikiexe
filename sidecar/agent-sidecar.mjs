#!/usr/bin/env node
/**
 * Clawd Agent Sidecar
 *
 * Node.js sidecar process that uses Claude Agent SDK to handle conversations.
 * Communicates with the Tauri Rust backend via stdio JSON-RPC.
 *
 * Protocol:
 * - Rust → Sidecar (stdin):  { "type": "query", "prompt": "...", "sessionId": "..." }
 * - Sidecar → Rust (stdout): { "type": "stream", "text": "..." }
 *                            { "type": "emotion", "emotion": "...", "duration": ... }
 *                            { "type": "result", "sessionId": "...", "success": true }
 */

import { createInterface } from "readline";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { homedir } from "os";
import { createAllTools } from "./tools/index.mjs";

/**
 * Check if running in dev mode (Claude Code features enabled)
 */
function isDevMode() {
  return process.env.CLAWD_DEV_MODE === '1' ||
         process.argv.includes('--dev');
}

// Load system prompt from file
// Works for both ESM (import.meta.url) and bundled exe (process.execPath)
function getPromptPath() {
  // Try import.meta.url first (ESM mode)
  try {
    if (import.meta.url) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const path = join(__dirname, "prompt.txt");
      if (existsSync(path)) return path;
    }
  } catch (e) {
    // Not in ESM mode
  }

  // For pkg bundled exe: prompt.txt is next to the exe or in snapshot
  const exeDir = dirname(process.execPath);
  const exePath = join(exeDir, "prompt.txt");
  if (existsSync(exePath)) return exePath;

  // Fallback for pkg snapshot filesystem
  const snapshotPath = join(process.cwd(), "prompt.txt");
  if (existsSync(snapshotPath)) return snapshotPath;

  throw new Error("Could not find prompt.txt");
}

const SYSTEM_PROMPT = readFileSync(getPromptPath(), "utf-8").trim();

// Load dev mode personality prompt (appended to Claude Code's system prompt)
function getDevPromptPath() {
  // Try import.meta.url first (ESM mode)
  try {
    if (import.meta.url) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const path = join(__dirname, "dev-prompt.txt");
      if (existsSync(path)) return path;
    }
  } catch (e) {
    // Not in ESM mode
  }

  // For pkg bundled exe
  const exeDir = dirname(process.execPath);
  const exePath = join(exeDir, "dev-prompt.txt");
  if (existsSync(exePath)) return exePath;

  // Fallback
  const snapshotPath = join(process.cwd(), "dev-prompt.txt");
  if (existsSync(snapshotPath)) return snapshotPath;

  return null;
}

// Load dev prompt if available
const DEV_PERSONALITY_PROMPT = (() => {
  const path = getDevPromptPath();
  if (path) {
    try {
      return readFileSync(path, "utf-8").trim();
    } catch (e) {
      return "";
    }
  }
  return "";
})();

// Current session ID
let currentSessionId = null;

// Claude Agent SDK functions
let queryFn = null;
let createSdkMcpServerFn = null;

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

/**
 * Initialize Claude Agent SDK
 */
async function initializeClaude() {
  const { query, createSdkMcpServer } = await import("@anthropic-ai/claude-agent-sdk");
  queryFn = query;
  createSdkMcpServerFn = createSdkMcpServer;
  log("Claude Agent SDK initialized");
}

// MCP server instance (created after initialization)
let clawdMcpServer = null;

/**
 * Get path to Claude Code CLI executable
 * Uses system installation (required for bundled exe since import.meta.url is undefined)
 */
function getCliPath() {
  const claudePaths = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe'),
    join(homedir(), '.local', 'bin', 'claude.exe'),
    join(homedir(), '.local', 'bin', 'claude'),
  ].filter(Boolean);

  for (const claudePath of claudePaths) {
    if (existsSync(claudePath)) {
      log(`Using system Claude CLI: ${claudePath}`);
      return claudePath;
    }
  }

  // Not found - return null and let SDK handle it (will fail if running as bundled exe)
  log('Warning: Claude CLI not found in system paths');
  return null;
}

/**
 * Build options for mascot mode (default)
 */
function buildMascotOptions(sessionId, mcpServer) {
  const cliPath = getCliPath();
  const options = {
    systemPrompt: SYSTEM_PROMPT,
    permissionMode: "bypassPermissions",
  };
  if (cliPath) {
    options.pathToClaudeCodeExecutable = cliPath;
  }
  if (mcpServer) {
    options.mcpServers = { "clawd": mcpServer };
  }
  if (sessionId) {
    options.resume = sessionId;
  }
  return options;
}

/**
 * Build options for dev mode (Claude Code features)
 */
function buildDevOptions(sessionId, mcpServer) {
  const cliPath = getCliPath();
  const options = {
    // Use Claude Code's system prompt with appended mascot personality
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: DEV_PERSONALITY_PROMPT,
    },
    // Load settings from CLAUDE.md files
    settingSources: ['user', 'project', 'local'],
    // Use Claude Code's full toolset
    tools: { type: 'preset', preset: 'claude_code' },
    // Use current working directory (user's project)
    cwd: process.cwd(),
    // Permission handling
    permissionMode: "bypassPermissions",
  };
  if (cliPath) {
    options.pathToClaudeCodeExecutable = cliPath;
  }
  // Add mascot MCP tools alongside Claude Code tools
  if (mcpServer) {
    options.mcpServers = { "clawd": mcpServer };
  }
  if (sessionId) {
    options.resume = sessionId;
  }
  return options;
}

/**
 * Handle a query using the Claude Agent SDK
 */
async function handleQuery({ prompt, sessionId }) {
  const devMode = isDevMode();
  log(`Handling query: "${prompt.substring(0, 50)}..."`);
  log(`Session ID: ${sessionId || "new session"}`);
  log(`Mode: ${devMode ? "DEV" : "MASCOT"}`);

  try {
    // Create MCP server if not exists (for SDK MCP tools)
    if (!clawdMcpServer && createSdkMcpServerFn) {
      clawdMcpServer = createSdkMcpServerFn({
        name: "clawd-tools",
        tools,
      });
      log(`Created MCP server: ${clawdMcpServer.name}`);
    }

    // Build query options based on mode
    const options = devMode
      ? buildDevOptions(sessionId, clawdMcpServer)
      : buildMascotOptions(sessionId, clawdMcpServer);

    let fullText = "";
    let newSessionId = sessionId;

    // Stream the query
    for await (const message of queryFn({ prompt, options })) {
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

// Initialize and start
async function main() {
  log("Clawd Agent Sidecar starting...");

  // Initialize Claude implementation
  await initializeClaude();

  // Set up stdin listener
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on("line", handleCommand);

  // Keep process alive
  process.stdin.resume();

  // Signal ready
  const devMode = isDevMode();
  log(`Clawd Agent Sidecar ready (${devMode ? "DEV" : "MASCOT"} mode)`);
  emit({ type: "ready", mode: devMode ? "dev" : "mascot" });
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
