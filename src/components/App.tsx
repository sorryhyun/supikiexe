import { MascotApp } from "./MascotApp";
import Clawd from "./Clawd";

function App() {
  return (
    <MascotApp
      renderMascot={(props) => (
        <Clawd
          animationState={props.animationState}
          direction={props.direction}
          emotion={props.emotion}
          onClick={props.onClick}
          onMouseDown={props.onMouseDown}
          onContextMenu={props.onContextMenu}
        />
      )}
    />
  );
}

export default App;
