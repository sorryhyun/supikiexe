import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { HISTORY_LIST_WIDTH, HISTORY_LIST_HEIGHT } from "../constants";

function ContextMenuWindow() {
  // Close when losing focus (clicking outside)
  useEffect(() => {
    const win = getCurrentWindow();
    let blurTimeout: number | null = null;

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await win.close();
      }
    };

    // Close when window loses focus (with delay to allow click handlers to run first)
    const unlisten = win.onFocusChanged(async ({ payload: focused }) => {
      if (!focused) {
        // Small delay to allow button clicks to execute before closing
        blurTimeout = window.setTimeout(async () => {
          await win.close();
        }, 100);
      } else if (blurTimeout) {
        clearTimeout(blurTimeout);
        blurTimeout = null;
      }
    });

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (blurTimeout) clearTimeout(blurTimeout);
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleChatHistory = async () => {
    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const factor = await win.scaleFactor();

    // Close any existing history list window
    const existing = await WebviewWindow.getByLabel("historylist");
    if (existing) {
      await existing.close();
    }

    // Open the history list window near the context menu
    new WebviewWindow("historylist", {
      url: "index.html?historylist=true",
      title: "Chat History",
      width: HISTORY_LIST_WIDTH,
      height: HISTORY_LIST_HEIGHT,
      x: Math.round(pos.x / factor),
      y: Math.round(pos.y / factor - HISTORY_LIST_HEIGHT + 60),
      resizable: false,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      shadow: false,
      focus: true,
    });

    await win.close();
  };

  const handleExit = async () => {
    // Invoke quit first - app will exit before this returns
    invoke("quit_app");
  };

  return (
    <div className="context-menu-window">
      <button className="context-menu-item" onClick={handleChatHistory}>
        Chat History
      </button>
      <div className="context-menu-divider" />
      <button className="context-menu-item context-menu-item-exit" onClick={handleExit}>
        Bye
      </button>
    </div>
  );
}

export default ContextMenuWindow;
