import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentQueryCallbacks, Emotion } from "./agentTypes";
import { EMOTIONS } from "../emotions";

// Emotion update callback type
type EmotionCallback = (emotion: Emotion, duration: number) => void;

export class AgentService {
  private listeners: UnlistenFn[] = [];
  private emotionCallbacks: EmotionCallback[] = [];
  private emotionListener: UnlistenFn | null = null;

  constructor() {
    // Set up emotion event listener once
    this.setupEmotionListener();
  }

  /**
   * Set up persistent listener for emotion events from sidecar
   * No more polling - emotions come directly through events!
   */
  private async setupEmotionListener(): Promise<void> {
    if (this.emotionListener) return;

    this.emotionListener = await listen<{
      type: string;
      emotion: string;
      duration: number;
    }>("agent-emotion", (event) => {
      const { emotion, duration } = event.payload;
      console.log("[AgentService] Emotion event:", emotion, duration);

      if (EMOTIONS.includes(emotion as Emotion)) {
        for (const callback of this.emotionCallbacks) {
          callback(emotion as Emotion, duration);
        }
      }
    });
  }

  async sendMessage(
    prompt: string,
    callbacks: AgentQueryCallbacks
  ): Promise<void> {
    console.log("[AgentService] Sending message:", prompt);
    callbacks.onStreamStart();

    // Clean up any previous query listeners
    await this.cleanupQueryListeners();

    try {
      // Set up event listeners for streaming
      const streamListener = await listen<string>("agent-stream", (event) => {
        console.log("[AgentService] Stream event:", event.payload);
        callbacks.onPartialMessage(event.payload);
      });
      this.listeners.push(streamListener);

      const resultListener = await listen<{
        sessionId: string;
        success: boolean;
        text: string;
      }>("agent-result", (event) => {
        console.log("[AgentService] Result event:", event.payload);
        const { text, sessionId } = event.payload;
        callbacks.onComplete(text, {
          costUsd: 0,
          sessionId: sessionId || "",
        });
      });
      this.listeners.push(resultListener);

      const errorListener = await listen<{ error: string }>(
        "agent-error",
        (event) => {
          console.error("[AgentService] Error event:", event.payload);
          callbacks.onError(new Error(event.payload.error));
        }
      );
      this.listeners.push(errorListener);

      // Listen to raw output for debugging
      const rawListener = await listen<string>("agent-raw", (event) => {
        console.log("[AgentService] Raw output:", event.payload);
      });
      this.listeners.push(rawListener);

      console.log("[AgentService] Invoking send_agent_message...");
      // Invoke the Rust command (now async, returns immediately)
      await invoke("send_agent_message", {
        message: prompt,
      });

      console.log("[AgentService] Message sent to sidecar");
    } catch (error) {
      console.error("[AgentService] Invoke error:", error);
      callbacks.onError(
        error instanceof Error ? error : new Error(String(error))
      );
      await this.cleanupQueryListeners();
    }
  }

  private async cleanupQueryListeners(): Promise<void> {
    for (const unlisten of this.listeners) {
      unlisten();
    }
    this.listeners = [];
  }

  async interrupt(): Promise<void> {
    // Clean up listeners - sidecar will handle query cancellation
    await this.cleanupQueryListeners();
  }

  async clearSession(): Promise<void> {
    await invoke("clear_agent_session");
  }

  async getSessionId(): Promise<string | null> {
    return await invoke<string | null>("get_session_id");
  }

  /**
   * Register a callback for emotion updates
   */
  onEmotionUpdate(callback: EmotionCallback): () => void {
    this.emotionCallbacks.push(callback);
    return () => {
      this.emotionCallbacks = this.emotionCallbacks.filter(
        (cb) => cb !== callback
      );
    };
  }

  /**
   * Stop the sidecar process (call on app exit)
   */
  async stopSidecar(): Promise<void> {
    await invoke("stop_sidecar");
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
