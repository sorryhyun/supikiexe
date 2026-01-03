import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentQueryCallbacks, Emotion } from "./agentTypes";
import { EMOTIONS } from "../emotions";

// Emotion update callback type
type EmotionCallback = (emotion: Emotion, duration: number) => void;

export class AgentService {
  private listeners: UnlistenFn[] = [];
  private emotionPollInterval: number | null = null;
  private emotionCallbacks: EmotionCallback[] = [];

  async sendMessage(
    prompt: string,
    callbacks: AgentQueryCallbacks
  ): Promise<void> {
    console.log("[AgentService] Sending message:", prompt);
    callbacks.onStreamStart();

    // Clean up any previous listeners
    await this.cleanup();

    try {
      // Set up event listeners for streaming
      const streamListener = await listen<string>("claude-stream", (event) => {
        console.log("[AgentService] Stream event:", event.payload);
        callbacks.onPartialMessage(event.payload);
      });
      this.listeners.push(streamListener);

      const resultListener = await listen<{ subtype: string; result: string }>(
        "claude-result",
        (event) => {
          console.log("[AgentService] Result event:", event.payload);
          const { result } = event.payload;
          callbacks.onComplete(result, {
            costUsd: 0,
            sessionId: "",
          });
        }
      );
      this.listeners.push(resultListener);

      const errorListener = await listen<string>("claude-error", (event) => {
        console.error("[AgentService] Error event:", event.payload);
        callbacks.onError(new Error(event.payload));
      });
      this.listeners.push(errorListener);

      // Listen to raw output for debugging
      const rawListener = await listen<string>("claude-raw", (event) => {
        console.log("[AgentService] Raw CLI output:", event.payload);
      });
      this.listeners.push(rawListener);

      console.log("[AgentService] Invoking send_claude_message...");
      // Invoke the Rust command
      const result = await invoke<string>("send_claude_message", {
        message: prompt,
      });

      console.log("[AgentService] Invoke returned:", result);
      // If we got a direct result (no streaming events), use it
      if (result) {
        callbacks.onComplete(result, {
          costUsd: 0,
          sessionId: await this.getSessionId() || "",
        });
      }
    } catch (error) {
      console.error("[AgentService] Invoke error:", error);
      callbacks.onError(
        error instanceof Error ? error : new Error(String(error))
      );
    } finally {
      await this.cleanup();
    }
  }

  private async cleanup(): Promise<void> {
    for (const unlisten of this.listeners) {
      unlisten();
    }
    this.listeners = [];
  }

  async interrupt(): Promise<void> {
    // Note: Interrupting a spawned process requires more complex handling
    // For now, we just clean up listeners
    await this.cleanup();
  }

  async clearSession(): Promise<void> {
    await invoke("clear_claude_session");
  }

  async getSessionId(): Promise<string | null> {
    return await invoke<string | null>("get_session_id");
  }

  /**
   * Register a callback for MCP emotion updates
   */
  onEmotionUpdate(callback: EmotionCallback): () => void {
    this.emotionCallbacks.push(callback);
    return () => {
      this.emotionCallbacks = this.emotionCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Start polling for emotion updates from the MCP server
   */
  startEmotionPolling(): void {
    if (this.emotionPollInterval) return;

    // Reset emotion tracking when starting
    invoke("reset_emotion_tracking").catch(console.error);

    this.emotionPollInterval = window.setInterval(async () => {
      try {
        const result = await invoke<{
          emotion: string;
          duration: number;
          timestamp: number;
        } | null>("check_emotion_update");

        if (result && EMOTIONS.includes(result.emotion as Emotion)) {
          console.log("[AgentService] MCP emotion update:", result);
          for (const callback of this.emotionCallbacks) {
            callback(result.emotion as Emotion, result.duration);
          }
        }
      } catch (e) {
        // Silently ignore polling errors
      }
    }, 200); // Poll every 200ms
  }

  /**
   * Stop polling for emotion updates
   */
  stopEmotionPolling(): void {
    if (this.emotionPollInterval) {
      clearInterval(this.emotionPollInterval);
      this.emotionPollInterval = null;
    }
  }
}

// Singleton instance
let agentServiceInstance: AgentService | null = null;

export function getAgentService(): AgentService {
  if (!agentServiceInstance) {
    agentServiceInstance = new AgentService();
  }
  return agentServiceInstance;
}
