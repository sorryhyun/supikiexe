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

/**
 * Check if running in supiki mode
 */
function isSupikiMode() {
  return process.env.CLAWD_SUPIKI_MODE === '1' ||
         process.argv.includes('--supiki');
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

const DEFAULT_SYSTEM_PROMPT = readFileSync(getPromptPath(), "utf-8").trim();

// Load supiki prompt from file
function getSupikiPromptPath() {
  // Try import.meta.url first (ESM mode)
  try {
    if (import.meta.url) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const path = join(__dirname, "supiki_prompt.txt");
      if (existsSync(path)) return path;
    }
  } catch (e) {
    // Not in ESM mode
  }

  // For pkg bundled exe: supiki_prompt.txt is next to the exe or in snapshot
  const exeDir = dirname(process.execPath);
  const exePath = join(exeDir, "supiki_prompt.txt");
  if (existsSync(exePath)) return exePath;

  // Fallback for pkg snapshot filesystem
  const snapshotPath = join(process.cwd(), "supiki_prompt.txt");
  if (existsSync(snapshotPath)) return snapshotPath;

  return null;
}

// Load supiki prompt if available
const SUPIKI_PROMPT = (() => {
  const path = getSupikiPromptPath();
  if (path) {
    try {
      return readFileSync(path, "utf-8").trim();
    } catch (e) {
      return "";
    }
  }
  return "";
})();

// Select system prompt based on mode
const SYSTEM_PROMPT = isSupikiMode() && SUPIKI_PROMPT ? SUPIKI_PROMPT : DEFAULT_SYSTEM_PROMPT;

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

// Pending AskUserQuestion promises (questionId -> { resolve, reject })
const pendingQuestions = new Map();
let questionCounter = 0;

// Flag to track when query is complete (for single-shot mode)
let queryComplete = false;

/**
 * Handle permission requests for tools
 * Used to intercept AskUserQuestion and forward to frontend
 */
async function handleCanUseTool(toolName, input) {
  if (toolName === "AskUserQuestion") {
    const questionId = `q-${++questionCounter}`;
    log(`AskUserQuestion invoked, questionId: ${questionId}`);
    emit({ type: "ask-question", questionId, questions: input.questions });

    // Wait for answer from stdin (handleCommand will resolve this)
    return new Promise((resolve, reject) => {
      pendingQuestions.set(questionId, { resolve, reject });
    });
  }
  // Allow all other tools (bypassPermissions behavior)
  return { behavior: "allow", updatedInput: input };
}

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
function buildMascotOptions(sessionId, mcpServer, language) {
  const cliPath = getCliPath();
  const languageInstruction = getLanguageInstruction(language);
  const options = {
    systemPrompt: SYSTEM_PROMPT + languageInstruction,
    permissionMode: "bypassPermissions",
    canUseTool: handleCanUseTool,
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
function buildDevOptions(sessionId, mcpServer, language) {
  const cliPath = getCliPath();
  // Use custom cwd from environment if set, otherwise fall back to process.cwd()
  const workingDir = process.env.CLAWD_CWD || process.cwd();
  const languageInstruction = getLanguageInstruction(language);
  const options = {
    // Use Claude Code's system prompt with appended mascot personality and language
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: DEV_PERSONALITY_PROMPT + languageInstruction,
    },
    // Load settings from CLAUDE.md files
    settingSources: ['user', 'project', 'local'],
    // Use Claude Code's full toolset
    tools: { type: 'preset', preset: 'claude_code' },
    // Use custom working directory or current working directory
    cwd: workingDir,
    // Permission handling
    permissionMode: "bypassPermissions",
    canUseTool: handleCanUseTool,
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
 * Build multi-modal content array with images
 * @param {string} textPrompt - The text message
 * @param {string[]} images - Array of base64 data URLs (e.g., "data:image/png;base64,...")
 * @returns {object[]} - Multi-modal content array for APIUserMessage
 */
function buildContentWithImages(textPrompt, images) {
  const content = [];

  // Add images first
  for (const dataUrl of images) {
    // Parse data URL: "data:image/png;base64,<data>"
    const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (match) {
      const mediaType = match[1];
      const data = match[2];
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: data,
        },
      });
    }
  }

  // Add text at the end
  if (textPrompt) {
    content.push({
      type: "text",
      text: textPrompt,
    });
  }

  return content;
}

