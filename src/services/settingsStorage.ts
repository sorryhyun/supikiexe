/**
 * Settings storage service - persists user preferences to localStorage
 */

const SETTINGS_KEY = "clawd-settings";

export interface Settings {
  language: string;
}

const DEFAULT_SETTINGS: Settings = {
  language: "en",
};

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "ko", name: "한국어" },
  { code: "ja", name: "日本語" },
  { code: "zh", name: "中文" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
];

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (err) {
    console.error("[settingsStorage] Failed to load settings:", err);
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error("[settingsStorage] Failed to save settings:", err);
  }
}

export function getLanguage(): string {
  return loadSettings().language;
}

export function setLanguage(language: string): void {
  const settings = loadSettings();
  settings.language = language;
  saveSettings(settings);
}
