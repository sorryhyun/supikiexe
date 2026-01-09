import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose?: () => void;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
  overlay?: boolean;
  overlayDark?: boolean;
  onOverlayClick?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
}

export function Modal({
  title,
  onClose,
  footer,
  className,
  children,
  overlay,
  overlayDark,
  onOverlayClick,
  onMouseDown,
}: ModalProps) {
  const content = (
    <div
      className={`modal ${className || ""}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={onMouseDown}
    >
      <div className="modal-header" onMouseDown={onMouseDown}>
        <span>{title}</span>
        {onClose && (
          <button className="modal-close" onClick={onClose}>
            x
          </button>
        )}
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  );

  if (overlay) {
    return (
      <div
        className={`modal-overlay ${overlayDark ? "modal-overlay-dark" : ""}`}
        onClick={onOverlayClick}
      >
        {content}
      </div>
    );
  }

  return content;
}

export default Modal;
