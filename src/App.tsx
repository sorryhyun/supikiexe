import { useEffect, useRef, useState, useCallback } from "react";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
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

// Default offset for chat window relative to Clawd
const DEFAULT_CHAT_OFFSET = {
  x: WINDOW_WIDTH - 5,
  y: -CHAT_HEIGHT + WINDOW_HEIGHT - 20,
};

function App() {
  const [isDragging, setIsDragging] = useState(false);
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const walkTimeoutRef = useRef<number | null>(null);
  const autoWalkRef = useRef<number | null>(null);
  const chatWindowRef = useRef<WebviewWindow | null>(null);
  const chatOpenRef = useRef(false); // Sync ref to track chat state
  const chatOffsetRef = useRef({ ...DEFAULT_CHAT_OFFSET }); // Relative offset from Clawd

  const mascot = useMascotState();

  const handlePositionUpdate = useCallback(async (x: number, y: number) => {
    // Update chat window position relative to Clawd when Clawd moves
    if (chatOpenRef.current && chatWindowRef.current) {
      const appWindow = getCurrentWindow();
      const factor = await appWindow.scaleFactor();

      const chatX = x + chatOffsetRef.current.x;
      const chatY = Math.max(0, y + chatOffsetRef.current.y);

      try {
        await chatWindowRef.current.setPosition(new PhysicalPosition(
          Math.round(chatX * factor),
          Math.round(chatY * factor)
        ));
      } catch (err) {
        // Chat window may have been closed
      }
    }
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

  // Listen for walk-to-window events from sidecar
  useEffect(() => {
    const unlisten = listen<{ targetX: number; windowTitle: string }>("walk-to-window", (event) => {
      const { targetX } = event.payload;
      console.log("[App] walk-to-window event, targetX:", targetX);

      // Don't walk if chat is open or dragging
      if (chatOpen || isDragging) return;

      // Determine direction based on target
      const currentX = physics.getState().x;
      const direction = targetX > currentX ? "right" : "left";
      mascot.setDirection(direction);
      mascot.setState("walking");

      // Walk to target, then show curious emotion
      physics.walkToX(targetX, () => {
        mascot.setState("idle");
        mascot.setDirection(physics.getDirection());
        mascot.setEmotion("curious", 5000);
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [chatOpen, isDragging, mascot, physics]);

  // Listen for move events from sidecar
  useEffect(() => {
    const unlisten = listen<{ target: string; x: number | null }>("clawd-move", async (event) => {
      const { target, x } = event.payload;
      console.log("[App] clawd-move event:", { target, x });

      // Don't move if chat is open or dragging
      if (chatOpen || isDragging) return;

      // Get screen bounds to calculate named positions
      const monitor = await currentMonitor();
      const appWindow = getCurrentWindow();
      const scaleFactor = await appWindow.scaleFactor();

      if (!monitor) {
        console.error("[App] Could not get monitor info");
        return;
      }

      const screenWidth = monitor.size.width / scaleFactor;

      // Calculate target X based on target type
      let targetX: number;
      switch (target) {
        case "left":
          targetX = monitor.position.x / scaleFactor;
          break;
        case "right":
          targetX = (monitor.position.x / scaleFactor) + screenWidth - WINDOW_WIDTH;
          break;
        case "center":
          targetX = (monitor.position.x / scaleFactor) + (screenWidth / 2) - (WINDOW_WIDTH / 2);
          break;
        case "coordinates":
          targetX = x ?? physics.getState().x;
          break;
        default:
          console.error("[App] Unknown move target:", target);
          return;
      }

      // Walk to target
      const currentX = physics.getState().x;
      const direction = targetX > currentX ? "right" : "left";
      mascot.setDirection(direction);
      mascot.setState("walking");

      physics.walkToX(targetX, () => {
        mascot.setState("idle");
        mascot.setDirection(physics.getDirection());
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [chatOpen, isDragging, mascot, physics]);

  // Listen for chat window closed (by focus loss or X button)
  useEffect(() => {
    const unlisten = listen("chat-closed", () => {
      chatOpenRef.current = false;
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

  // Listen for chat window moved (user drag) and update relative offset
  useEffect(() => {
    const unlisten = listen("chat-window-moved", async (event) => {
      const { chatX, chatY } = event.payload as { chatX: number; chatY: number };

      // Get Clawd's current position directly from window
      const appWindow = getCurrentWindow();
      const position = await appWindow.outerPosition();
      const factor = await appWindow.scaleFactor();
      const clawdX = position.x / factor;
      const clawdY = position.y / factor;

      // Calculate new offset relative to Clawd's current position
      chatOffsetRef.current = {
        x: chatX - clawdX,
        y: chatY - clawdY,
      };
      console.log("[App] Chat offset updated:", chatOffsetRef.current);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Auto-walk behavior
  useEffect(() => {
    if (chatOpen) return;

    const scheduleAutoWalk = () => {
      const delay = 15000 + Math.random() * 30000;
      autoWalkRef.current = window.setTimeout(() => {
        // Check conditions at execution time, not capture time
        if (!isDragging && mascot.state === "idle" && mascot.isGrounded && !chatOpen) {
          if (Math.random() > 0.7) {
            const direction = Math.random() > 0.5 ? "right" : "left";
            mascot.setDirection(direction);
            mascot.setState("walking");
            physics.startWalking(direction);

            const walkDuration = 1500;
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
      // Don't clear walkTimeoutRef here - let it complete
    };
  }, [chatOpen, isDragging]);

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

    // Position chat window using stored relative offset
    const chatX = clawdX + chatOffsetRef.current.x;
    const chatY = Math.max(0, clawdY + chatOffsetRef.current.y);
    console.log("[App] Opening chat at offset:", chatOffsetRef.current, "-> position:", { chatX, chatY });

    // Try to get existing chat window first
    const existingWindow = await WebviewWindow.getByLabel("chat");
    console.log("[App] openChatWindow - existingWindow:", existingWindow ? "exists" : "null");

    if (existingWindow) {
      // Window exists - reposition, show, and focus
      try {
        console.log("[App] Showing existing chat window");
        await existingWindow.setPosition(new PhysicalPosition(
          Math.round(chatX * factor),
          Math.round(chatY * factor)
        ));
        await existingWindow.show();
        await existingWindow.setFocus();
        chatWindowRef.current = existingWindow;
        return;
      } catch (err) {
        console.log("[App] Show failed:", err);
        // Window is in bad state, will create new one
      }
    }

    console.log("[App] Creating new chat window at", Math.round(chatX), Math.round(chatY));

    try {
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

      // Wait for window to be created
      await new Promise<void>((resolve, reject) => {
        chatWindow.once("tauri://created", () => {
          console.log("[App] Chat window created successfully");
          resolve();
        });
        chatWindow.once("tauri://error", (e) => {
          console.log("[App] Chat window creation error:", e);
          reject(e);
        });
      });

      chatWindowRef.current = chatWindow;
    } catch (err) {
      console.error("[App] Failed to create chat window:", err);
      chatOpenRef.current = false;
      setChatOpen(false);
      mascot.setState("idle");
      if (physicsEnabled) {
        physics.startPhysics();
      }
    }
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

    // Use chatOpenRef as source of truth for visibility
    console.log("[App] handleClick - chatOpenRef:", chatOpenRef.current);

    if (chatOpenRef.current) {
      // Hide chat window
      console.log("[App] Hiding chat window");
      chatOpenRef.current = false;

      const existingWindow = await WebviewWindow.getByLabel("chat");
      if (existingWindow) {
        try {
          await existingWindow.hide();
        } catch (err) {
          console.log("[App] Hide error:", err);
        }
      }
      setChatOpen(false);
      mascot.setState("idle");
      if (physicsEnabled) {
        physics.startPhysics();
      }
    } else {
      // Open/show chat window
      console.log("[App] Opening chat window");
      chatOpenRef.current = true;
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
