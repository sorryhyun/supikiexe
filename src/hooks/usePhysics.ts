import { useRef, useCallback, useEffect, useMemo } from "react";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import {
  TASKBAR_HEIGHT,
  SCREEN_BOUNDS_UPDATE_INTERVAL,
  DEFAULT_PHYSICS_CONFIG,
  MIN_BOUNCE_VELOCITY,
  MIN_VELOCITY_THRESHOLD,
} from "../constants";

interface PhysicsState {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
}

interface ScreenBounds {
  width: number;
  height: number;
  left: number;
  top: number;
  taskbarHeight: number;
}

export interface PhysicsConfig {
  gravity: number;
  friction: number;
  bounceFactor: number;
  walkSpeed: number;
  jumpForce: number;
}

interface UsePhysicsOptions {
  windowWidth: number;
  windowHeight: number;
  onPositionUpdate: (x: number, y: number) => void;
  onGrounded: (grounded: boolean) => void;
  onEdgeHit: (edge: "left" | "right") => void;
  config?: Partial<PhysicsConfig>;
}

export function usePhysics({
  windowWidth,
  windowHeight,
  onPositionUpdate,
  onGrounded,
  onEdgeHit,
  config = {},
}: UsePhysicsOptions) {
  const physicsConfig = useMemo(
    () => ({ ...DEFAULT_PHYSICS_CONFIG, ...config }),
    [config]
  );
  const stateRef = useRef<PhysicsState>({
    x: 100,
    y: 100,
    velocityX: 0,
    velocityY: 0,
  });
  const screenBoundsRef = useRef<ScreenBounds | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const isWalkingRef = useRef(false);
  const walkDirectionRef = useRef<"left" | "right">("right");
  const walkTargetXRef = useRef<number | null>(null);
  const onReachTargetRef = useRef<(() => void) | null>(null);

  const updateScreenBounds = useCallback(async () => {
    try {
      const monitor = await currentMonitor();
      const appWindow = getCurrentWindow();
      const scaleFactor = await appWindow.scaleFactor();
      if (monitor) {
        // Convert physical pixels to logical pixels to match state coordinates
        screenBoundsRef.current = {
          width: monitor.size.width / scaleFactor,
          height: monitor.size.height / scaleFactor,
          left: monitor.position.x / scaleFactor,
          top: monitor.position.y / scaleFactor,
          taskbarHeight: TASKBAR_HEIGHT,
        };
      }
    } catch (e) {
      console.error("Failed to get monitor info:", e);
    }
  }, []);

  const setPosition = useCallback(async (x: number, y: number) => {
    try {
      const appWindow = getCurrentWindow();
      const factor = await appWindow.scaleFactor();
      const position = new PhysicalPosition(
        Math.round(x * factor),
        Math.round(y * factor)
      );
      await appWindow.setPosition(position);
    } catch (e) {
      console.error("Failed to set position:", e);
    }
  }, []);

  const applyForce = useCallback((forceX: number, forceY: number) => {
    stateRef.current.velocityX += forceX;
    stateRef.current.velocityY += forceY;
  }, []);

  const jump = useCallback(() => {
    if (stateRef.current.velocityY === 0) {
      stateRef.current.velocityY = physicsConfig.jumpForce;
      onGrounded(false);
    }
  }, [physicsConfig.jumpForce, onGrounded]);

  const startWalking = useCallback((direction: "left" | "right") => {
    isWalkingRef.current = true;
    walkDirectionRef.current = direction;
  }, []);

  const stopWalking = useCallback(() => {
    isWalkingRef.current = false;
    walkTargetXRef.current = null;
    onReachTargetRef.current = null;
  }, []);

  const walkToX = useCallback((targetX: number, onReach?: () => void) => {
    const currentX = stateRef.current.x;
    const direction = targetX > currentX ? "right" : "left";
    walkTargetXRef.current = targetX;
    onReachTargetRef.current = onReach || null;
    isWalkingRef.current = true;
    walkDirectionRef.current = direction;
  }, []);

  // Track frames for periodic bounds update
  const frameCountRef = useRef(0);

  const physicsStep = useCallback(async () => {
    // Update screen bounds periodically to handle monitor changes
    frameCountRef.current++;
    if (!screenBoundsRef.current || frameCountRef.current % SCREEN_BOUNDS_UPDATE_INTERVAL === 0) {
      await updateScreenBounds();
      if (!screenBoundsRef.current) return;
    }

    const bounds = screenBoundsRef.current;
    const state = stateRef.current;

    // Apply gravity
    state.velocityY += physicsConfig.gravity;

    // Apply walking velocity
    if (isWalkingRef.current) {
      const walkVel = walkDirectionRef.current === "right"
        ? physicsConfig.walkSpeed
        : -physicsConfig.walkSpeed;
      state.velocityX = walkVel;

      // Check if we reached the target position
      if (walkTargetXRef.current !== null) {
        const targetX = walkTargetXRef.current;
        const reachedTarget =
          (walkDirectionRef.current === "right" && state.x >= targetX) ||
          (walkDirectionRef.current === "left" && state.x <= targetX);

        if (reachedTarget) {
          isWalkingRef.current = false;
          state.velocityX = 0;
          const callback = onReachTargetRef.current;
          walkTargetXRef.current = null;
          onReachTargetRef.current = null;
          if (callback) callback();
        }
      }
    } else {
      // Apply friction when not walking
      state.velocityX *= physicsConfig.friction;
      if (Math.abs(state.velocityX) < MIN_VELOCITY_THRESHOLD) {
        state.velocityX = 0;
      }
    }

    // Update position
    state.x += state.velocityX;
    state.y += state.velocityY;

    // Floor collision (bottom of screen, accounting for monitor position and taskbar)
    const floorY = bounds.top + bounds.height - windowHeight - bounds.taskbarHeight;
    if (state.y >= floorY) {
      state.y = floorY;
      if (state.velocityY > 0) {
        if (state.velocityY > MIN_BOUNCE_VELOCITY) {
          state.velocityY = -state.velocityY * physicsConfig.bounceFactor;
        } else {
          state.velocityY = 0;
          onGrounded(true);
        }
      }
    }

    // Wall collisions (screen edges, accounting for monitor position)
    const leftEdge = bounds.left;
    const rightEdge = bounds.left + bounds.width - windowWidth;
    if (state.x <= leftEdge) {
      state.x = leftEdge;
      state.velocityX = Math.abs(state.velocityX) * physicsConfig.bounceFactor;
      onEdgeHit("left");
    } else if (state.x >= rightEdge) {
      state.x = rightEdge;
      state.velocityX = -Math.abs(state.velocityX) * physicsConfig.bounceFactor;
      onEdgeHit("right");
    }

    // Update window position
    await setPosition(state.x, state.y);
    onPositionUpdate(state.x, state.y);
  }, [
    physicsConfig,
    windowWidth,
    windowHeight,
    onPositionUpdate,
    onGrounded,
    onEdgeHit,
    setPosition,
    updateScreenBounds,
  ]);

  const startPhysics = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    const loop = async () => {
      if (!isRunningRef.current) return;
      await physicsStep();
      animationFrameRef.current = requestAnimationFrame(loop);
    };

    updateScreenBounds().then(() => {
      // Check again after async operation in case stopPhysics was called
      if (!isRunningRef.current) return;
      animationFrameRef.current = requestAnimationFrame(loop);
    });
  }, [physicsStep, updateScreenBounds]);

  const stopPhysics = useCallback(() => {
    isRunningRef.current = false;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const syncPosition = useCallback(async (resetVelocity = true) => {
    try {
      const appWindow = getCurrentWindow();
      const position = await appWindow.outerPosition();
      const factor = await appWindow.scaleFactor();
      stateRef.current.x = position.x / factor;
      stateRef.current.y = position.y / factor;
      if (resetVelocity) {
        stateRef.current.velocityX = 0;
        stateRef.current.velocityY = 0;
      }
    } catch (e) {
      console.error("Failed to sync position:", e);
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPhysics();
    };
  }, [stopPhysics]);

  return {
    startPhysics,
    stopPhysics,
    jump,
    applyForce,
    startWalking,
    stopWalking,
    walkToX,
    syncPosition,
    updateScreenBounds,
    getState: () => stateRef.current,
    getDirection: () => walkDirectionRef.current,
  };
}
