import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { CONTEXT_MENU_WIDTH, CONTEXT_MENU_HEIGHT } from "../constants";

export function useContextMenu() {
  const closeContextMenu = useCallback(async () => {
    const existingMenu = await WebviewWindow.getByLabel("contextmenu");
    if (existingMenu) {
      await existingMenu.close();
    }
  }, []);

  const openContextMenu = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Close existing menu without waiting
    closeContextMenu();

    const appWindow = getCurrentWindow();
    const [windowPos, factor] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.scaleFactor(),
    ]);

    const menuX = windowPos.x / factor + e.clientX;
    const menuY = windowPos.y / factor + e.clientY;

    const menuWindow = new WebviewWindow("contextmenu", {
      url: "index.html?contextmenu=true",
      title: "",
      width: CONTEXT_MENU_WIDTH,
      height: CONTEXT_MENU_HEIGHT,
      x: Math.round(menuX),
      y: Math.round(menuY),
      resizable: false,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      shadow: false,
      focus: true,
    });

    menuWindow.once("tauri://created", async () => {
      await menuWindow.setFocus();
    });

    menuWindow.once("tauri://error", (e) => {
      console.error("[useContextMenu] Context menu window error:", e);
    });
  }, [closeContextMenu]);

  return { openContextMenu, closeContextMenu };
}
