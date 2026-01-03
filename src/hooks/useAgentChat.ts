import { useState, useCallback, useRef, useEffect } from "react";
import { getAgentService } from "../services/agentService";
import { detectEmotion } from "../services/emotionMapper";
import type {
  AgentChatMessage,
  StreamingState,
  AgentQueryCallbacks,
  Emotion,
} from "../services/agentTypes";

const STORAGE_KEY = "clawd-chat-history";
const MAX_MESSAGES = 100;

interface UseAgentChatOptions {
  onEmotionChange?: (emotion: Emotion) => void;
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const { onEmotionChange } = options;

  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [streamingState, setStreamingState] = useState<StreamingState>({
    isStreaming: false,
    partialContent: "",
    toolsInUse: [],
  });
  const [error, setError] = useState<Error | null>(null);

  const agentService = useRef(getAgentService());
  const streamingMessageId = useRef<string | null>(null);
  const toolsInUseRef = useRef<string[]>([]);

  // Register MCP emotion callback
  useEffect(() => {
    const unsubscribe = agentService.current.onEmotionUpdate(
      (emotion, _duration) => {
        console.log("[useAgentChat] MCP emotion received:", emotion);
        onEmotionChange?.(emotion);
      }
    );
    return unsubscribe;
  }, [onEmotionChange]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
        }
      }
    } catch (e) {
      console.error("Failed to load chat history:", e);
    }
  }, []);

  // Save to localStorage whenever messages change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {
      console.error("Failed to save chat history:", e);
    }
  }, [messages]);

  const addMessage = useCallback(
    (
      sender: "user" | "clawd",
      content: string,
      metadata?: Partial<AgentChatMessage>
    ) => {
      const newMessage: AgentChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        sender,
        content,
        timestamp: Date.now(),
        ...metadata,
      };

      setMessages((prev) => {
        const updated = [...prev, newMessage];
        return updated.length > MAX_MESSAGES
          ? updated.slice(-MAX_MESSAGES)
          : updated;
      });

      return newMessage;
    },
    []
  );

  const updateStreamingMessage = useCallback((content: string) => {
    if (!streamingMessageId.current) return;

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === streamingMessageId.current
          ? { ...msg, content, isStreaming: true }
          : msg
      )
    );
  }, []);

  const finalizeStreamingMessage = useCallback(
    (content: string, metadata?: Partial<AgentChatMessage>) => {
      if (!streamingMessageId.current) return;

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === streamingMessageId.current
            ? { ...msg, content, isStreaming: false, ...metadata }
            : msg
        )
      );

      streamingMessageId.current = null;
    },
    []
  );

  const sendMessage = useCallback(
    async (content: string) => {
      setError(null);

      // Add user message
      addMessage("user", content);

      // Create placeholder for streaming response
      const placeholderMsg = addMessage("clawd", "", { isStreaming: true });
      streamingMessageId.current = placeholderMsg.id;

      // Start emotion polling for MCP updates
      agentService.current.startEmotionPolling();

      const callbacks: AgentQueryCallbacks = {
        onStreamStart: () => {
          toolsInUseRef.current = [];
          setStreamingState((prev) => ({
            ...prev,
            isStreaming: true,
            partialContent: "",
            toolsInUse: [],
          }));
          onEmotionChange?.("thinking");
        },

        onPartialMessage: (partialContent) => {
          setStreamingState((prev) => ({ ...prev, partialContent }));
          updateStreamingMessage(partialContent);

          // Update emotion based on content
          const emotion = detectEmotion({
            content: partialContent,
            isToolRunning: toolsInUseRef.current.length > 0,
            hasError: false,
          });
          onEmotionChange?.(emotion);
        },

        onToolUse: (toolName, status) => {
          if (status === "start") {
            toolsInUseRef.current = [...toolsInUseRef.current, toolName];
          } else {
            toolsInUseRef.current = toolsInUseRef.current.filter(
              (t) => t !== toolName
            );
          }

          setStreamingState((prev) => ({
            ...prev,
            toolsInUse: toolsInUseRef.current,
            currentToolName: status === "start" ? toolName : undefined,
          }));

          // Show thinking state when tools are running
          if (status === "start") {
            onEmotionChange?.("thinking");
          }
        },

        onComplete: (result, metadata) => {
          // Stop emotion polling
          agentService.current.stopEmotionPolling();

          toolsInUseRef.current = [];
          setStreamingState({
            isStreaming: false,
            partialContent: "",
            toolsInUse: [],
          });

          finalizeStreamingMessage(result, {
            sessionId: metadata.sessionId,
            costUsd: metadata.costUsd,
          });

          // Final emotion based on result
          const emotion = detectEmotion({
            content: result,
            isToolRunning: false,
            hasError: false,
          });
          onEmotionChange?.(emotion);

          // Return to neutral after delay
          setTimeout(() => onEmotionChange?.("neutral"), 3000);
        },

        onError: (err) => {
          // Stop emotion polling
          agentService.current.stopEmotionPolling();

          setError(err);
          toolsInUseRef.current = [];
          setStreamingState({
            isStreaming: false,
            partialContent: "",
            toolsInUse: [],
          });

          finalizeStreamingMessage(`Oops! Something went wrong: ${err.message}`);
          onEmotionChange?.("sad");
          // Return to neutral after delay
          setTimeout(() => onEmotionChange?.("neutral"), 4000);
        },
      };

      await agentService.current.sendMessage(content, callbacks);
    },
    [
      addMessage,
      updateStreamingMessage,
      finalizeStreamingMessage,
      onEmotionChange,
    ]
  );

  const interrupt = useCallback(() => {
    agentService.current.interrupt();
    agentService.current.stopEmotionPolling();
    toolsInUseRef.current = [];
    setStreamingState({
      isStreaming: false,
      partialContent: "",
      toolsInUse: [],
    });
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    agentService.current.clearSession();
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    messages,
    streamingState,
    error,
    sendMessage,
    interrupt,
    clearHistory,
    isTyping: streamingState.isStreaming,
  };
}
