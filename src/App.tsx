import { useEffect, useRef, useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import Clawd from "./Clawd";
import SpeechBubble from "./SpeechBubble";
import ChatInput from "./ChatInput";
import { useMascotState } from "./useMascotState";
import { usePhysics } from "./usePhysics";
import { useChatHistory } from "./useChatHistory";
import type { Emotion } from "./emotions";

const WINDOW_WIDTH = 160;
const WINDOW_HEIGHT = 140;
const CHAT_WINDOW_WIDTH = 320;
const CHAT_WINDOW_HEIGHT = 400;

function App() {
  const [isDragging, setIsDragging] = useState(false);
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const walkTimeoutRef = useRef<number | null>(null);
  const autoWalkRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const mascot = useMascotState();

  // Callback to update mascot emotion based on agent activity
  const handleEmotionChange = useCallback((emotion: Emotion) => {
    mascot.setEmotion(emotion);
  }, [mascot]);

  const chat = useChatHistory({ onEmotionChange: handleEmotionChange });

  const handlePositionUpdate = useCallback(() => {
    // Position updated - could track for UI if needed
  }, []);

  const handleGrounded = useCallback((grounded: boolean) => {
    mascot.setGrounded(grounded);
    if (grounded && mascot.state === "jumping") {
      mascot.setState("idle");
    }
    if (!grounded && mascot.state !== "jumping") {
      mascot.setState("falling");
    }
  }, [mascot]);

  const handleEdgeHit = useCallback((edge: "left" | "right") => {
    // Turn around when hitting an edge
    mascot.setDirection(edge === "left" ? "right" : "left");
  }, [mascot]);

  const physics = usePhysics({
    windowWidth: WINDOW_WIDTH,
    windowHeight: WINDOW_HEIGHT,
    onPositionUpdate: handlePositionUpdate,
    onGrounded: handleGrounded,
    onEdgeHit: handleEdgeHit,
  });

  // Start physics on mount
  useEffect(() => {
    if (physicsEnabled && !chatOpen) {
      physics.startPhysics();
    }
    return () => {
      physics.stopPhysics();
    };
  }, [physicsEnabled, chatOpen]);

  // Resize window when chat opens/closes
  useEffect(() => {
    const resizeWindow = async () => {
      try {
        const appWindow = getCurrentWindow();
        const scaleFactor = await appWindow.scaleFactor();
        const currentPos = await appWindow.outerPosition();

        if (chatOpen) {
          physics.stopPhysics();
          // Move window UP before resizing so it expands upward, not downward
          const heightDiff = (CHAT_WINDOW_HEIGHT - WINDOW_HEIGHT) * scaleFactor;
          const newY = Math.max(0, currentPos.y - heightDiff);
          await appWindow.setPosition(new PhysicalPosition(currentPos.x, newY));
          await appWindow.setSize(new LogicalSize(CHAT_WINDOW_WIDTH, CHAT_WINDOW_HEIGHT));
        } else {
          // When closing chat, resize first then move back down
          await appWindow.setSize(new LogicalSize(WINDOW_WIDTH, WINDOW_HEIGHT));
          if (physicsEnabled) {
            await physics.syncPosition();
            physics.startPhysics();
          }
        }
      } catch (err) {
        console.error("Failed to resize window:", err);
      }
    };
    resizeWindow();
  }, [chatOpen]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages, chat.isTyping]);

  // Auto-walk behavior: randomly start walking (disabled when chat is open)
  useEffect(() => {
    if (chatOpen) return;

    const scheduleAutoWalk = () => {
      const delay = 15000 + Math.random() * 30000; // 15-45 seconds
      autoWalkRef.current = window.setTimeout(() => {
        if (!isDragging && mascot.state === "idle" && mascot.isGrounded && !chatOpen) {
          // 30% chance to start walking
          if (Math.random() > 0.7) {
            const direction = Math.random() > 0.5 ? "right" : "left";
            mascot.setDirection(direction);
            mascot.setState("walking");
            physics.startWalking(direction);

            // Walk for 1-2 seconds
            const walkDuration = 1000 + Math.random() * 1000;
            walkTimeoutRef.current = window.setTimeout(() => {
              physics.stopWalking();
              mascot.setState("idle");
            }, walkDuration);
          }
        }
        scheduleAutoWalk();
      }, delay);
    };

    scheduleAutoWalk();

    return () => {
      if (autoWalkRef.current) clearTimeout(autoWalkRef.current);
      if (walkTimeoutRef.current) clearTimeout(walkTimeoutRef.current);
    };
  }, [isDragging, mascot.state, mascot.isGrounded, chatOpen]);

  // Drag handling
  useEffect(() => {
    const handleMouseMove = async (e: MouseEvent) => {
      if (!isDragging) return;

      const appWindow = getCurrentWindow();
      const factor = await appWindow.scaleFactor();
      const currentPos = await appWindow.outerPosition();

      const newPosition = new PhysicalPosition(
        Math.round(currentPos.x + e.movementX * factor),
        Math.round(currentPos.y + e.movementY * factor)
      );
      await appWindow.setPosition(newPosition);
    };

    const handleMouseUp = async () => {
      setIsDragging(false);
      // Re-sync physics position after drag
      await physics.syncPosition();
      if (physicsEnabled) {
        physics.startPhysics();
      }
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, physics, physicsEnabled]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    // Stop physics while dragging
    physics.stopPhysics();
    physics.stopWalking();
    if (walkTimeoutRef.current) {
      clearTimeout(walkTimeoutRef.current);
    }
    mascot.setState("idle");
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Toggle chat mode
    setChatOpen((prev) => !prev);
    if (!chatOpen) {
      // Stop any walking when opening chat
      physics.stopWalking();
      mascot.setState("talking");
      if (walkTimeoutRef.current) {
        clearTimeout(walkTimeoutRef.current);
      }
    } else {
      mascot.setState("idle");
    }
  };

  const handleSendMessage = (message: string) => {
    chat.sendMessage(message);
    // Note: mascot state is now managed by the agent hook via onEmotionChange
  };

  // Double-click to toggle physics
  const handleDoubleClick = () => {
    setPhysicsEnabled((prev) => !prev);
  };

  return (
    <div
      className={`mascot-container ${chatOpen ? "chat-mode" : ""}`}
      onMouseDown={chatOpen ? undefined : handleMouseDown}
      onDoubleClick={chatOpen ? undefined : handleDoubleClick}
    >
      {chatOpen && (
        <div className="chat-container">
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
            {chat.isTyping && !chat.messages.some(m => m.isStreaming) && (
              <SpeechBubble message="" sender="clawd" isTyping />
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="chat-input-row">
            <ChatInput onSend={handleSendMessage} disabled={chat.isTyping} />
            {chat.isTyping && (
              <button className="interrupt-btn" onClick={chat.interrupt}>
                Stop
              </button>
            )}
          </div>
        </div>
      )}
      <Clawd
        state={mascot.state}
        direction={mascot.direction}
        emotion={mascot.emotion}
        onClick={handleClick}
      />
    </div>
  );
}

export default App;
