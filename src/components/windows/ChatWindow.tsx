import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import SpeechBubble from "../mascot/SpeechBubble";
import ChatInput, { type AttachedImage } from "../chat/ChatInput";
import QuestionModal from "../modals/QuestionModal";
import { useAgentChat } from "../../hooks/useAgentChat";
import { useModalWindow } from "../../hooks/useModalWindow";
import type { Emotion } from "../../emotion";

function ChatWindow() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const skipBlurRef = useRef(false);

  // Check if viewing a past session (read-only mode)
  const urlParams = new URLSearchParams(window.location.search);
  const viewSessionId = urlParams.get("viewSession");
  const isViewMode = !!viewSessionId;

  const handleEmotionChange = (emotion: Emotion) => {
    // Send emotion to main window (only in active chat mode)
    if (!isViewMode) {
      emit("emotion-change", emotion);
    }
  };

  const chat = useAgentChat({
    onEmotionChange: handleEmotionChange,
    sessionId: viewSessionId || undefined,
  });

  // Skip blur when agent is processing (node.exe spawning can steal focus)
  useEffect(() => {
    skipBlurRef.current = chat.isTyping;
  }, [chat.isTyping]);

  // Handle blur: emit event and hide window
  const handleBlur = useCallback(async () => {
    emit("chat-closed");
    const appWindow = getCurrentWindow();
    await appWindow.hide();
  }, []);

  // Use modal window behavior (focus/blur handling, drag start)
  const { handleDragStart, userInitiatedDragRef } = useModalWindow({
    closeOnBlur: true,
    onBlur: handleBlur,
    skipBlurRef,
  });

  // Listen for hide request from main window
  useEffect(() => {
    const unlisten = listen("hide-chat", async () => {
      const appWindow = getCurrentWindow();
      await appWindow.hide();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for cwd-changed event from CwdWindow
  useEffect(() => {
    const unlisten = listen("cwd-changed", () => {
      chat.clearHistory();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [chat]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages, chat.isTyping]);

  // Listen for window moved events and notify main window of new position
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let moveDebounceTimeout: number | null = null;

    const unlistenMove = appWindow.onMoved(async ({ payload: position }) => {
      // Only process moves that were user-initiated
      if (!userInitiatedDragRef.current) return;

      // Debounce: only emit after moves stop for a bit
      if (moveDebounceTimeout) clearTimeout(moveDebounceTimeout);
      moveDebounceTimeout = window.setTimeout(async () => {
        const factor = await appWindow.scaleFactor();
        const logicalX = position.x / factor;
        const logicalY = position.y / factor;
        console.log("[ChatWindow] Emitting chat-window-moved:", { chatX: logicalX, chatY: logicalY });
        emit("chat-window-moved", { chatX: logicalX, chatY: logicalY });
        // Reset after emitting the final position
        userInitiatedDragRef.current = false;
      }, 50);
    });

    return () => {
      if (moveDebounceTimeout) clearTimeout(moveDebounceTimeout);
      unlistenMove.then((fn) => fn());
    };
  }, []);

  return (
    <div className="chat-window" onMouseDown={handleDragStart}>
      <div className="chat-window-header" onMouseDown={handleDragStart}>
        <span className="chat-window-title">
          {isViewMode ? "Chat History" : "Chat with Clawd"}
        </span>
        <div className="chat-window-buttons">
          {!isViewMode && (
            <>
              {chat.isTyping && (
                <button
                  className="chat-window-stop"
                  onClick={chat.interrupt}
                  title="Stop"
                >
                  ■
                </button>
              )}
              <button
                className="chat-window-refresh"
                onClick={() => {
                  chat.clearHistory();
                }}
                title="Start new chat"
              >
                ↻
              </button>
            </>
          )}
          <button
            className="chat-window-close"
            onClick={async () => {
              if (!isViewMode) {
                emit("chat-closed");
              }
              const appWindow = getCurrentWindow();
              await appWindow.close();
            }}
          >
            x
          </button>
        </div>
      </div>
      <div className="chat-window-body">
        {/* Tool indicator when agent is using tools */}
        {!isViewMode && chat.streamingState?.currentToolName && (
          <div className="tool-indicator">
            Using: {chat.streamingState.currentToolName}
          </div>
        )}
        <div className="chat-messages" onMouseDown={handleDragStart}>
          {chat.messages.length === 0 && isViewMode ? (
            <div className="history-list-empty">No messages in this session</div>
          ) : (
            chat.messages.map((msg) => (
              <SpeechBubble
                key={msg.id}
                message={msg.content}
                sender={msg.sender}
                isStreaming={msg.isStreaming}
              />
            ))
          )}
          {!isViewMode && chat.isTyping && !chat.messages.some((m) => m.isStreaming) && (
            <SpeechBubble message="" sender="clawd" isTyping />
          )}
          <div ref={messagesEndRef} />
        </div>
        {!isViewMode && (
          <div className="chat-input-row">
            <ChatInput
              onSend={(msg: string, images?: AttachedImage[]) =>
                chat.sendMessage(msg, images)
              }
              disabled={chat.isTyping}
              onAnalyzeScreen={() =>
                chat.sendMessage("Capture a screenshot and analyze the problem you see")
              }
            />
          </div>
        )}
      </div>
      {/* Speech bubble tail pointing to Clawd */}
      <div className="chat-window-tail"></div>

      {/* Question modal for AskUserQuestion tool */}
      {!isViewMode && chat.pendingQuestion && (
        <QuestionModal
          questionId={chat.pendingQuestion.questionId}
          questions={chat.pendingQuestion.questions}
          onSubmit={chat.answerQuestion}
          onCancel={chat.cancelQuestion}
        />
      )}
    </div>
  );
}

export default ChatWindow;
