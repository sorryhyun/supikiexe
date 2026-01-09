import { MascotApp } from "./MascotApp";
import Supiki from "./Supiki";
import { useSupikiSounds } from "../hooks/useSupikiSounds";

function SupikiApp() {
  const { playEmotionSound } = useSupikiSounds();

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
