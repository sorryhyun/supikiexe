import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ChatWindow from "./ChatWindow";
import "./styles/index.css";

// Check if this is the chat window
const urlParams = new URLSearchParams(window.location.search);
const isChatWindow = urlParams.get("chat") === "true";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isChatWindow ? <ChatWindow /> : <App />}
  </React.StrictMode>
);
