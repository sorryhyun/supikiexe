import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Valid emotions
export const VALID_EMOTIONS = ["neutral", "happy", "sad", "excited", "thinking", "confused", "surprised", "curious"];

/**
 * Set Clawd's emotional expression
 * @param {Function} emit - Function to emit events to Rust
 */
export function createEmotionTool(emit) {
  return tool(
    "set_emotion",
    "Set Clawd's emotional expression. Use this to show how you're feeling! Call this tool to change your visible emotion during the conversation.",
    {
      emotion: z.enum(VALID_EMOTIONS).describe(
        "The emotion to display: neutral (default), happy (when pleased), sad (when apologizing or delivering bad news), excited (when celebrating success), thinking (when processing), confused (when uncertain), surprised (when something unexpected happens), curious (when interested or intrigued by something)"
      ),
      duration: z.number().optional().default(5000).describe(
        "How long to show this emotion in milliseconds (default: 5000). After this duration, emotion returns to neutral."
      ),
    },
    async ({ emotion, duration }) => {
      emit({ type: "emotion", emotion, duration: duration || 5000 });
      return {
        content: [{ type: "text", text: `Emotion set to: ${emotion} for ${duration || 5000}ms` }],
      };
    }
  );
}
