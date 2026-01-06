import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo } from "@tauri-apps/api/event";
import { sessionStorage } from "../services/sessionStorage";
import type { ChatSession } from "../services/agentTypes";

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (days === 1) {
    return "Yesterday";
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

function ChatHistoryListWindow() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  useEffect(() => {
    setSessions(sessionStorage.getSessions());
  }, []);

  // Handle Escape key and focus loss
  useEffect(() => {
    const win = getCurrentWindow();
    let hideTimeout: number | null = null;

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await win.close();
      }
    };

    // Close when window loses focus (clicking outside)
    const unlisten = win.onFocusChanged(async ({ payload: focused }) => {
      if (focused) {
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
      } else {
        // Delay to allow button clicks to execute
        hideTimeout = window.setTimeout(async () => {
          await win.close();
        }, 150);
      }
    });

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (hideTimeout) clearTimeout(hideTimeout);
      unlisten.then((fn) => fn());
    };
  }, []);

  // Enable window dragging
  const handleDragStart = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();

    // Don't drag if clicking on interactive elements or list items
    if (tagName === "button" || target.closest(".history-list-item")) {
      return;
    }

    const appWindow = getCurrentWindow();
    await appWindow.startDragging();
  };

  const handleSelectSession = async (session: ChatSession) => {
    // Emit to main window to open this session
    await emitTo("main", "open-session", { sessionId: session.id });
    const win = getCurrentWindow();
    await win.close();
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    sessionStorage.deleteSession(sessionId);
    setSessions(sessionStorage.getSessions());
  };

  const handleClose = async () => {
    const win = getCurrentWindow();
    await win.close();
  };

  return (
    <div className="history-list-window" onMouseDown={handleDragStart}>
      <div className="history-list-header" onMouseDown={handleDragStart}>
        <span className="history-list-title">Chat History</span>
        <button className="history-list-close" onClick={handleClose}>
          x
        </button>
      </div>
      <div className="history-list-body" onMouseDown={handleDragStart}>
        {sessions.length === 0 ? (
          <div className="history-list-empty">No chat history yet</div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className="history-list-item"
              onClick={() => handleSelectSession(session)}
            >
              <div className="history-list-item-content">
                <div className="history-list-item-title">{session.title}</div>
                <div className="history-list-item-meta">
                  <span>{session.messageCount} messages</span>
                  <span>{formatDate(session.updatedAt)}</span>
                </div>
              </div>
              <button
                className="history-list-item-delete"
                onClick={(e) => handleDeleteSession(e, session.id)}
                title="Delete"
              >
                x
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ChatHistoryListWindow;
