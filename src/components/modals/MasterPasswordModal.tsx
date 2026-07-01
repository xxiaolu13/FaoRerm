import { useEffect, useState } from "react";
import { useUIStore } from "../../stores/uiStore";
import { useServerStore } from "../../stores/serverStore";
import { useT } from "../../stores/i18nStore";

export function MasterPasswordModal() {
  const show = useUIStore((s) => s.masterPasswordModal);
  const hideMasterPasswordModal = useUIStore((s) => s.hideMasterPasswordModal);
  const unlockMasterPassword = useServerStore((s) => s.unlockMasterPassword);
  const checkMasterPassword = useServerStore((s) => s.checkMasterPassword);
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);
  const loadServers = useServerStore((s) => s.loadServers);
  const t = useT();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkMasterPassword();
  }, []);

  // Auto-hide if already unlocked
  useEffect(() => {
    if (masterPasswordSet && show) {
      hideMasterPasswordModal();
      loadServers();
    }
  }, [masterPasswordSet, show]);

  if (!show || masterPasswordSet) return null;

  const handleUnlock = async () => {
    if (!password.trim()) {
      setError(t("masterPassword.enterPassword"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await unlockMasterPassword(password);
      await loadServers();
      hideMasterPasswordModal();
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
        <h2 className="lock-screen-title">{t("masterPassword.title")}</h2>
        <p className="lock-screen-desc">{t("masterPassword.desc")}</p>
        <div className="lock-screen-form">
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleUnlock();
            }}
            placeholder={t("masterPassword.placeholder")}
            autoFocus
          />
          {error && <div className="alert alert--error">{error}</div>}
          <button
            className="btn btn--primary btn--full"
            onClick={handleUnlock}
            disabled={loading || !password}
          >
            {loading ? t("masterPassword.unlocking") : t("masterPassword.unlock")}
          </button>
        </div>
      </div>
    </div>
  );
}
