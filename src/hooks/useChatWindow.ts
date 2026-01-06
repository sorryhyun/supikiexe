import { useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { CHAT_WIDTH, CHAT_HEIGHT, DEFAULT_CHAT_OFFSET } from "../constants";

export interface ChatWindowState {
  isOpen: boolean;
  open: () => Promise<void>;
  close: () => Promise<void>;
  toggle: () => Promise<void>;
  updatePosition: (x: number, y: number) => Promise<void>;
  updateOffset: (chatX: number, chatY: number) => Promise<void>;
  getWindowRef: () => WebviewWindow | null;
}

export function useChatWindow(
  onOpen?: () => void,
  onClose?: () => void
): ChatWindowState {
  const chatWindowRef = useRef<WebviewWindow | null>(null);
  const chatOpenRef = useRef(false);
  const chatOffsetRef = useRef({ ...DEFAULT_CHAT_OFFSET });

  const updatePosition = useCallback(async (x: number, y: number) => {
    if (chatOpenRef.current && chatWindowRef.current) {
      const appWindow = getCurrentWindow();
      const factor = await appWindow.scaleFactor();

      const chatX = x + chatOffsetRef.current.x;
      const chatY = y + chatOffsetRef.current.y;

      try {
        await chatWindowRef.current.setPosition(
          new PhysicalPosition(Math.round(chatX * factor), Math.round(chatY * factor))
        );
      } catch {
        // Chat window may have been closed
      }
    }
  }, []);

  const updateOffset = useCallback(async (chatX: number, chatY: number) => {
    const appWindow = getCurrentWindow();
    const position = await appWindow.outerPosition();
    const factor = await appWindow.scaleFactor();
    const clawdX = position.x / factor;
    const clawdY = position.y / factor;

    chatOffsetRef.current = {
      x: chatX - clawdX,
      y: chatY - clawdY,
    };
  }, []);

  const openWindow = useCallback(async () => {
    const appWindow = getCurrentWindow();
    const position = await appWindow.outerPosition();
    const factor = await appWindow.scaleFactor();

    const clawdX = position.x / factor;
    const clawdY = position.y / factor;

    const chatX = clawdX + chatOffsetRef.current.x;
    const chatY = clawdY + chatOffsetRef.current.y;

    // Try to get existing chat window first
    const existingWindow = await WebviewWindow.getByLabel("chat");

    if (existingWindow) {
      try {
        await existingWindow.setPosition(
          new PhysicalPosition(Math.round(chatX * factor), Math.round(chatY * factor))
        );
        await existingWindow.show();
        await existingWindow.setFocus();
        chatWindowRef.current = existingWindow;
        return;
      } catch {
        // Window is in bad state, will create new one
      }
    }

    try {
      const chatWindow = new WebviewWindow("chat", {
        url: "index.html?chat=true",
        title: "Chat",
        width: CHAT_WIDTH,
        height: CHAT_HEIGHT,
        x: Math.round(chatX),
        y: Math.round(chatY),
        resizable: false,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        shadow: false,
      });

      await new Promise<void>((resolve, reject) => {
        chatWindow.once("tauri://created", () => resolve());
        chatWindow.once("tauri://error", (e) => reject(e));
      });

      chatWindowRef.current = chatWindow;
    } catch (err) {
      console.error("[useChatWindow] Failed to create chat window:", err);
      chatOpenRef.current = false;
      onClose?.();
    }
  }, [onClose]);

  const open = useCallback(async () => {
    if (chatOpenRef.current) return;
    chatOpenRef.current = true;
    onOpen?.();
    await openWindow();
  }, [onOpen, openWindow]);

  const close = useCallback(async () => {
    if (!chatOpenRef.current) return;
    chatOpenRef.current = false;

    const existingWindow = await WebviewWindow.getByLabel("chat");
    if (existingWindow) {
      try {
        await existingWindow.hide();
      } catch {
        // Window may already be closed
      }
    }
    onClose?.();
  }, [onClose]);

  const toggle = useCallback(async () => {
    if (chatOpenRef.current) {
      await close();
    } else {
      await open();
    }
  }, [open, close]);

  const handleClosed = useCallback(() => {
    chatOpenRef.current = false;
    chatWindowRef.current = null;
    onClose?.();
  }, [onClose]);

  return {
    isOpen: chatOpenRef.current,
    open,
    close,
    toggle,
    updatePosition,
    updateOffset,
    getWindowRef: () => chatWindowRef.current,
    // Internal method for external close events
    _handleClosed: handleClosed,
  } as ChatWindowState & { _handleClosed: () => void };
}
