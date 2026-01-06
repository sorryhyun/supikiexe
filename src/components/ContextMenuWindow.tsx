import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

function ContextMenuWindow() {
  // Close when losing focus (clicking outside)
  useEffect(() => {
    const win = getCurrentWindow();

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await win.close();
      }
    };

    // Close when window loses focus
    const unlisten = win.onFocusChanged(async ({ payload: focused }) => {
      if (!focused) {
        await win.close();
      }
    });

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleChatHistory = async () => {
    await emit("open-chat-history");
    const win = getCurrentWindow();
    await win.close();
  };

  const handleExit = async () => {
    const win = getCurrentWindow();
    await win.close();
    await invoke("quit_app");
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
