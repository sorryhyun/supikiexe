import type { Emotion } from "../emotions";
import type { EmotionContext } from "./agentTypes";

// Keywords/patterns that suggest different emotions
const EMOTION_PATTERNS = {
  excited: [
    /done|complete|success|finished|fixed|solved/i,
    /great|awesome|perfect|excellent|amazing/i,
    /!\s*$/,
    /🎉|✨|🚀/,
  ],
  happy: [
    /happy|glad|pleased|delighted/i,
    /sure|of course|absolutely|definitely/i,
    /you're welcome|no problem|happy to help/i,
  ],
  sad: [
    /sorry|unfortunately|apologize|regret/i,
    /can't|cannot|unable|impossible/i,
    /failed|error|problem|issue/i,
  ],
  confused: [
    /\?{2,}/,
    /not sure|unclear|confused|don't understand/i,
    /could you clarify|what do you mean/i,
    /ambiguous|uncertain/i,
  ],
  thinking: [
    /let me|analyzing|looking|searching|checking/i,
    /hmm|well|interesting|consider/i,
    /thinking|pondering|evaluating/i,
  ],
  surprised: [
    /wow|whoa|oh|unexpected/i,
    /didn't expect|surprising|remarkable/i,
  ],
};

/**
 * Detect the appropriate emotion based on agent context
 */
export function detectEmotion(context: EmotionContext): Emotion {
  const { content, isToolRunning, hasError } = context;

  // Error state - show sadness
  if (hasError) {
    return "sad";
  }

  // Tool is actively running - show thinking
  if (isToolRunning) {
    return "thinking";
  }

  // Check patterns in priority order
  for (const pattern of EMOTION_PATTERNS.excited) {
    if (pattern.test(content)) {
      return "excited";
    }
  }

  for (const pattern of EMOTION_PATTERNS.surprised) {
    if (pattern.test(content)) {
      return "surprised";
    }
  }

  for (const pattern of EMOTION_PATTERNS.sad) {
    if (pattern.test(content)) {
      return "sad";
    }
  }

  for (const pattern of EMOTION_PATTERNS.confused) {
    if (pattern.test(content)) {
      return "confused";
    }
  }

  for (const pattern of EMOTION_PATTERNS.thinking) {
    if (pattern.test(content)) {
      return "thinking";
    }
  }

  for (const pattern of EMOTION_PATTERNS.happy) {
    if (pattern.test(content)) {
      return "happy";
    }
  }

  // Default to neutral
  return "neutral";
}

/**
 * Determine how long to maintain the emotional state (in ms)
 */
export function getEmotionDuration(emotion: Emotion): number {
  switch (emotion) {
    case "excited":
      return 3000;
    case "surprised":
      return 2000;
    case "sad":
      return 4000;
    case "confused":
      return 3000;
    case "thinking":
      return 5000;
    case "happy":
      return 3000;
    default:
      return 0;
  }
}
