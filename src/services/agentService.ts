import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentQueryCallbacks, Emotion, AgentQuestionEvent, AttachedImage } from "./agentTypes";
import { EMOTIONS } from "../emotion";
import { commands } from "../bindings";
import { getLanguage, getBackendMode } from "./settingsStorage";

// Emotion update callback type
type EmotionCallback = (emotion: Emotion, duration: number) => void;

// Question callback type
type QuestionCallback = (event: AgentQuestionEvent) => void;

export class AgentService {
  private listeners: UnlistenFn[] = [];
  private emotionCallbacks: EmotionCallback[] = [];
  private emotionListener: UnlistenFn | null = null;
  private questionCallbacks: QuestionCallback[] = [];
  private questionListener: UnlistenFn | null = null;

  constructor() {
    // Set up persistent event listeners
    this.setupEmotionListener();
    this.setupQuestionListener();
    // Sync backend mode from settings on startup
    this.syncBackendMode();
  }

  /**
   * Sync backend mode from local settings to Rust backend
   */
  private async syncBackendMode(): Promise<void> {
    const savedMode = getBackendMode();
    try {
      await commands.setBackendMode(savedMode);
      console.log("[AgentService] Backend mode synced:", savedMode);
    } catch (e) {
      console.error("[AgentService] Failed to sync backend mode:", e);
    }
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

  /**
   * Set up persistent listener for AskUserQuestion events from sidecar
   */
  private async setupQuestionListener(): Promise<void> {
    if (this.questionListener) return;

    this.questionListener = await listen<AgentQuestionEvent>(
      "agent-ask-question",
      (event) => {
        console.log("[AgentService] Question event:", event.payload);
        for (const callback of this.questionCallbacks) {
          callback(event.payload);
        }
      }
    );
  }

  async sendMessage(
    prompt: string,
    callbacks: AgentQueryCallbacks,
    images?: AttachedImage[]
  ): Promise<void> {
    console.log("[AgentService] Sending message:", prompt, "images:", images?.length || 0);
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
      // Convert images to base64 array for IPC
      const imageBase64s = images?.map((img) => img.base64) || [];
      const language = getLanguage();
      const result = await commands.sendAgentMessage(prompt, imageBase64s, language);
      if (result.status === "error") {
        throw new Error(result.error);
      }

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
    const result = await commands.clearAgentSession();
    if (result.status === "error") {
      throw new Error(result.error);
    }
  }

  async getSessionId(): Promise<string | null> {
    return await commands.getSessionId();
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
   * Register a callback for AskUserQuestion events
   */
  onQuestion(callback: QuestionCallback): () => void {
    this.questionCallbacks.push(callback);
    return () => {
      this.questionCallbacks = this.questionCallbacks.filter(
        (cb) => cb !== callback
      );
    };
  }

  /**
   * Answer an AskUserQuestion
   */
  async answerQuestion(
    questionId: string,
    questions: AgentQuestionEvent["questions"],
    answers: Record<string, string>
  ): Promise<void> {
    console.log("[AgentService] Answering question:", questionId, answers);
    const result = await commands.answerAgentQuestion(
      questionId,
      JSON.stringify(questions),
      answers
    );
    if (result.status === "error") {
      throw new Error(result.error);
    }
  }

  /**
   * Stop the sidecar process (call on app exit)
   */
  async stopSidecar(): Promise<void> {
    await commands.stopSidecar();
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
