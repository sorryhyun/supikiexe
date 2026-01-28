import { useEffect, useState, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import supikiImage from "../resources/supiki.webp";
import { usePhysics } from "../hooks/usePhysics";
import {
  MINI_WINDOW_WIDTH,
  MINI_WINDOW_HEIGHT,
  MINI_AUTO_WALK_MIN_DELAY,
  MINI_AUTO_WALK_MAX_DELAY,
  MINI_WALK_DURATION,
  MINI_AUTO_WALK_CHANCE,
} from "../constants";

interface MiniSupikiAppProps {
  id: string;
}

type MiniMascotState = "idle" | "walking" | "falling";

function MiniSupikiApp({ id }: MiniSupikiAppProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [mascotState, setMascotState] = useState<MiniMascotState>("falling");
  const [facingDirection, setFacingDirection] = useState<"left" | "right">("right");
  const walkTimeoutRef = useRef<number | null>(null);

  const handleGrounded = useCallback((grounded: boolean) => {
    if (grounded) {
      setMascotState((prev) => (prev === "falling" ? "idle" : prev));
    }
  }, []);

  const handleEdgeHit = useCallback((edge: "left" | "right") => {
    setFacingDirection(edge === "left" ? "right" : "left");
    setMascotState("idle");
  }, []);

  // Physics for movement and standing on taskbar
  const physics = usePhysics({
    windowWidth: MINI_WINDOW_WIDTH,
    windowHeight: MINI_WINDOW_HEIGHT,
    onPositionUpdate: () => {},
    onGrounded: handleGrounded,
    onEdgeHit: handleEdgeHit,
    config: {
      walkSpeed: 1.5, // Slightly slower for mini mascot
    },
  });

  // Auto-walk scheduler for mini mascots (more frequent than main)
  useEffect(() => {
    if (mascotState !== "idle") return;

    const delay =
      MINI_AUTO_WALK_MIN_DELAY +
      Math.random() * (MINI_AUTO_WALK_MAX_DELAY - MINI_AUTO_WALK_MIN_DELAY);

    const timeoutId = window.setTimeout(() => {
      if (Math.random() < MINI_AUTO_WALK_CHANCE) {
        const direction = Math.random() > 0.5 ? "right" : "left";
        setFacingDirection(direction);
        setMascotState("walking");
        physics.startWalking(direction);

        walkTimeoutRef.current = window.setTimeout(() => {
          physics.stopWalking();
          setMascotState("idle");
        }, MINI_WALK_DURATION);
      }
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
      if (walkTimeoutRef.current) {
        window.clearTimeout(walkTimeoutRef.current);
      }
    };
  }, [mascotState, physics]);

  // Pop-in animation and start physics
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
      physics.startPhysics();
    }, 50);

    return () => {
      clearTimeout(timer);
      physics.stopPhysics();
    };
  }, [physics]);

  // Listen for close event from main window
  useEffect(() => {
    const currentWindow = getCurrentWindow();

    const unlisten = listen("close-mini-mascot", async (event) => {
      const payload = event.payload as { id?: string };
      if (!payload.id || payload.id === id) {
        if (walkTimeoutRef.current) {
          window.clearTimeout(walkTimeoutRef.current);
        }
        physics.stopPhysics();
        await currentWindow.close();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [id, physics]);

  return (
    <div
      className="mini-mascot-container"
      style={{
        width: `${MINI_WINDOW_WIDTH}px`,
        height: `${MINI_WINDOW_HEIGHT}px`,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        transform: `scale(${isVisible ? 1 : 0})`,
        transition: isVisible
          ? "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
          : "none",
        transformOrigin: "center bottom",
      }}
    >
      <img
        src={supikiImage}
        alt="Mini Supiki"
        style={{
          maxWidth: "70px",
          maxHeight: "60px",
          width: "auto",
          height: "auto",
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))",
          transform: facingDirection === "left" ? "scaleX(-1)" : "scaleX(1)",
          transition: "transform 0.1s ease-out",
        }}
        draggable={false}
      />
    </div>
  );
}

export default MiniSupikiApp;
