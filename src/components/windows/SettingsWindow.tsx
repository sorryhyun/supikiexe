import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  loadSettings,
  saveSettings,
  SUPPORTED_LANGUAGES,
  type Settings,
} from "../../services/settingsStorage";
import { useModalWindow } from "../../hooks/useModalWindow";
import { Modal } from "../modals/Modal";
import "../../styles/settings.css";

function SettingsWindow() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const handleClose = async () => {
    const win = getCurrentWindow();
    await win.close();
  };

  const { handleDragStart } = useModalWindow({
    onEscape: handleClose,
    closeOnBlur: true,
    blurDelay: 150,
  });

  const handleLanguageChange = (language: string) => {
    const newSettings = { ...settings, language };
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  return (
    <Modal
      title="Settings"
      onClose={handleClose}
      className="settings-window"
      onMouseDown={handleDragStart}
      footer={
        <span className="settings-hint">
          Language preference for Clawd responses
        </span>
      }
    >
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
    </Modal>
  );
}

export default SettingsWindow;
