import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  HISTORY_LIST_WIDTH,
  HISTORY_LIST_HEIGHT,
  SETTINGS_WINDOW_WIDTH,
  SETTINGS_WINDOW_HEIGHT,
} from "../constants";
import { commands } from "../bindings";
import { useModalWindow } from "../hooks/useModalWindow";
import { openFloatingWindow } from "../utils/windowManager";

function ContextMenuWindow() {
  const handleClose = async () => {
    const win = getCurrentWindow();
    await win.close();
  };

  // Use modal window hook for escape key and blur handling
  useModalWindow({
    onEscape: handleClose,
    closeOnBlur: true,
    blurDelay: 100,
  });

  const handleChatHistory = async () => {
    await openFloatingWindow({
      label: "historylist",
      url: "index.html?historylist=true",
      title: "Chat History",
      width: HISTORY_LIST_WIDTH,
      height: HISTORY_LIST_HEIGHT,
      offsetY: -HISTORY_LIST_HEIGHT + 60,
    });
  };

  const handleSettings = async () => {
    await openFloatingWindow({
      label: "settings",
      url: "index.html?settings=true",
      title: "Settings",
      width: SETTINGS_WINDOW_WIDTH,
      height: SETTINGS_WINDOW_HEIGHT,
      offsetY: -SETTINGS_WINDOW_HEIGHT + 80,
    });
  };

  const handleExit = async () => {
    // Invoke quit first - app will exit before this returns
    commands.quitApp();
  };

  return (
    <div className="context-menu-window">
      <button className="context-menu-item" onClick={handleChatHistory}>
        Chat History
      </button>
      <button className="context-menu-item" onClick={handleSettings}>
        Settings
      </button>
      <div className="context-menu-divider" />
      <button className="context-menu-item context-menu-item-exit" onClick={handleExit}>
        Bye
      </button>
    </div>
  );
}

export default ContextMenuWindow;
