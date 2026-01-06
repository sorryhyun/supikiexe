import { useState, useCallback, useRef, useEffect } from "react";
import type { Emotion } from "./emotions";

export type MascotState = "idle" | "walking" | "talking" | "jumping" | "falling";
export type Direction = "left" | "right";

interface MascotStateManager {
  state: MascotState;
  direction: Direction;
  emotion: Emotion;
  setState: (state: MascotState) => void;
  setDirection: (dir: Direction) => void;
  setEmotion: (emotion: Emotion, duration?: number) => void;
  triggerJump: () => void;
  triggerTalk: () => void;
  isGrounded: boolean;
  setGrounded: (grounded: boolean) => void;
}

export function useMascotState(): MascotStateManager {
  const [state, setStateInternal] = useState<MascotState>("idle");
  const [direction, setDirection] = useState<Direction>("right");
  const [emotion, setEmotionInternal] = useState<Emotion>("neutral");
  const [isGrounded, setGrounded] = useState(true);
  const stateTimeoutRef = useRef<number | null>(null);
  const emotionTimeoutRef = useRef<number | null>(null);

  const setState = useCallback((newState: MascotState) => {
    if (stateTimeoutRef.current) {
      clearTimeout(stateTimeoutRef.current);
      stateTimeoutRef.current = null;
    }
    setStateInternal(newState);
  }, []);

  const triggerJump = useCallback(() => {
    if (!isGrounded) return;
    setState("jumping");
    setGrounded(false);
  }, [isGrounded, setState]);

  const triggerTalk = useCallback(() => {
    setState("talking");
    stateTimeoutRef.current = window.setTimeout(() => {
      setStateInternal("idle");
    }, 2000);
  }, [setState]);

  const setEmotion = useCallback((newEmotion: Emotion, duration?: number) => {
    if (emotionTimeoutRef.current) {
      clearTimeout(emotionTimeoutRef.current);
      emotionTimeoutRef.current = null;
    }
    setEmotionInternal(newEmotion);

    // Auto-reset to neutral after duration (default 5 seconds)
    if (newEmotion !== "neutral") {
      const resetDuration = duration ?? 5000;
      emotionTimeoutRef.current = window.setTimeout(() => {
        setEmotionInternal("neutral");
      }, resetDuration);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (stateTimeoutRef.current) {
        clearTimeout(stateTimeoutRef.current);
      }
      if (emotionTimeoutRef.current) {
        clearTimeout(emotionTimeoutRef.current);
      }
    };
  }, []);

  return {
    state,
    direction,
    emotion,
    setState,
    setDirection,
    setEmotion,
    triggerJump,
    triggerTalk,
    isGrounded,
    setGrounded,
  };
}
