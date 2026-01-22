import type { AnimationState } from "../hooks/useMascotState";
import type { Emotion } from "../emotion";

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
  sender: "user" | "mascot";
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

// AskUserQuestion types
export interface QuestionOption {
  label: string;
  description: string;
}

export interface AgentQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface AgentQuestionEvent {
  questionId: string;
  questions: AgentQuestion[];
}

// Attached image for chat messages
export interface AttachedImage {
  id: string;
  base64: string; // base64 data URL (includes data:image/... prefix)
}

// Re-export types for convenience
export type { AnimationState, Emotion };
