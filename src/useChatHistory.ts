import { useAgentChat } from "./hooks/useAgentChat";
import type { Emotion } from "./emotions";
import type { AgentChatMessage, StreamingState } from "./services/agentTypes";

// Re-export ChatMessage type for backward compatibility
export type ChatMessage = AgentChatMessage;

// Re-export StreamingState for components that need it
export type { StreamingState };

interface UseChatHistoryOptions {
  onEmotionChange?: (emotion: Emotion) => void;
}

/**
 * Chat history hook with Claude Agent SDK integration.
 * This is a wrapper around useAgentChat that maintains backward compatibility
 * with the original API while providing full agent capabilities.
 */
export function useChatHistory(options: UseChatHistoryOptions = {}) {
  const agent = useAgentChat(options);

  return {
    messages: agent.messages,
    isTyping: agent.isTyping,
    streamingState: agent.streamingState,
    error: agent.error,
    sendMessage: agent.sendMessage,
    interrupt: agent.interrupt,
    clearHistory: agent.clearHistory,
  };
}
