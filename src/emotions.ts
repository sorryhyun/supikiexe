/**
 * Emotion types for Clawd - separate from physical states (walking, jumping, etc.)
 * These control the facial expression/appearance of the mascot.
 */
export type Emotion =
  | "neutral"
  | "happy"
  | "sad"
  | "excited"
  | "thinking"
  | "confused"
  | "surprised"
  | "curious";

export const EMOTIONS: Emotion[] = [
  "neutral",
  "happy",
  "sad",
  "excited",
  "thinking",
  "confused",
  "surprised",
  "curious"
];

/**
 * Eye configuration for each emotion
 */
export interface EyeConfig {
  leftEye: {
    y: number;
    height: number;
    width?: number;
    offsetX?: number;
  };
  rightEye: {
    y: number;
    height: number;
    width?: number;
    offsetX?: number;
  };
  eyebrows?: {
    left: { x1: number; y1: number; x2: number; y2: number };
    right: { x1: number; y1: number; x2: number; y2: number };
  };
  pupils?: {
    offsetY?: number;
    offsetX?: number;
  };
}

/**
 * Visual configuration for each emotion
 */
export const EMOTION_CONFIG: Record<Emotion, EyeConfig> = {
  neutral: {
    leftEye: { y: 4, height: 2 },
    rightEye: { y: 4, height: 2 },
  },
  happy: {
    // Eyes slightly squinted (happy/smiling)
    leftEye: { y: 4.5, height: 1.5 },
    rightEye: { y: 4.5, height: 1.5 },
  },
  sad: {
    // Eyes droopy, raised eyebrows
    leftEye: { y: 4, height: 2 },
    rightEye: { y: 4, height: 2 },
    eyebrows: {
      left: { x1: 3, y1: 2.5, x2: 6, y2: 3.5 },
      right: { x1: 16, y1: 3.5, x2: 19, y2: 2.5 },
    },
  },
  excited: {
    // Wide eyes!
    leftEye: { y: 3.5, height: 3 },
    rightEye: { y: 3.5, height: 3 },
  },
  thinking: {
    // One eye squinted, looking up
    leftEye: { y: 4.5, height: 1.5 },
    rightEye: { y: 4, height: 2 },
    pupils: { offsetY: -0.5 },
  },
  confused: {
    // Asymmetric eyes
    leftEye: { y: 4, height: 2.5 },
    rightEye: { y: 4.5, height: 1.5 },
    eyebrows: {
      left: { x1: 3, y1: 3, x2: 6, y2: 2 },
      right: { x1: 16, y1: 2, x2: 19, y2: 3 },
    },
  },
  surprised: {
    // Very wide eyes
    leftEye: { y: 3, height: 4, width: 3 },
    rightEye: { y: 3, height: 4, width: 3 },
  },
  curious: {
    // Same as neutral - no eye changes
    leftEye: { y: 4, height: 2 },
    rightEye: { y: 4, height: 2 },
  },
};
