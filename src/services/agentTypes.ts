import type { MascotState } from "../hooks/useMascotState";
import type { Emotion } from "../emotions";

// Streaming message state
export interface StreamingState {
  isStreaming: boolean;
  partialContent: string;
  toolsInUse: string[];
  currentToolName?: string;
}

// Tool use tracking
export interface ToolUseInfo {
  toolName: string;
  input: unknown;
  result?: string;
  status: "pending" | "running" | "completed" | "failed";
}

// Enhanced chat message with agent metadata
export interface AgentChatMessage {
  id: string;
  sender: "user" | "clawd";
  content: string;
  timestamp: number;
  // Agent-specific metadata
  sessionId?: string;
  isStreaming?: boolean;
  toolUses?: ToolUseInfo[];
  costUsd?: number;
}

// Callbacks for agent query events
export interface AgentQueryCallbacks {
  onStreamStart: () => void;
  onPartialMessage: (content: string) => void;
  onToolUse: (toolName: string, status: "start" | "end") => void;
  onComplete: (result: string, metadata: { costUsd: number; sessionId: string }) => void;
  onError: (error: Error) => void;
}

// Emotion detection context
export interface EmotionContext {
  content: string;
  isToolRunning: boolean;
  toolName?: string;
  hasError: boolean;
}

// Saved chat session (for history)
export interface ChatSession {
  id: string;
  sessionId?: string; // Claude session ID
  title: string; // First user message or generated title
  createdAt: number;
  updatedAt: number;
  messages: AgentChatMessage[];
  messageCount: number;
}

// Re-export types for convenience
export type { MascotState, Emotion };
