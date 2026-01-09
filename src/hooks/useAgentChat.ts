import { useState, useCallback, useRef, useEffect } from "react";
import { getAgentService } from "../services/agentService";
import { detectEmotion } from "../services/emotionMapper";
import { sessionStorage } from "../services/sessionStorage";
import { generateId } from "../utils/id";
import type {
  AgentChatMessage,
  StreamingState,
  AgentQueryCallbacks,
  Emotion,
  AgentQuestionEvent,
  AttachedImage,
} from "../services/agentTypes";

const MAX_MESSAGES = 100;

interface UseAgentChatOptions {
  onEmotionChange?: (emotion: Emotion) => void;
  sessionId?: string; // Optional: load specific session for viewing history
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const { onEmotionChange, sessionId: viewSessionId } = options;

  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [streamingState, setStreamingState] = useState<StreamingState>({
    isStreaming: false,
    partialContent: "",
    toolsInUse: [],
  });
  const [error, setError] = useState<Error | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<AgentQuestionEvent | null>(null);

  const agentService = useRef(getAgentService());
  const streamingMessageId = useRef<string | null>(null);
  const toolsInUseRef = useRef<string[]>([]);

  // Register emotion callback - emotions now come via events, not polling!
  useEffect(() => {
    const unsubscribe = agentService.current.onEmotionUpdate(
      (emotion, _duration) => {
        console.log("[useAgentChat] Emotion event received:", emotion);
        onEmotionChange?.(emotion);
      }
    );
    return unsubscribe;
  }, [onEmotionChange]);

  // Register question callback for AskUserQuestion tool
  useEffect(() => {
    const unsubscribe = agentService.current.onQuestion((event) => {
      console.log("[useAgentChat] Question event received:", event);
      setPendingQuestion(event);
      // Show curious expression when asking a question
      onEmotionChange?.("thinking");
    });
    return unsubscribe;
  }, [onEmotionChange]);

  // Initialize session on mount - restore existing or create new
  useEffect(() => {
    if (viewSessionId) {
      // Load specific session for viewing
      const session = sessionStorage.getSession(viewSessionId);
      if (session) {
        setMessages(session.messages);
        setCurrentSessionId(session.id);
      }
    } else {
      // Try to restore current session first
      const existingSessionId = sessionStorage.getCurrentSessionId();
      if (existingSessionId) {
        const existingSession = sessionStorage.getSession(existingSessionId);
        if (existingSession) {
          setMessages(existingSession.messages);
          setCurrentSessionId(existingSession.id);
          return;
        }
      }
      // No existing session, create new one
      const session = sessionStorage.createSession();
      setCurrentSessionId(session.id);
      setMessages([]);
    }
  }, [viewSessionId]);

  // Save to session storage whenever messages change
  useEffect(() => {
    if (currentSessionId && messages.length > 0 && !viewSessionId) {
      const claudeSessionId = messages.find((m) => m.sessionId)?.sessionId;
      sessionStorage.updateSession(currentSessionId, messages, claudeSessionId);
    }
  }, [messages, currentSessionId, viewSessionId]);

  const addMessage = useCallback(
    (
      sender: "user" | "clawd",
      content: string,
      metadata?: Partial<AgentChatMessage>
    ) => {
      const newMessage: AgentChatMessage = {
        id: generateId(),
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
    async (content: string, images?: AttachedImage[]) => {
      setError(null);

      // Build user message content - include image indicators if any
      const displayContent = images?.length
        ? `${content}${content ? " " : ""}[${images.length} image${images.length > 1 ? "s" : ""} attached]`
        : content;

      // Add user message
      addMessage("user", displayContent);

      // Create placeholder for streaming response
      const placeholderMsg = addMessage("clawd", "", { isStreaming: true });
      streamingMessageId.current = placeholderMsg.id;

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
          // Note: Emotions are handled via MCP events from the sidecar
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

          // Final emotion based on result (fallback)
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

      await agentService.current.sendMessage(content, callbacks, images);
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
    // Create a new session after clearing
    const session = sessionStorage.createSession();
    setCurrentSessionId(session.id);
  }, []);

  // Answer a pending question from AskUserQuestion
  const answerQuestion = useCallback(
    async (answers: Record<string, string>) => {
      if (!pendingQuestion) return;

      try {
        await agentService.current.answerQuestion(
          pendingQuestion.questionId,
          pendingQuestion.questions,
          answers
        );
        setPendingQuestion(null);
        // Return to neutral or thinking while processing
        onEmotionChange?.("thinking");
      } catch (err) {
        console.error("[useAgentChat] Error answering question:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [pendingQuestion, onEmotionChange]
  );

  // Cancel/dismiss a pending question
  const cancelQuestion = useCallback(() => {
    // For now, just clear the pending question
    // The sidecar will timeout or handle it
    setPendingQuestion(null);
    onEmotionChange?.("neutral");
  }, [onEmotionChange]);

  return {
    messages,
    streamingState,
    error,
    sendMessage,
    interrupt,
    clearHistory,
    isTyping: streamingState.isStreaming,
    currentSessionId,
    pendingQuestion,
    answerQuestion,
    cancelQuestion,
  };
}

// Export session storage for history list
export { sessionStorage };
