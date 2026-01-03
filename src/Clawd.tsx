import { MascotState, Direction } from "./useMascotState";
import { type Emotion, EMOTION_CONFIG } from "./emotions";

interface ClawdProps {
  state: MascotState;
  direction: Direction;
  emotion?: Emotion;
  onClick?: (e: React.MouseEvent) => void;
}

function Clawd({ state, direction, emotion = "neutral", onClick }: ClawdProps) {
  const getAnimationClass = () => {
    switch (state) {
      case "walking":
        return "clawd-walking";
      case "jumping":
        return "clawd-jumping";
      case "falling":
        return "clawd-falling";
      case "talking":
        return "clawd-talking";
      default:
        return "clawd-idle";
    }
  };

  const emotionConfig = EMOTION_CONFIG[emotion];
  const leftEye = emotionConfig.leftEye;
  const rightEye = emotionConfig.rightEye;
  const eyebrows = emotionConfig.eyebrows;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 22 16"
      width="110"
      height="80"
      shapeRendering="crispEdges"
      className={`clawd ${getAnimationClass()} clawd-emotion-${emotion}`}
      onClick={onClick}
      style={{
        transform: direction === "left" ? "scaleX(-1)" : "scaleX(1)",
      }}
    >
      <g className="clawd-body">
        {/* Body top */}
        <rect x="2" y="0" width="18" height="4" fill="#BD825D" />

        {/* Body middle with eye gaps */}
        <rect x="0" y="4" width="4" height="2" fill="#BD825D" />
        <rect x="6" y="4" width="10" height="2" fill="#BD825D" />
        <rect x="18" y="4" width="4" height="2" fill="#BD825D" />

        {/* Eyebrows (emotion-based) */}
        {eyebrows && (
          <g className="clawd-eyebrows">
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
          className="clawd-eye clawd-eye-left"
          x={4 + (leftEye.offsetX || 0)}
          y={leftEye.y}
          width={leftEye.width || 2}
          height={leftEye.height}
          fill="#000000"
        />
        <rect
          className="clawd-eye clawd-eye-right"
          x={16 + (rightEye.offsetX || 0)}
          y={rightEye.y}
          width={rightEye.width || 2}
          height={rightEye.height}
          fill="#000000"
        />

        {/* Eye shine (for happy/excited) */}
        {(emotion === "happy" || emotion === "excited") && (
          <g className="clawd-eye-shine">
            <rect x="4.3" y={leftEye.y + 0.3} width="0.6" height="0.6" fill="#ffffff" opacity="0.7" />
            <rect x="16.3" y={rightEye.y + 0.3} width="0.6" height="0.6" fill="#ffffff" opacity="0.7" />
          </g>
        )}

        {/* Body bottom */}
        <rect x="0" y="6" width="22" height="2" fill="#BD825D" />
        <rect x="2" y="8" width="18" height="4" fill="#BD825D" />

        {/* Legs */}
        <g className="clawd-legs">
          <rect className="clawd-leg clawd-leg-1" x="2" y="12" width="2" height="4" fill="#BD825D" />
          <rect className="clawd-leg clawd-leg-2" x="6" y="12" width="2" height="4" fill="#BD825D" />
          <rect className="clawd-leg clawd-leg-3" x="14" y="12" width="2" height="4" fill="#BD825D" />
          <rect className="clawd-leg clawd-leg-4" x="18" y="12" width="2" height="4" fill="#BD825D" />
        </g>
      </g>

      {/* Speech bubble for talking state */}
      {state === "talking" && (
        <g className="speech-indicator">
          <ellipse cx="20" cy="2" rx="2" ry="1.5" fill="white" stroke="#333" strokeWidth="0.3" />
        </g>
      )}

      {/* Thinking bubble for thinking emotion */}
      {emotion === "thinking" && (
        <g className="thinking-indicator">
          <circle cx="19" cy="1" r="0.5" fill="#888" opacity="0.6" />
          <circle cx="20.5" cy="0" r="0.7" fill="#888" opacity="0.7" />
          <circle cx="22" cy="-1.5" r="1" fill="#888" opacity="0.8" />
        </g>
      )}

      {/* Confusion marks */}
      {emotion === "confused" && (
        <g className="confused-indicator">
          <text x="19" y="2" fontSize="3" fill="#666" fontWeight="bold">?</text>
        </g>
      )}

      {/* Excitement sparkles */}
      {emotion === "excited" && (
        <g className="excited-indicator">
          <polygon points="20,0 20.3,0.8 21.2,0.8 20.5,1.3 20.7,2.1 20,1.6 19.3,2.1 19.5,1.3 18.8,0.8 19.7,0.8" fill="#FFD700" />
        </g>
      )}
    </svg>
  );
}

export default Clawd;
