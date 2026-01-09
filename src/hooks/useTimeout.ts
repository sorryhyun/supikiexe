import { useRef, useCallback, useEffect } from "react";

/**
 * Hook for managing a timeout with automatic cleanup.
 * Useful for debouncing, delayed actions, and auto-resets.
 */
export function useTimeout() {
  const timeoutRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const set = useCallback((callback: () => void, delay: number) => {
    clear();
    timeoutRef.current = window.setTimeout(callback, delay);
  }, [clear]);

  // Cleanup on unmount
  useEffect(() => {
    return clear;
  }, [clear]);

  return { set, clear };
}
