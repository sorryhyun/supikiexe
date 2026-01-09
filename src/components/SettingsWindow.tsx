import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  loadSettings,
  saveSettings,
  SUPPORTED_LANGUAGES,
  type Settings,
} from "../services/settingsStorage";
import "../styles/settings.css";

function SettingsWindow() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const userInitiatedDragRef = useRef(false);

  useEffect(() => {
    const win = getCurrentWindow();

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await win.close();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Hide settings window when it loses focus (clicking outside)
  // Use a delay to avoid hiding during drag operations
  useEffect(() => {
    const win = getCurrentWindow();
    let hideTimeout: number | null = null;

    const unlisten = win.onFocusChanged(async ({ payload: focused }) => {
      if (focused) {
        // Cancel any pending hide if we regain focus
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
      } else {
        // Delay hide to allow for drag operations
        hideTimeout = window.setTimeout(async () => {
          await win.close();
        }, 150);
      }
    });

    return () => {
      if (hideTimeout) clearTimeout(hideTimeout);
      unlisten.then((fn) => fn());
    };
  }, []);

  // Enable window dragging - exclude buttons
  const handleDragStart = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();

    // Don't drag if clicking on interactive elements
    if (tagName === "button") {
      return;
    }

    const win = getCurrentWindow();
    userInitiatedDragRef.current = true;
    await win.startDragging();
  };

  const handleLanguageChange = (language: string) => {
    const newSettings = { ...settings, language };
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleClose = async () => {
    const win = getCurrentWindow();
    await win.close();
  };

  return (
    <div className="settings-window" onMouseDown={handleDragStart}>
      <div className="settings-header" onMouseDown={handleDragStart}>
        <span>Settings</span>
        <button className="settings-close" onClick={handleClose}>
          x
        </button>
      </div>

      <div className="settings-body">
        <div className="settings-section">
          <label className="settings-label">Language</label>
          <div className="settings-language-list">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                className={`settings-language-item ${
                  settings.language === lang.code ? "selected" : ""
                }`}
                onClick={() => handleLanguageChange(lang.code)}
              >
                {lang.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-footer">
        <span className="settings-hint">
          Language preference for Clawd responses
        </span>
      </div>
    </div>
  );
}

export default SettingsWindow;
