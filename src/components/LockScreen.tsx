import { useState, useEffect, useRef } from "react";
import { useUIStore } from "../stores/uiStore";
import { useServerStore } from "../stores/serverStore";

export function LockScreen() {
  const lockScreenActive = useUIStore((s) => s.lockScreenActive);
  const deactivateLockScreen = useUIStore((s) => s.deactivateLockScreen);
  const unlockMasterPassword = useServerStore((s) => s.unlockMasterPassword);
  const loadServers = useServerStore((s) => s.loadServers);
  const inputRef = useRef<HTMLInputElement>(null);

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lockScreenActive) {
      setPassword("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [lockScreenActive]);

  useEffect(() => {
    if (!lockScreenActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.key === "Enter" && password) {
        handleUnlock();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [lockScreenActive, password]);

  if (!lockScreenActive) return null;

  const handleUnlock = async () => {
    if (!password.trim()) {
      setError("Please enter a password");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await unlockMasterPassword(password);
      await loadServers();
      deactivateLockScreen();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-screen-card">
        <div className="lock-screen-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <rect
              x="5"
              y="11"
              width="14"
              height="10"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M8 11V7C8 4.791 9.791 3 12 3C14.209 3 16 4.791 16 7V11"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="12" cy="16" r="1.5" fill="currentColor" />
          </svg>
        </div>
        <h2 className="lock-screen-title">FaoRerm Locked</h2>
        <p className="lock-screen-desc">
          Enter your master password to unlock the application.
        </p>
        <div className="lock-screen-form">
          <input
            ref={inputRef}
            className="input"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            placeholder="Master password"
            autoFocus
          />
          {error && <div className="alert alert--error">{error}</div>}
          <button
            className="btn btn--primary btn--full"
            onClick={handleUnlock}
            disabled={loading || !password}
          >
            {loading ? "Unlocking..." : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}
