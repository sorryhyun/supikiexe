import { useState, useEffect, useRef } from "react";
import { AnimationState, Direction } from "../../hooks/useMascotState";
import supikiImage from "../../resources/supiki.webp";
import euSound from "../../resources/eu.wav";
import ueSound from "../../resources/ue.wav";

interface SupikiProps {
  animationState: AnimationState;
  direction: Direction;
  onClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function Supiki({ animationState, direction, onClick, onMouseDown, onDoubleClick, onContextMenu }: SupikiProps) {
  const [squishProgress, setSquishProgress] = useState(0); // 0 = normal, 1 = fully squished
  const [isPressed, setIsPressed] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [clickOffset, setClickOffset] = useState({ x: 0, y: 0 }); // -1 to 1 range
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isPressedRef = useRef(false); // Sync flag to prevent double sound
  const pressStartTimeRef = useRef<number>(0); // Track when press started

  // Gradually squish while pressed
  useEffect(() => {
    if (isPressed && !isReleasing) {
      const animate = (currentTime: number) => {
        if (lastTimeRef.current === 0) {
          lastTimeRef.current = currentTime;
        }
        const deltaTime = currentTime - lastTimeRef.current;
        lastTimeRef.current = currentTime;

        setSquishProgress(prev => {
          const newProgress = prev + deltaTime * 0.002; // Squish speed
          return Math.min(newProgress, 1); // Cap at 1
        });

        if (isPressed) {
          animationRef.current = requestAnimationFrame(animate);
        }
      };
      lastTimeRef.current = 0;
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPressed, isReleasing]);

  // Spring back animation when released
  useEffect(() => {
    if (isReleasing) {
      const animate = (currentTime: number) => {
        if (lastTimeRef.current === 0) {
          lastTimeRef.current = currentTime;
        }
        const deltaTime = currentTime - lastTimeRef.current;
        lastTimeRef.current = currentTime;

        setSquishProgress(prev => {
          // Bouncy spring effect - slower return
          const newProgress = prev - deltaTime * 0.004; // Slower spring back
          if (newProgress <= -0.1) {
            // Bounce overshoot
            setIsReleasing(false);
            return 0;
          }
          return newProgress;
        });

        if (isReleasing) {
          animationRef.current = requestAnimationFrame(animate);
        }
      };
      lastTimeRef.current = 0;
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isReleasing]);

  const playSound = (src: string) => {
    const audio = new Audio(src);
    audio.play().catch(() => {});
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Calculate click position relative to center (-1 to 1)
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      let x = ((e.clientX - rect.left) / rect.width - 0.5) * 2; // -1 (left) to 1 (right)
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2; // -1 (top) to 1 (bottom)

      // When facing left (flipped), invert x to match visual position
      if (direction === "left") {
        x = -x;
      }

      setClickOffset({ x, y });
    }
    isPressedRef.current = true;
    pressStartTimeRef.current = Date.now();
    setIsPressed(true);
    setIsReleasing(false);
    playSound(euSound);
    onMouseDown?.(e);
  };

  const handleRelease = () => {
    if (isPressedRef.current) {
      const pressDuration = Date.now() - pressStartTimeRef.current;
      isPressedRef.current = false;
      setIsPressed(false);
      setIsReleasing(true);
      // Only play release sound if held for 0.5 seconds or longer
      if (pressDuration >= 500) {
        playSound(ueSound);
      }
    }
  };

  const handleMouseUp = () => {
    handleRelease();
  };

  const handleMouseLeave = () => {
    handleRelease();
  };

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

  const getTransform = () => {
    const flipX = direction === "left" ? -1 : 1;
    if (squishProgress !== 0) {
      // Squish from the click point - press down and spread
      const scaleY = 1 - squishProgress * 0.5;
      const scaleX = 1 + squishProgress * 0.3;

      // Skew in the opposite direction of click position
      // Click right-top → squish toward left-bottom (left-top becomes pointy)
      const skewX = clickOffset.x * squishProgress * 25; // degrees
      const skewY = -clickOffset.x * squishProgress * 5; // slight vertical skew

      // Compensate Y position to keep bottom grounded
      const originYPercent = ((clickOffset.y + 1) / 2) * 100;
      const bottomShift = (1 - scaleY) * (100 - originYPercent);

      // Also shift horizontally in the direction of squish
      const horizontalShift = -clickOffset.x * squishProgress * 15;

      return `translateY(${bottomShift}%) translateX(${horizontalShift}%) skewX(${skewX}deg) skewY(${skewY}deg) scaleX(${flipX * scaleX}) scaleY(${scaleY})`;
    }
    return `scaleX(${flipX})`;
  };

  const getTransformOrigin = () => {
    if (squishProgress !== 0) {
      // Transform origin follows click point in both X and Y
      const originX = ((clickOffset.x + 1) / 2) * 100;
      const originY = ((clickOffset.y + 1) / 2) * 100;
      return `${originX}% ${originY}%`;
    }
    return "center bottom";
  };

  return (
    <div
      ref={wrapperRef}
      className={`mascot-wrapper ${getAnimationClass()}`}
      onClick={onClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{
        width: "140px",
        height: "120px",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <div
        className="supiki"
        style={{
          transform: getTransform(),
          transformOrigin: getTransformOrigin(),
          pointerEvents: "none",
        }}
      >
        <img
          src={supikiImage}
          alt="Supiki"
          style={{
            maxWidth: "140px",
            maxHeight: "120px",
            width: "auto",
            height: "auto",
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}

export default Supiki;
