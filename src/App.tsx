import { useEffect, useRef, useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import Clawd from "./Clawd";
import { useMascotState } from "./useMascotState";
import { usePhysics } from "./usePhysics";
import type { Emotion } from "./emotions";

const WINDOW_WIDTH = 160;
const WINDOW_HEIGHT = 140;
const CHAT_WIDTH = 220;
const CHAT_HEIGHT = 280;

function App() {
  const [isDragging, setIsDragging] = useState(false);
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const walkTimeoutRef = useRef<number | null>(null);
  const autoWalkRef = useRef<number | null>(null);
  const chatWindowRef = useRef<WebviewWindow | null>(null);

  const mascot = useMascotState();

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

  // Listen for emotion changes from chat window
  useEffect(() => {
    const unlisten = listen<Emotion>("emotion-change", (event) => {
      mascot.setEmotion(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [mascot]);

  // Listen for chat window closed
  useEffect(() => {
    const unlisten = listen("chat-closed", () => {
      setChatOpen(false);
      chatWindowRef.current = null;
      mascot.setState("idle");
      if (physicsEnabled) {
        physics.startPhysics();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [physicsEnabled, physics, mascot]);

  // Auto-walk behavior
  useEffect(() => {
    if (chatOpen) return;

    const scheduleAutoWalk = () => {
      const delay = 15000 + Math.random() * 30000;
      autoWalkRef.current = window.setTimeout(() => {
        if (!isDragging && mascot.state === "idle" && mascot.isGrounded && !chatOpen) {
          if (Math.random() > 0.7) {
            const direction = Math.random() > 0.5 ? "right" : "left";
            mascot.setDirection(direction);
            mascot.setState("walking");
            physics.startWalking(direction);

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

      if (dragStartPos.current) {
        const dx = Math.abs(e.clientX - dragStartPos.current.x);
        const dy = Math.abs(e.clientY - dragStartPos.current.y);
        if (dx > 5 || dy > 5) {
          wasDragged.current = true;
        }
      }

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
      dragStartPos.current = null;

      if (clickedOnClawd.current && !wasDragged.current) {
        clickedOnClawd.current = false;
        return;
      }

      clickedOnClawd.current = false;
      await physics.syncPosition();
      if (physicsEnabled && !chatOpen) {
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
  }, [isDragging, physics, physicsEnabled, chatOpen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    clickedOnClawd.current = false;
    setIsDragging(true);
    physics.stopPhysics();
    physics.stopWalking();
    if (walkTimeoutRef.current) {
      clearTimeout(walkTimeoutRef.current);
    }
    mascot.setState("idle");
  };

  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const wasDragged = useRef(false);
  const clickedOnClawd = useRef(false);

  const handleClawdMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    wasDragged.current = false;
    clickedOnClawd.current = true;
    setIsDragging(true);
    physics.stopPhysics();
    physics.stopWalking();
    if (walkTimeoutRef.current) {
      clearTimeout(walkTimeoutRef.current);
    }
    mascot.setState("idle");
  };

  const openChatWindow = async () => {
    const appWindow = getCurrentWindow();
    const position = await appWindow.outerPosition();
    const factor = await appWindow.scaleFactor();

    // Convert physical position to logical
    const clawdX = position.x / factor;
    const clawdY = position.y / factor;

    // Position chat window to the right of Clawd
    // Chat tail is on the left, pointing at Clawd
    const chatX = clawdX + WINDOW_WIDTH - 5; // Right of Clawd, slight overlap for tail
    const chatY = Math.max(0, clawdY - CHAT_HEIGHT + WINDOW_HEIGHT - 20); // Align tail with Clawd

    const chatWindow = new WebviewWindow("chat", {
      url: "index.html?chat=true",
      title: "Chat",
      width: CHAT_WIDTH,
      height: CHAT_HEIGHT,
      x: Math.round(chatX),
      y: Math.round(chatY),
      resizable: false,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      shadow: false,
    });

    chatWindowRef.current = chatWindow;
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (wasDragged.current) {
      wasDragged.current = false;
      await physics.syncPosition();
      if (physicsEnabled) {
        physics.startPhysics();
      }
      return;
    }

    if (chatOpen) {
      // Close chat window
      if (chatWindowRef.current) {
        await chatWindowRef.current.close();
        chatWindowRef.current = null;
      }
      setChatOpen(false);
      mascot.setState("idle");
      if (physicsEnabled) {
        physics.startPhysics();
      }
    } else {
      // Open chat window
      physics.stopPhysics();
      physics.stopWalking();
      mascot.setState("talking");
      setChatOpen(true);
      await openChatWindow();
    }
  };

  const handleDoubleClick = () => {
    setPhysicsEnabled((prev) => !prev);
  };

  return (
    <div
      className="mascot-container"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div className="clawd-wrapper">
        <Clawd
          state={mascot.state}
          direction={mascot.direction}
          emotion={mascot.emotion}
          onClick={handleClick}
          onMouseDown={handleClawdMouseDown}
        />
      </div>
    </div>
  );
}

export default App;
