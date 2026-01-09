import { useEffect, DependencyList, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Hook for subscribing to Tauri events with automatic cleanup.
 * The handler is stable across re-renders using a ref.
 */
export function useTauriEvent<T>(
  eventName: string,
  handler: (payload: T) => void,
  deps: DependencyList = []
) {
  // Use a ref to always have the latest handler without re-subscribing
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unlisten = listen<T>(eventName, (e) => {
      handlerRef.current(e.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName, ...deps]);
}
