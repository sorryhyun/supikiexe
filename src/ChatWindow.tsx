import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import SpeechBubble from "./SpeechBubble";
import ChatInput from "./ChatInput";
import { useChatHistory } from "./useChatHistory";
import type { Emotion } from "./emotions";

function ChatWindow() {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleEmotionChange = (emotion: Emotion) => {
    // Send emotion to main window
    emit("emotion-change", emotion);
  };

  const chat = useChatHistory({ onEmotionChange: handleEmotionChange });

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

  // Hide chat window when it loses focus (clicking outside)
  // Use a delay to avoid hiding during drag operations
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let hideTimeout: number | null = null;

    const unlisten = appWindow.onFocusChanged(async ({ payload: focused }) => {
      if (focused) {
        // Cancel any pending hide if we regain focus
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
      } else {
        // Delay hide to allow for drag operations
        hideTimeout = window.setTimeout(async () => {
          emit("chat-closed");
          await appWindow.hide();
        }, 150);
      }
    });

    return () => {
      if (hideTimeout) clearTimeout(hideTimeout);
      unlisten.then((fn) => fn());
    };
  }, []);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages, chat.isTyping]);

  // Track whether user initiated a drag
  const userInitiatedDragRef = useRef(false);

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

  // Enable window dragging - exclude input elements and buttons
  const handleDragStart = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();

    // Don't drag if clicking on interactive elements
    if (tagName === "input" || tagName === "textarea" || tagName === "button") {
      return;
    }

    const appWindow = getCurrentWindow();

    // Mark that user initiated this drag
    userInitiatedDragRef.current = true;
    await appWindow.startDragging();
  };

  return (
    <div className="chat-window" onMouseDown={handleDragStart}>
      <div className="chat-window-header" onMouseDown={handleDragStart}>
        <span className="chat-window-title">Chat with Clawd</span>
        <button
          className="chat-window-close"
          onClick={async () => {
            emit("chat-closed");
            const appWindow = getCurrentWindow();
            await appWindow.hide();
          }}
        >
          ×
        </button>
      </div>
      <div className="chat-window-body">
        {/* Tool indicator when agent is using tools */}
        {chat.streamingState?.currentToolName && (
          <div className="tool-indicator">
            Using: {chat.streamingState.currentToolName}
          </div>
        )}
        <div className="chat-messages" onMouseDown={handleDragStart}>
          {chat.messages.map((msg) => (
            <SpeechBubble
              key={msg.id}
              message={msg.content}
              sender={msg.sender}
              isStreaming={msg.isStreaming}
            />
          ))}
          {chat.isTyping && !chat.messages.some((m) => m.isStreaming) && (
            <SpeechBubble message="" sender="clawd" isTyping />
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="chat-input-row">
          <ChatInput onSend={chat.sendMessage} disabled={chat.isTyping} />
          {chat.isTyping && (
            <button className="interrupt-btn" onClick={chat.interrupt}>
              Stop
            </button>
          )}
        </div>
      </div>
      {/* Speech bubble tail pointing to Clawd */}
      <div className="chat-window-tail"></div>
    </div>
  );
}

export default ChatWindow;
