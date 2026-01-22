import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  loadSettings,
  saveSettings,
  SUPPORTED_LANGUAGES,
  type Settings,
  type BackendMode,
} from "../../services/settingsStorage";
import { commands } from "../../bindings";
import { useModalWindow } from "../../hooks/useModalWindow";
import { Modal } from "../modals/Modal";
import "../../styles/settings.css";

function SettingsWindow() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [claudeAvailable, setClaudeAvailable] = useState<boolean | null>(null);
  const [codexAvailable, setCodexAvailable] = useState<boolean | null>(null);

  // Check CLI availability on mount
  useEffect(() => {
    commands.checkClaudeCli().then((result) => {
      setClaudeAvailable(result.status === "ok");
    });
    commands.checkCodexCli().then((result) => {
      setCodexAvailable(result.status === "ok");
    });

    // Sync backend mode with Rust state on mount
    commands.getBackendMode().then((mode) => {
      setSettings((currentSettings) => {
        if (mode !== currentSettings.backendMode) {
          const newSettings = { ...currentSettings, backendMode: mode as BackendMode };
          saveSettings(newSettings);
          return newSettings;
        }
        return currentSettings;
      });
    });
  }, []);

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

  const handleBackendChange = async (mode: BackendMode) => {
    // Update Rust backend state
    const result = await commands.setBackendMode(mode);
    if (result.status === "ok") {
      // Clear current session when switching backends
      await commands.clearAgentSession();

      // Update local state
      const newSettings = { ...settings, backendMode: mode };
      setSettings(newSettings);
      saveSettings(newSettings);
    }
  };

  return (
    <Modal
      title="Settings"
      onClose={handleClose}
      className="settings-window"
      onMouseDown={handleDragStart}
      footer={
        <span className="settings-hint">
          Preferences for Supiki responses
        </span>
      }
    >
      <div className="settings-body">
        <div className="settings-section">
          <label className="settings-label">AI Backend</label>
          <div className="settings-backend-list">
            <button
              className={`settings-backend-item ${
                settings.backendMode === "claude" ? "selected" : ""
              }`}
              onClick={() => handleBackendChange("claude")}
              disabled={claudeAvailable !== true}
            >
              <span className="backend-name">Claude</span>
              {claudeAvailable === null && (
                <span className="backend-status">
                  <span className="backend-spinner" />
                </span>
              )}
              {claudeAvailable === false && (
                <span className="backend-unavailable">(not installed)</span>
              )}
            </button>
            <button
              className={`settings-backend-item ${
                settings.backendMode === "codex" ? "selected" : ""
              }`}
              onClick={() => handleBackendChange("codex")}
              disabled={codexAvailable !== true}
            >
              <span className="backend-name">Codex</span>
              {codexAvailable === null && (
                <span className="backend-status">
                  <span className="backend-spinner" />
                </span>
              )}
              {codexAvailable === false && (
                <span className="backend-unavailable">(not installed)</span>
              )}
            </button>
          </div>
        </div>

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
