import { useEffect } from "react";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import type { Emotion } from "../emotions";
import { WINDOW_WIDTH } from "../constants";

export interface ClawdEventHandlers {
  onEmotionChange: (emotion: Emotion) => void;
  onWalkToWindow: (targetX: number) => void;
  onMove: (target: string, x: number | null) => void;
  onChatClosed: () => void;
  onChatMoved: (chatX: number, chatY: number) => void;
  onOpenChatHistory: () => void;
  onOpenSession: (sessionId: string) => void;
}

export interface ClawdEventDeps {
  chatOpen: boolean;
  isDragging: boolean;
  getCurrentX: () => number;
}

export function useClawdEvents(
  handlers: ClawdEventHandlers,
  deps: ClawdEventDeps
) {
  const { chatOpen, isDragging, getCurrentX } = deps;

  // Listen for emotion changes from chat window
  useEffect(() => {
    const unlisten = listen<Emotion>("emotion-change", (event) => {
      handlers.onEmotionChange(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handlers]);

  // Listen for walk-to-window events from sidecar
  useEffect(() => {
    const unlisten = listen<{ targetX: number; windowTitle: string }>(
      "walk-to-window",
      (event) => {
        if (chatOpen || isDragging) return;
        handlers.onWalkToWindow(event.payload.targetX);
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [chatOpen, isDragging, handlers]);

  // Listen for move events from sidecar
  useEffect(() => {
    const unlisten = listen<{ target: string; x: number | null }>(
      "clawd-move",
      async (event) => {
        const { target, x } = event.payload;
        if (chatOpen || isDragging) return;

        const monitor = await currentMonitor();
        const appWindow = getCurrentWindow();
        const scaleFactor = await appWindow.scaleFactor();

        if (!monitor) return;

        const screenWidth = monitor.size.width / scaleFactor;
        let targetX: number;

        switch (target) {
          case "left":
            targetX = monitor.position.x / scaleFactor;
            break;
          case "right":
            targetX = monitor.position.x / scaleFactor + screenWidth - WINDOW_WIDTH;
            break;
          case "center":
            targetX =
              monitor.position.x / scaleFactor + screenWidth / 2 - WINDOW_WIDTH / 2;
            break;
          case "coordinates":
            targetX = x ?? getCurrentX();
            break;
          default:
            return;
        }

        handlers.onMove(target, targetX);
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [chatOpen, isDragging, getCurrentX, handlers]);

  // Listen for chat window closed
  useEffect(() => {
    const unlisten = listen("chat-closed", () => {
      handlers.onChatClosed();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handlers]);

  // Listen for chat window moved
  useEffect(() => {
    const unlisten = listen("chat-window-moved", (event) => {
      const { chatX, chatY } = event.payload as { chatX: number; chatY: number };
      handlers.onChatMoved(chatX, chatY);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handlers]);

  // Listen for open-chat-history event from context menu
  useEffect(() => {
    const unlisten = listen("open-chat-history", () => {
      handlers.onOpenChatHistory();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handlers]);

  // Listen for open-session event from history list
  useEffect(() => {
    const unlisten = listen<{ sessionId: string }>("open-session", (event) => {
      handlers.onOpenSession(event.payload.sessionId);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handlers]);

  // Close context menu when main window gains focus
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onFocusChanged(async ({ payload: focused }) => {
      if (focused) {
        try {
          const existingMenu = await WebviewWindow.getByLabel("contextmenu");
          if (existingMenu) {
            await existingMenu.close();
          }
        } catch {
          // Context menu may already be closing
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
