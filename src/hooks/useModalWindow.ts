import { useEffect, useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface UseModalWindowOptions {
  onEscape?: () => void;
  /** Called when window loses focus (after delay). If not provided, uses onEscape. */
  onBlur?: () => void;
  closeOnBlur?: boolean;
  blurDelay?: number;
  /** Ref to check if blur should be skipped (e.g., when a child modal is open) */
  skipBlurRef?: React.RefObject<boolean>;
}

/**
 * Hook for modal window behavior:
 * - Escape key handling
 * - Focus loss handling with delay
 * - Drag start handling (excludes interactive elements)
 * - User-initiated drag tracking
 */
export function useModalWindow(options: UseModalWindowOptions = {}) {
  const { onEscape, onBlur, closeOnBlur = false, blurDelay = 150, skipBlurRef } = options;

  // Track whether user initiated a drag (useful for move event handling)
  const userInitiatedDragRef = useRef(false);

  // Escape key handling
  useEffect(() => {
    if (!onEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscape();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEscape]);

  // Focus loss handling
  useEffect(() => {
    const blurHandler = onBlur ?? onEscape;
    if (!closeOnBlur || !blurHandler) return;

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
        // Check skip condition (e.g., child modal is open)
        if (skipBlurRef?.current) {
          return;
        }
        // Delay hide to allow for drag operations
        hideTimeout = window.setTimeout(() => {
          blurHandler();
        }, blurDelay);
      }
    });

    return () => {
      if (hideTimeout) clearTimeout(hideTimeout);
      unlisten.then((fn) => fn());
    };
  }, [closeOnBlur, blurDelay, onBlur, onEscape, skipBlurRef]);

  // Drag start handler that excludes interactive elements
  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();

    // Don't drag if clicking on interactive elements
    if (tagName === "button" || tagName === "input" || tagName === "textarea" || tagName === "select") {
      return;
    }

    const win = getCurrentWindow();
    userInitiatedDragRef.current = true;
    await win.startDragging();
  }, []);

  return { handleDragStart, userInitiatedDragRef };
}