/**
 * Create an async generator that yields a single user message with images
 * This is required for the Claude Agent SDK streaming input mode
 * @param {string} textPrompt - The text message
 * @param {string[]} images - Array of base64 data URLs
 * @returns {AsyncGenerator<SDKUserMessage>}
 */
async function* createImagePromptGenerator(textPrompt, images) {
  yield {
    type: "user",
    message: {
      role: "user",
      content: buildContentWithImages(textPrompt, images),
    },
  };
}

/**
 * Get language instruction for system prompt
 */
function getLanguageInstruction(language) {
  const languageNames = {
    en: "English",
    ko: "Korean (한국어)",
    ja: "Japanese (日本語)",
    zh: "Chinese (中文)",
    es: "Spanish (Español)",
    fr: "French (Français)",
    de: "German (Deutsch)",
  };
  const langName = languageNames[language] || languageNames.en;
  if (language && language !== "en") {
    return `\n\nIMPORTANT: Always respond in ${langName}. Use ${langName} for all your responses unless the user explicitly asks for a different language.`;
  }
  return "";
}

/**
 * Handle a query using the Claude Agent SDK
 */
async function handleQuery({ prompt, sessionId, images, language }) {
  const devMode = isDevMode();
  const supikiMode = isSupikiMode();
  const modeString = devMode ? "DEV" : supikiMode ? "SUPIKI" : "MASCOT";
  log(`Handling query: "${prompt.substring(0, 50)}..."`);
  log(`Session ID: ${sessionId || "new session"}`);
  log(`Mode: ${modeString}`);
  log(`Images: ${images?.length || 0}`);
  log(`Language: ${language || "en"}`);

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
      ? buildDevOptions(sessionId, clawdMcpServer, language)
      : buildMascotOptions(sessionId, clawdMcpServer, language);

    // Build prompt: use generator for images (streaming input mode), string for text-only
    const hasImages = images && images.length > 0;
    const queryPrompt = hasImages
      ? createImagePromptGenerator(prompt, images)
      : prompt;

    let fullText = "";
    let newSessionId = sessionId;

    // Stream the query
    for await (const message of queryFn({ prompt: queryPrompt, options })) {
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
        queryComplete = true;
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
    queryComplete = true;
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
          images: cmd.images || [],
          language: cmd.language || "en",
        });
        break;

      case "clear_session":
        currentSessionId = null;
        emit({ type: "session_cleared" });
        break;

      case "answer-question":
        const pending = pendingQuestions.get(cmd.questionId);
        if (pending) {
          log(`Received answer for questionId: ${cmd.questionId}`);
          pendingQuestions.delete(cmd.questionId);
          pending.resolve({
            behavior: "allow",
            updatedInput: {
              questions: cmd.questions,
              answers: cmd.answers,
            },
          });
        } else {
          log(`Warning: No pending question for questionId: ${cmd.questionId}`);
        }
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

/**
 * Check if we should exit (query complete and no pending questions)
 */
function checkExit() {
  if (queryComplete && pendingQuestions.size === 0) {
    log("Query complete, exiting...");
    process.exit(0);
  }
}

// Initialize and start (single-shot mode)
async function main() {
  log("Clawd Agent Sidecar starting (single-shot mode)...");

  // Initialize Claude implementation
  await initializeClaude();

  // Signal ready
  const devMode = isDevMode();
  const supikiMode = isSupikiMode();
  const modeString = devMode ? "DEV" : supikiMode ? "SUPIKI" : "MASCOT";
  log(`Clawd Agent Sidecar ready (${modeString} mode)`);
  emit({ type: "ready", mode: modeString.toLowerCase() });

  // Set up stdin listener for commands
  // In single-shot mode, we expect:
  // 1. A "query" command to start
  // 2. Possibly "answer-question" commands if AskUserQuestion is triggered
  // 3. Process exits after query completes
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on("line", async (line) => {
    await handleCommand(line);
    // Check if we should exit after handling command
    checkExit();
  });

  // Handle stdin close (Rust closed the pipe)
  rl.on("close", () => {
    log("stdin closed, exiting...");
    process.exit(0);
  });
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
