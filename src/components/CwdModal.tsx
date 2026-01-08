import { useState, useEffect } from "react";
import { commands } from "../bindings";
import "../styles/cwdmodal.css";

interface CwdModalProps {
  onClose: () => void;
  onCwdChange: () => void;
}

function CwdModal({ onClose, onCwdChange }: CwdModalProps) {
  const [currentCwd, setCurrentCwd] = useState<string | null>(null);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [inputPath, setInputPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load current cwd and recent cwds
  useEffect(() => {
    const loadData = async () => {
      try {
        const cwd = await commands.getActualCwd();
        setCurrentCwd(cwd);
        const recent = await commands.getRecentCwds();
        setRecentCwds(recent);
      } catch (err) {
        console.error("[CwdModal] Failed to load data:", err);
      }
    };
    loadData();
  }, []);

  // Open native folder picker
  const handleBrowse = async () => {
    try {
      const folder = await commands.pickFolder();
      if (folder) {
        setInputPath(folder);
      }
    } catch (err) {
      console.error("[CwdModal] Failed to pick folder:", err);
    }
  };

  // Handle path change
  const handleSetCwd = async (path: string) => {
    try {
      setError(null);
      const result = await commands.setSidecarCwd(path);
      if (result.status === "ok") {
        onCwdChange();
        onClose();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(`Failed to set directory: ${err}`);
    }
  };

  // Handle form submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputPath.trim()) {
      handleSetCwd(inputPath.trim());
    }
  };

  // Handle keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Get display name for path (last folder name)
  const getDisplayName = (path: string) => {
    const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] || path;
  };

  return (
    <div className="cwd-modal-overlay" onClick={onClose}>
      <div className="cwd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cwd-modal-header">
          <span>Delegate Clawd</span>
          <button className="cwd-modal-close" onClick={onClose}>
            x
          </button>
        </div>

        <div className="cwd-modal-body">
          {/* Current CWD display */}
          <div className="cwd-current">
            <span className="cwd-label">Current directory:</span>
            <span className="cwd-path" title={currentCwd || "Loading..."}>
              {currentCwd ? getDisplayName(currentCwd) : "Loading..."}
            </span>
          </div>

          {/* Input for new path */}
          <form className="cwd-input-form" onSubmit={handleSubmit}>
            <input
              type="text"
              className="cwd-input"
              placeholder="Enter directory path..."
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="cwd-browse-btn"
              onClick={handleBrowse}
            >
              Browse
            </button>
            <button
              type="submit"
              className="cwd-submit-btn"
              disabled={!inputPath.trim()}
            >
              Set
            </button>
          </form>

          {error && <div className="cwd-error">{error}</div>}

          {/* Recent CWDs */}
          {recentCwds.length > 0 && (
            <div className="cwd-recent">
              <span className="cwd-label">Recent:</span>
              <div className="cwd-recent-list">
                {recentCwds.map((path, index) => (
                  <button
                    key={index}
                    className="cwd-recent-item"
                    onClick={() => handleSetCwd(path)}
                    title={path}
                  >
                    {getDisplayName(path)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="cwd-modal-footer">
          <span className="cwd-hint">
            Changes will start a new session
          </span>
        </div>
      </div>
    </div>
  );
}

export default CwdModal;
