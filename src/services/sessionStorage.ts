import type { ChatSession, AgentChatMessage } from "./agentTypes";
import { generateId } from "../utils/id";

const SESSIONS_KEY = "clawd-sessions";
const CURRENT_SESSION_KEY = "clawd-current-session";
const MAX_SESSIONS = 50;

class SessionStorage {
  private sessions: ChatSession[] = [];
  private currentSessionId: string | null = null;
  private loaded = false;

  private load(): void {
    if (this.loaded) return;

    try {
      const stored = localStorage.getItem(SESSIONS_KEY);
      if (stored) {
        this.sessions = JSON.parse(stored);
      }
      this.currentSessionId = localStorage.getItem(CURRENT_SESSION_KEY);
    } catch (e) {
      console.error("Failed to load sessions:", e);
      this.sessions = [];
    }
    this.loaded = true;
  }

  private save(): void {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(this.sessions));
      if (this.currentSessionId) {
        localStorage.setItem(CURRENT_SESSION_KEY, this.currentSessionId);
      }
    } catch (e) {
      console.error("Failed to save sessions:", e);
    }
  }

  getSessions(): ChatSession[] {
    this.load();
    return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(id: string): ChatSession | undefined {
    this.load();
    return this.sessions.find((s) => s.id === id);
  }

  getCurrentSessionId(): string | null {
    this.load();
    return this.currentSessionId;
  }

  createSession(): ChatSession {
    this.load();

    const session: ChatSession = {
      id: generateId("session"),
      title: "New Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      messageCount: 0,
    };

    this.sessions.unshift(session);
    this.currentSessionId = session.id;

    // Trim old sessions
    if (this.sessions.length > MAX_SESSIONS) {
      this.sessions = this.sessions.slice(0, MAX_SESSIONS);
    }

    this.save();
    return session;
  }

  updateSession(id: string, messages: AgentChatMessage[], sessionId?: string): void {
    this.load();

    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;

    session.messages = messages;
    session.messageCount = messages.length;
    session.updatedAt = Date.now();

    if (sessionId) {
      session.sessionId = sessionId;
    }

    // Update title from first user message
    const firstUserMsg = messages.find((m) => m.sender === "user");
    if (firstUserMsg) {
      session.title = firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? "..." : "");
    }

    this.save();
  }

  deleteSession(id: string): void {
    this.load();
    this.sessions = this.sessions.filter((s) => s.id !== id);

    if (this.currentSessionId === id) {
      this.currentSessionId = null;
    }

    this.save();
  }

  clearAll(): void {
    this.sessions = [];
    this.currentSessionId = null;
    localStorage.removeItem(SESSIONS_KEY);
    localStorage.removeItem(CURRENT_SESSION_KEY);
    // Also clear legacy storage
    localStorage.removeItem("clawd-chat-history");
  }
}

export const sessionStorage = new SessionStorage();
