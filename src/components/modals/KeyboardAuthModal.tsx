import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUIStore } from "../../stores/uiStore";
import { useTerminalStore } from "../../stores/terminalStore";

export function KeyboardAuthModal() {
  const modal = useUIStore((s) => s.keyboardAuthModal);
  const hideKeyboardAuthModal = useUIStore((s) => s.hideKeyboardAuthModal);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);

  if (!modal) return null;

  const isPassword = /password|passwd|secret/i.test(modal.prompt);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await invoke("ssh_respond_keyboard_auth", {
        sessionId: modal.sessionId,
        response,
      });
      hideKeyboardAuthModal();
    } catch (err) {
      console.error("Failed to respond to keyboard auth:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    invoke("ssh_disconnect", { sessionId: modal.sessionId }).catch(() => {});
    const store = useTerminalStore.getState();
    const sessionTabs = store.getTabsBySessionId(modal.sessionId);
    for (const tab of sessionTabs) {
      removeTab(tab.tabId);
    }
    hideKeyboardAuthModal();
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-icon modal-icon--info">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M12 16V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="8" r="1" fill="currentColor" />
            </svg>
          </div>
          <h2 className="modal-title">Authentication Required</h2>
          <p className="modal-desc modal-desc--prompt">{modal.prompt}</p>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="kb-auth-input">
              Response
            </label>
            <input
              id="kb-auth-input"
              className="input"
              type={isPassword ? "password" : "text"}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && response) handleSubmit();
              }}
              autoFocus
              placeholder={isPassword ? "Enter password..." : "Enter response..."}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={handleCancel}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            onClick={handleSubmit}
            disabled={loading || !response}
          >
            {loading ? "Sending..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
