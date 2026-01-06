import React from "react";
import ReactDOM from "react-dom/client";
import App from "./components/App";
import ChatWindow from "./components/ChatWindow";
import ContextMenuWindow from "./components/ContextMenuWindow";
import ChatHistoryListWindow from "./components/ChatHistoryListWindow";
import "./styles/index.css";

// Check window type from URL params
const urlParams = new URLSearchParams(window.location.search);
const isChatWindow = urlParams.get("chat") === "true";
const isContextMenu = urlParams.get("contextmenu") === "true";
const isHistoryList = urlParams.get("historylist") === "true";

function RootComponent() {
  if (isContextMenu) return <ContextMenuWindow />;
  if (isHistoryList) return <ChatHistoryListWindow />;
  if (isChatWindow) return <ChatWindow />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
