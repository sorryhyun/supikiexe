import { MascotApp } from "./MascotApp";
import Supiki from "./mascot/Supiki";

function App() {
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
    />
  );
}

export default App;
