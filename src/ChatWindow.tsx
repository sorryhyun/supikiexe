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

  // Listen for close request from main window
  useEffect(() => {
    const unlisten = listen("close-chat", async () => {
      const appWindow = getCurrentWindow();
      await appWindow.close();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages, chat.isTyping]);

  // Enable window dragging on the header
  const handleDragStart = async () => {
    const appWindow = getCurrentWindow();
    await appWindow.startDragging();
  };

  return (
    <div className="chat-window">
      <div className="chat-window-header" onMouseDown={handleDragStart}>
        <span className="chat-window-title">Chat with Clawd</span>
        <button
          className="chat-window-close"
          onClick={async () => {
            emit("chat-closed");
            const appWindow = getCurrentWindow();
            await appWindow.close();
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
        <div className="chat-messages">
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
