import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo } from "@tauri-apps/api/event";
import { sessionStorage } from "../../services/sessionStorage";
import type { ChatSession } from "../../services/agentTypes";
import { useModalWindow } from "../../hooks/useModalWindow";
import { Modal } from "../modals/Modal";

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

  const handleClose = async () => {
    const win = getCurrentWindow();
    await win.close();
  };

  const { handleDragStart } = useModalWindow({
    onEscape: handleClose,
    closeOnBlur: true,
    blurDelay: 150,
    skipDragSelector: ".history-list-item",
  });

  const handleSelectSession = async (session: ChatSession) => {
    // Emit to main window to open this session
    await emitTo("main", "open-session", { sessionId: session.id });
    await handleClose();
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    sessionStorage.deleteSession(sessionId);
    setSessions(sessionStorage.getSessions());
  };

  return (
    <Modal
      title="Chat History"
      onClose={handleClose}
      className="history-list-window"
      onMouseDown={handleDragStart}
    >
      <div className="history-list-body">
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
    </Modal>
  );
}

export default ChatHistoryListWindow;
