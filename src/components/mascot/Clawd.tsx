import { AnimationState, Direction } from "../../hooks/useMascotState";
import { type Emotion, FACIAL_CONFIG, emotionToFacial } from "../../emotion";

interface ClawdProps {
  animationState: AnimationState;
  direction: Direction;
  emotion?: Emotion;
  onClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function Clawd({ animationState, direction, emotion: emotionProp = "neutral", onClick, onMouseDown, onDoubleClick, onContextMenu }: ClawdProps) {
  // When talking and no active emotion (neutral), show curious
  const emotion = animationState === "talking" && emotionProp === "neutral" ? "curious" : emotionProp;
  // Convert emotion to facial state for visual rendering
  const facialState = emotionToFacial(emotion);

  const getAnimationClass = () => {
    switch (animationState) {
      case "walking":
        return "mascot-walking";
      case "jumping":
        return "mascot-jumping";
      case "falling":
        return "mascot-falling";
      case "talking":
        return "mascot-talking";
      default:
        return "mascot-idle";
    }
  };

  const facialConfig = FACIAL_CONFIG[facialState];
  const leftEye = facialConfig.leftEye;
  const rightEye = facialConfig.rightEye;
  const eyebrows = facialConfig.eyebrows;

  const isRotated = facialState === "curious";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 22 16"
      width="110"
      height="80"
      shapeRendering={isRotated ? "auto" : "crispEdges"}
      className={`mascot${getAnimationClass()} mascot-facial-${facialState}`}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      aria-label=""
      role="img"
      style={{
        transform: `${direction === "left" ? "scaleX(-1)" : "scaleX(1)"} ${isRotated ? "rotate(-10deg)" : ""}`,
      }}
    >
      <g className="mascot-body">
        {/* When rotated, use a background path to prevent AA gaps at seams */}
        {isRotated && (
          <path
            d="M2,0 H20 V4 H22 V8 H20 V12 H2 V8 H0 V4 H2 Z"
            fill="#BD825D"
          />
        )}

        {/* Body top */}
        <rect x="2" y="0" width="18" height="4" fill="#BD825D" />

        {/* Body middle with eye gaps */}
        <rect x="0" y="4" width="4" height="2" fill="#BD825D" />
        <rect x="6" y="4" width="10" height="2" fill="#BD825D" />
        <rect x="18" y="4" width="4" height="2" fill="#BD825D" />

        {/* Eyebrows (emotion-based) */}
        {eyebrows && (
          <g className="mascot-eyebrows">
            <line
              x1={eyebrows.left.x1}
              y1={eyebrows.left.y1}
              x2={eyebrows.left.x2}
              y2={eyebrows.left.y2}
              stroke="#5c3d2e"
              strokeWidth="0.8"
              strokeLinecap="round"
            />
            <line
              x1={eyebrows.right.x1}
              y1={eyebrows.right.y1}
              x2={eyebrows.right.x2}
              y2={eyebrows.right.y2}
              stroke="#5c3d2e"
              strokeWidth="0.8"
              strokeLinecap="round"
            />
          </g>
        )}

        {/* Eyes (emotion-based) */}
        <rect
          className="mascot-eye mascot-eye-left"
          x={4 + (leftEye.offsetX || 0)}
          y={leftEye.y}
          width={leftEye.width || 2}
          height={leftEye.height}
          fill="#000000"
        />
        <rect
          className="mascot-eye mascot-eye-right"
          x={16 + (rightEye.offsetX || 0)}
          y={rightEye.y}
          width={rightEye.width || 2}
          height={rightEye.height}
          fill="#000000"
        />

        {/* Eye shine (for happy/excited) */}
        {(facialState === "happy" || facialState === "excited") && (
          <g className="mascot-eye-shine">
            <rect x="4.3" y={leftEye.y + 0.3} width="0.6" height="0.6" fill="#ffffff" opacity="0.7" />
            <rect x="16.3" y={rightEye.y + 0.3} width="0.6" height="0.6" fill="#ffffff" opacity="0.7" />
          </g>
        )}

        {/* Body bottom */}
        <rect x="0" y="6" width="22" height="2" fill="#BD825D" />
        <rect x="2" y="8" width="18" height="4" fill="#BD825D" />

        {/* Legs */}
        <g className="mascot-legs">
          <rect className="mascot-leg mascot-leg-1" x="2" y="12" width="2" height="4" fill="#BD825D" />
          <rect className="mascot-leg mascot-leg-2" x="6" y="12" width="2" height="4" fill="#BD825D" />
          <rect className="mascot-leg mascot-leg-3" x="14" y="12" width="2" height="4" fill="#BD825D" />
          <rect className="mascot-leg mascot-leg-4" x="18" y="12" width="2" height="4" fill="#BD825D" />
        </g>
      </g>


      {/* Thinking bubble for thinking facial state */}
      {facialState === "thinking" && (
        <g className="thinking-indicator">
          <circle cx="19" cy="1" r="0.5" fill="#888" opacity="0.6" />
          <circle cx="20.5" cy="0" r="0.7" fill="#888" opacity="0.7" />
          <circle cx="22" cy="-1.5" r="1" fill="#888" opacity="0.8" />
        </g>
      )}

      {/* Confusion marks */}
      {facialState === "confused" && (
        <g className="confused-indicator">
          <text x="19" y="2" fontSize="3" fill="#666" fontWeight="bold">?</text>
        </g>
      )}

      {/* Excitement sparkles */}
      {facialState === "excited" && (
        <g className="excited-indicator">
          <polygon points="20,0 20.3,0.8 21.2,0.8 20.5,1.3 20.7,2.1 20,1.6 19.3,2.1 19.5,1.3 18.8,0.8 19.7,0.8" fill="#FFD700" />
        </g>
      )}

      {/* Curious question mark */}
      {facialState === "curious" && (
        <g className="curious-indicator">
          <text x="18" y="3" fontSize="5" fill="#555" fontWeight="bold">?</text>
        </g>
      )}
    </svg>
  );
}

export default Clawd;
