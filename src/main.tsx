import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./components/App";
import SupikiApp from "./components/SupikiApp";
import ChatWindow from "./components/ChatWindow";
import ContextMenuWindow from "./components/ContextMenuWindow";
import ChatHistoryListWindow from "./components/ChatHistoryListWindow";
import SettingsWindow from "./components/SettingsWindow";
import { commands } from "./bindings";
import "./styles/index.css";

// Check window type from URL params
const urlParams = new URLSearchParams(window.location.search);
const isChatWindow = urlParams.get("chat") === "true";
const isContextMenu = urlParams.get("contextmenu") === "true";
const isHistoryList = urlParams.get("historylist") === "true";
const isSettings = urlParams.get("settings") === "true";

// Check mascot type from environment variable (for dev mode)
const envSupikiMode = import.meta.env.VITE_MASCOT_TYPE === "supiki";

function RootComponent() {
  const [supikiMode, setSupikiMode] = useState(envSupikiMode);
  const [loaded, setLoaded] = useState(envSupikiMode); // Skip loading if env var is set

  useEffect(() => {
    // Check Tauri command for supiki mode (exe name detection)
    if (!envSupikiMode) {
      commands
        .isSupikiMode()
        .then((result) => {
          setSupikiMode(result);
          setLoaded(true);
        })
        .catch(() => {
          setLoaded(true);
        });
    }
  }, []);

  if (isContextMenu) return <ContextMenuWindow />;
  if (isHistoryList) return <ChatHistoryListWindow />;
  if (isSettings) return <SettingsWindow />;
  if (isChatWindow) return <ChatWindow />;

  // Wait for supiki mode check before rendering mascot
  if (!loaded) return null;

  if (supikiMode) return <SupikiApp />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
