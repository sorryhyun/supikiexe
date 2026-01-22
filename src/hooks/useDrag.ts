import { useEffect, useRef, useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { DRAG_THRESHOLD } from "../constants";

export interface DragState {
  isDragging: boolean;
  wasDragged: boolean;
  startDrag: (e: React.MouseEvent, onMascot?: boolean) => void;
  resetDragState: () => void;
}

export interface DragCallbacks {
  onDragStart?: () => void;
  onDragEnd?: (wasDragged: boolean) => void;
}

export function useDrag(callbacks: DragCallbacks = {}): DragState {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const wasDragged = useRef(false);
  const clickedOnMascot = useRef(false);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = async (e: MouseEvent) => {
      if (dragStartPos.current) {
        const dx = Math.abs(e.clientX - dragStartPos.current.x);
        const dy = Math.abs(e.clientY - dragStartPos.current.y);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
          wasDragged.current = true;
        }
      }

      const appWindow = getCurrentWindow();
      const factor = await appWindow.scaleFactor();
      const currentPos = await appWindow.outerPosition();

      const newPosition = new PhysicalPosition(
        Math.round(currentPos.x + e.movementX * factor),
        Math.round(currentPos.y + e.movementY * factor)
      );
      await appWindow.setPosition(newPosition);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      const wasOnMascot = clickedOnMascot.current;
      const didDrag = wasDragged.current;

      dragStartPos.current = null;
      clickedOnMascot.current = false;

      // If clicked on mascot but didn't drag, don't trigger drag end
      if (wasOnMascot && !didDrag) {
        return;
      }

      callbacks.onDragEnd?.(didDrag);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, callbacks]);

  const startDrag = useCallback((e: React.MouseEvent, onMascot = false) => {
    if (onMascot) {
      e.stopPropagation();
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      clickedOnMascot.current = true;
    } else {
      e.preventDefault();
      clickedOnMascot.current = false;
    }
    wasDragged.current = false;
    setIsDragging(true);
    callbacks.onDragStart?.();
  }, [callbacks]);

  const resetDragState = useCallback(() => {
    wasDragged.current = false;
  }, []);

  return {
    isDragging,
    wasDragged: wasDragged.current,
    startDrag,
    resetDragState,
  };
}
