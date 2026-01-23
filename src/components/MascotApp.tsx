import { useEffect, useState, useCallback, useMemo, ReactNode } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAnimationState, AnimationState, Direction } from "../hooks/useMascotState";
import { usePhysics } from "../hooks/usePhysics";
import { useChatWindow } from "../hooks/useChatWindow";
import { useDrag } from "../hooks/useDrag";
import { useAutoWalk } from "../hooks/useAutoWalk";
import { useMascotEvents } from "../hooks/useMascotEvents";
import { useContextMenu } from "../hooks/useContextMenu";
import { WINDOW_WIDTH, WINDOW_HEIGHT, CHAT_WIDTH, CHAT_HEIGHT } from "../constants";
import type { Emotion } from "../emotion";

export interface MascotRenderProps {
  animationState: AnimationState;
  direction: Direction;
  emotion: Emotion;
  onClick: (e: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

interface MascotAppProps {
  renderMascot: (props: MascotRenderProps) => ReactNode;
  onEmotionChange?: (emotion: Emotion) => void;
}

export function MascotApp({ renderMascot, onEmotionChange }: MascotAppProps) {
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  const mascot = useAnimationState();
  const { openContextMenu, closeContextMenu } = useContextMenu();

  // Notify parent of emotion changes
  useEffect(() => {
    onEmotionChange?.(mascot.emotion);
  }, [mascot.emotion, onEmotionChange]);

  // Chat window management
  const chatWindow = useChatWindow(
    () => {
      // onOpen
      setChatOpen(true);
      mascot.setAnimationState("talking");
    },
    () => {
      // onClose
      setChatOpen(false);
      mascot.setAnimationState("idle");
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
      mascot.setGrounded(grounded);
      if (grounded && mascot.animationState === "jumping") {
        mascot.setAnimationState("idle");
      }
      if (!grounded && mascot.animationState !== "jumping") {
        mascot.setAnimationState("falling");
      }
    },
    [mascot]
  );

  const handleEdgeHit = useCallback(
    (edge: "left" | "right") => {
      mascot.setDirection(edge === "left" ? "right" : "left");
    },
    [mascot]
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
    canWalk: () => !drag.isDragging && mascot.animationState === "idle" && mascot.isGrounded,
    onStartWalk: (direction) => {
      mascot.setDirection(direction);
      mascot.setAnimationState("walking");
      physics.startWalking(direction);
    },
    onStopWalk: () => {
      physics.stopWalking();
      mascot.setAnimationState("idle");
    },
  });

  const drag = useDrag({
    onDragStart: () => {
      closeContextMenu();
      physics.stopPhysics();
      physics.stopWalking();
      stopAutoWalk();
      mascot.setAnimationState("idle");
    },
    onDragEnd: async () => {
      await physics.syncPosition();
      if (physicsEnabled && !chatOpen) {
        physics.startPhysics();
      }
    },
  });

  // Event handlers for mascot events
  const eventHandlers = useMemo(
    () => ({
      onEmotionChange: (emotion: Parameters<typeof mascot.setEmotion>[0]) => {
        mascot.setEmotion(emotion);
      },
      onWalkToWindow: (targetX: number) => {
        const currentX = physics.getState().x;
        const direction = targetX > currentX ? "right" : "left";
        mascot.setDirection(direction);
        mascot.setAnimationState("walking");
        physics.walkToX(targetX, () => {
          mascot.setAnimationState("idle");
          mascot.setDirection(physics.getDirection());
          mascot.setEmotion("curious", 5000);
        });
      },
      onMove: (_target: string, targetX: number | null) => {
        if (targetX === null) return;
        const currentX = physics.getState().x;
        const direction = targetX > currentX ? "right" : "left";
        mascot.setDirection(direction);
        mascot.setAnimationState("walking");
        physics.walkToX(targetX, () => {
          mascot.setAnimationState("idle");
          mascot.setDirection(physics.getDirection());
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
        const mascotX = position.x / factor;
        const mascotY = position.y / factor;

        // Open session viewer window
        new WebviewWindow("session-viewer", {
          url: `index.html?chat=true&viewSession=${sessionId}`,
          title: "Chat History",
          width: CHAT_WIDTH,
          height: CHAT_HEIGHT,
          x: Math.round(mascotX + WINDOW_WIDTH - 5),
          y: Math.round(mascotY - CHAT_HEIGHT + WINDOW_HEIGHT - 20),
          resizable: false,
          decorations: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          shadow: false,
        });
      },
    }),
    [mascot, physics, chatWindow, physicsEnabled]
  );

  useMascotEvents(eventHandlers, {
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
    // Note: physics methods are stable (useCallback), so we don't need physics in deps
    // Adding physics to deps would cause the effect to re-run on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physicsEnabled, chatOpen]);

  // Click handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    drag.startDrag(e, false);
  };

  const handleMascotMouseDown = (e: React.MouseEvent) => {
    drag.startDrag(e, true);
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

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
      <div className="mascot-wrapper">
        {renderMascot({
          animationState: mascot.animationState,
          direction: mascot.direction,
          emotion: mascot.emotion,
          onClick: handleClick,
          onMouseDown: handleMascotMouseDown,
          onContextMenu: openContextMenu,
        })}
      </div>
    </div>
  );
}

export default MascotApp;
