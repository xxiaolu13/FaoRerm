import { useEffect, useState } from "react";
import { useUIStore } from "../../stores/uiStore";
import { useServerStore } from "../../stores/serverStore";

export function MasterPasswordModal() {
  const show = useUIStore((s) => s.masterPasswordModal);
  const hideMasterPasswordModal = useUIStore((s) => s.hideMasterPasswordModal);
  const unlockMasterPassword = useServerStore((s) => s.unlockMasterPassword);
  const checkMasterPassword = useServerStore((s) => s.checkMasterPassword);
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);
  const loadServers = useServerStore((s) => s.loadServers);

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
      setError("Please enter a password");
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
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-icon modal-icon--lock">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect
                x="5"
                y="11"
                width="14"
                height="10"
                rx="2"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M8 11V7C8 4.791 9.791 3 12 3C14.209 3 16 4.791 16 7V11"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle cx="12" cy="16" r="1" fill="currentColor" />
            </svg>
          </div>
          <h2 className="modal-title">Master Password</h2>
          <p className="modal-desc">
            Set a master password to encrypt and protect your server
            credentials. This password is required each time you launch the app.
          </p>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="master-password">
              Master Password
            </label>
            <input
              id="master-password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUnlock();
              }}
              autoFocus
              placeholder="Enter a strong master password"
            />
          </div>
          {error && <div className="alert alert--error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button
            className="btn btn--primary btn--full"
            onClick={handleUnlock}
            disabled={loading}
          >
            {loading ? "Unlocking..." : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}
