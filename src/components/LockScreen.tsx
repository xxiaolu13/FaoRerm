import { useState, useEffect, useRef, useCallback } from "react";
import { useUIStore } from "../stores/uiStore";
import { useServerStore } from "../stores/serverStore";
import { useT } from "../stores/i18nStore";

export function LockScreen() {
  const lockScreenActive = useUIStore((s) => s.lockScreenActive);
  const deactivateLockScreen = useUIStore((s) => s.deactivateLockScreen);
  const unlockMasterPassword = useServerStore((s) => s.unlockMasterPassword);
  const loadServers = useServerStore((s) => s.loadServers);
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lockScreenActive) {
      setPassword("");
      setError(null);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [lockScreenActive]);

  const handleUnlock = useCallback(async () => {
    if (!password.trim()) {
      setError(t("lockScreen.enterPassword"));
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
  }, [password, unlockMasterPassword, loadServers, deactivateLockScreen, t]);

  useEffect(() => {
    if (!lockScreenActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target === inputRef.current || target.tagName === "INPUT";

      if (isInput) {
        if (e.key === "Enter") {
          e.preventDefault();
          if (password) handleUnlock();
        }
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") {
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [lockScreenActive, password, handleUnlock]);

  useEffect(() => {
    if (!lockScreenActive) return;

    const handleFocus = (e: FocusEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener("focusin", handleFocus, true);
    return () => document.removeEventListener("focusin", handleFocus, true);
  }, [lockScreenActive]);

  if (!lockScreenActive) return null;

  return (
    <div className="lock-screen">
      <div className="lock-screen-card" ref={cardRef}>
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
        <h2 className="lock-screen-title">{t("lockScreen.title")}</h2>
        <p className="lock-screen-desc">{t("lockScreen.desc")}</p>
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
            placeholder={t("lockScreen.placeholder")}
            autoFocus
          />
          {error && <div className="alert alert--error">{error}</div>}
          <button
            className="btn btn--primary btn--full"
            onClick={handleUnlock}
            disabled={loading || !password}
          >
            {loading ? t("lockScreen.unlocking") : t("lockScreen.unlock")}
          </button>
        </div>
      </div>
    </div>
  );
}
