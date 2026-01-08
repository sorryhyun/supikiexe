import { useEffect, useState, useCallback, useMemo } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Supiki from "./Supiki";
import { useAnimationState } from "../hooks/useMascotState";
import { usePhysics } from "../hooks/usePhysics";
import { useChatWindow } from "../hooks/useChatWindow";
import { useDrag } from "../hooks/useDrag";
import { useAutoWalk } from "../hooks/useAutoWalk";
import { useClawdEvents } from "../hooks/useClawdEvents";
import { useContextMenu } from "../hooks/useContextMenu";
import { useSupikiSounds } from "../hooks/useSupikiSounds";
import { WINDOW_WIDTH, WINDOW_HEIGHT, CHAT_WIDTH, CHAT_HEIGHT } from "../constants";

function SupikiApp() {
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  const supiki = useAnimationState();
  const { openContextMenu, closeContextMenu } = useContextMenu();
  const { playEmotionSound } = useSupikiSounds();

  // Play sound when emotion changes
  useEffect(() => {
    playEmotionSound(supiki.emotion);
  }, [supiki.emotion, playEmotionSound]);

  // Chat window management
  const chatWindow = useChatWindow(
    () => {
      // onOpen
      setChatOpen(true);
      supiki.setAnimationState("talking");
    },
    () => {
      // onClose
      setChatOpen(false);
      supiki.setAnimationState("idle");
    }
  );

  // Physics callbacks
  const handlePositionUpdate = useCallback(
    async (x: number, y: number) => {
      await chatWindow.updatePosition(x, y);
    },
    [chatWindow]
  );

  const handleGrounded = useCallback(
    (grounded: boolean) => {
      supiki.setGrounded(grounded);
      if (grounded && supiki.animationState === "jumping") {
        supiki.setAnimationState("idle");
      }
      if (!grounded && supiki.animationState !== "jumping") {
        supiki.setAnimationState("falling");
      }
    },
    [supiki]
  );

  const handleEdgeHit = useCallback(
    (edge: "left" | "right") => {
      supiki.setDirection(edge === "left" ? "right" : "left");
    },
    [supiki]
  );

  const physics = usePhysics({
    windowWidth: WINDOW_WIDTH,
    windowHeight: WINDOW_HEIGHT,
    onPositionUpdate: handlePositionUpdate,
    onGrounded: handleGrounded,
    onEdgeHit: handleEdgeHit,
  });

  // Drag handling
  const { stopWalking: stopAutoWalk } = useAutoWalk({
    isEnabled: !chatOpen,
    canWalk: () => !drag.isDragging && supiki.animationState === "idle" && supiki.isGrounded,
    onStartWalk: (direction) => {
      supiki.setDirection(direction);
      supiki.setAnimationState("walking");
      physics.startWalking(direction);
    },
    onStopWalk: () => {
      physics.stopWalking();
      supiki.setAnimationState("idle");
    },
  });

  const drag = useDrag({
    onDragStart: () => {
      closeContextMenu();
      physics.stopPhysics();
      physics.stopWalking();
      stopAutoWalk();
      supiki.setAnimationState("idle");
    },
    onDragEnd: async () => {
      await physics.syncPosition();
      if (physicsEnabled && !chatOpen) {
        physics.startPhysics();
      }
    },
  });

  // Event handlers for Clawd events
  const eventHandlers = useMemo(
    () => ({
      onEmotionChange: (emotion: Parameters<typeof supiki.setEmotion>[0]) => {
        supiki.setEmotion(emotion);
      },
      onWalkToWindow: (targetX: number) => {
        const currentX = physics.getState().x;
        const direction = targetX > currentX ? "right" : "left";
        supiki.setDirection(direction);
        supiki.setAnimationState("walking");
        physics.walkToX(targetX, () => {
          supiki.setAnimationState("idle");
          supiki.setDirection(physics.getDirection());
          supiki.setEmotion("curious", 5000);
        });
      },
      onMove: (_target: string, targetX: number | null) => {
        if (targetX === null) return;
        const currentX = physics.getState().x;
        const direction = targetX > currentX ? "right" : "left";
        supiki.setDirection(direction);
        supiki.setAnimationState("walking");
        physics.walkToX(targetX, () => {
          supiki.setAnimationState("idle");
          supiki.setDirection(physics.getDirection());
        });
      },
      onChatClosed: () => {
        (chatWindow as ReturnType<typeof useChatWindow> & { _handleClosed: () => void })._handleClosed();
        if (physicsEnabled) {
          physics.startPhysics();
        }
      },
      onChatMoved: (chatX: number, chatY: number) => {
        chatWindow.updateOffset(chatX, chatY);
      },
      onOpenChatHistory: async () => {
        physics.stopPhysics();
        physics.stopWalking();
        await chatWindow.open();
      },
      onOpenSession: async (sessionId: string) => {
        // Close existing session viewer if open
        const existing = await WebviewWindow.getByLabel("session-viewer");
        if (existing) {
          await existing.close();
        }

        // Get position near mascot
        const appWindow = getCurrentWindow();
        const position = await appWindow.outerPosition();
        const factor = await appWindow.scaleFactor();
        const supikiX = position.x / factor;
        const supikiY = position.y / factor;

        // Open session viewer window
        new WebviewWindow("session-viewer", {
          url: `index.html?chat=true&viewSession=${sessionId}`,
          title: "Chat History",
          width: CHAT_WIDTH,
          height: CHAT_HEIGHT,
          x: Math.round(supikiX + WINDOW_WIDTH - 5),
          y: Math.round(supikiY - CHAT_HEIGHT + WINDOW_HEIGHT - 20),
          resizable: false,
          decorations: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          shadow: false,
        });
      },
    }),
    [supiki, physics, chatWindow, physicsEnabled]
  );

  useClawdEvents(eventHandlers, {
    chatOpen,
    isDragging: drag.isDragging,
    getCurrentX: () => physics.getState().x,
  });

  // Start physics on mount and when chat closes
  useEffect(() => {
    if (physicsEnabled && !chatOpen) {
      physics.startPhysics();
    } else {
      physics.stopPhysics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physicsEnabled, chatOpen]);

  // Click handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    drag.startDrag(e, false);
  };

  const handleSupikiMouseDown = (e: React.MouseEvent) => {
    drag.startDrag(e, true);
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // Note: Click sounds are handled by Supiki component (eu.wav on press, ue.wav on release)

    if (drag.wasDragged) {
      drag.resetDragState();
      await physics.syncPosition();
      if (physicsEnabled) {
        physics.startPhysics();
      }
      return;
    }

    if (chatOpen) {
      await chatWindow.close();
      await physics.syncPosition();
      if (physicsEnabled) {
        physics.startPhysics();
      }
    } else {
      physics.stopPhysics();
      physics.stopWalking();
      await chatWindow.open();
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
        <Supiki
          animationState={supiki.animationState}
          direction={supiki.direction}
          onClick={handleClick}
          onMouseDown={handleSupikiMouseDown}
          onContextMenu={openContextMenu}
        />
      </div>
    </div>
  );
}

export default SupikiApp;
