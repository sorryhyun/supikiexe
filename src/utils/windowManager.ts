import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

interface WindowConfig {
  label: string;
  url: string;
  title: string;
  width: number;
  height: number;
  offsetY?: number;
}

/**
 * Opens a floating window near the current window position.
 * Closes any existing window with the same label first.
 */
export async function openFloatingWindow(config: WindowConfig): Promise<void> {
  const win = getCurrentWindow();
  const pos = await win.outerPosition();
  const factor = await win.scaleFactor();

  // Close any existing window with the same label
  const existing = await WebviewWindow.getByLabel(config.label);
  if (existing) {
    await existing.close();
  }

  new WebviewWindow(config.label, {
    url: config.url,
    title: config.title,
    width: config.width,
    height: config.height,
    x: Math.round(pos.x / factor),
    y: Math.round(pos.y / factor + (config.offsetY ?? 0)),
    resizable: false,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    focus: true,
  });

  await win.close();
}
