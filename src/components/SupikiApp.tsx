import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { MascotApp } from "./MascotApp";
import Supiki from "./mascot/Supiki";
import { useSupikiSounds } from "../hooks/useSupikiSounds";

function SupikiApp() {
  const { playEmotionSound, playCompletionSound } = useSupikiSounds();

  // Play ganbatta sound when clicking "Bye"
  useEffect(() => {
    const unlisten = listen("bye-clicked", () => {
      playCompletionSound();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [playCompletionSound]);

  return (
    <MascotApp
      renderMascot={(props) => (
        <Supiki
          animationState={props.animationState}
          direction={props.direction}
          onClick={props.onClick}
          onMouseDown={props.onMouseDown}
          onContextMenu={props.onContextMenu}
        />
      )}
      onEmotionChange={playEmotionSound}
    />
  );
}

export default SupikiApp;
