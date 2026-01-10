import { useState, useRef, useEffect } from "react";
import { commands } from "../../bindings";

const MAX_IMAGES = 5;

export interface AttachedImage {
  id: string;
  base64: string; // base64 data URL (includes data:image/... prefix)
}

interface ChatInputProps {
  onSend: (message: string, images?: AttachedImage[]) => void;
  disabled?: boolean;
  onAnalyzeScreen?: () => void;
}

function ChatInput({ onSend, disabled, onAnalyzeScreen }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        setShowPlusMenu(false);
      }
    };
    if (showPlusMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showPlusMenu]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((value.trim() || attachedImages.length > 0) && !disabled) {
      onSend(value.trim(), attachedImages.length > 0 ? attachedImages : undefined);
      setValue("");
      setAttachedImages([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();

        if (attachedImages.length >= MAX_IMAGES) {
          console.log("[ChatInput] Max images reached:", MAX_IMAGES);
          return;
        }

        const file = item.getAsFile();
        if (!file) continue;

        // Convert to base64
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result as string;
          const newImage: AttachedImage = {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            base64,
          };
          setAttachedImages((prev) => {
            if (prev.length >= MAX_IMAGES) return prev;
            return [...prev, newImage];
          });
        };
        reader.readAsDataURL(file);
        break; // Only process first image per paste
      }
    }
  };

  const handleImageClick = async (image: AttachedImage) => {
    try {
      // Open image in system viewer via Tauri command
      await commands.openImageInViewer(image.base64);
    } catch (err) {
      console.error("[ChatInput] Failed to open image:", err);
    }
  };

  const handleRemoveImage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleAnalyzeScreen = () => {
    setShowPlusMenu(false);
    onAnalyzeScreen?.();
  };

  return (
    <div className="chat-input-container">
      {attachedImages.length > 0 && (
        <div className="attached-images">
          {attachedImages.map((img, index) => (
            <button
              key={img.id}
              type="button"
              className="attached-image-btn"
              onClick={() => handleImageClick(img)}
              title="Click to view"
            >
              [img{index + 1}]
              <span
                className="attached-image-remove"
                onClick={(e) => handleRemoveImage(img.id, e)}
                title="Remove"
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <div className="chat-plus-wrapper" ref={menuRef}>
          <button
            type="button"
            className="chat-plus-btn"
            onClick={() => setShowPlusMenu(!showPlusMenu)}
            title="More actions"
          >
            +
          </button>
          {showPlusMenu && (
            <div className="chat-plus-menu">
              <button type="button" onClick={handleAnalyzeScreen}>
                Analyze screen
              </button>
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={attachedImages.length > 0 ? "Add a message..." : "Say something..."}
          disabled={disabled}
        />
        <button
          type="submit"
          className="chat-send-btn"
          disabled={disabled || (!value.trim() && attachedImages.length === 0)}
        >
          ↵
        </button>
      </form>
    </div>
  );
}

export default ChatInput;
