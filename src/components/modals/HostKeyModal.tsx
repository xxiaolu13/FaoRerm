import { invoke } from "@tauri-apps/api/core";
import { useUIStore } from "../../stores/uiStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useT } from "../../stores/i18nStore";

export function HostKeyModal() {
  const modal = useUIStore((s) => s.hostKeyModal);
  const hideHostKeyModal = useUIStore((s) => s.hideHostKeyModal);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const t = useT();

  if (!modal) return null;

  const handleAccept = async () => {
    try {
      await invoke("ssh_confirm_host_key", {
        sessionId: modal.sessionId,
        accepted: true,
      });
    } catch (err) {
      console.error("Failed to confirm host key:", err);
    }
    hideHostKeyModal();
  };

  const handleDeny = async () => {
    try {
      await invoke("ssh_confirm_host_key", {
        sessionId: modal.sessionId,
        accepted: false,
      });
      await invoke("ssh_disconnect", { sessionId: modal.sessionId });
    } catch {
      // Session may already be gone
    }
    const store = useTerminalStore.getState();
    const sessionTabs = store.getTabsBySessionId(modal.sessionId);
    for (const tab of sessionTabs) {
      removeTab(tab.tabId);
    }
    hideHostKeyModal();
  };

  return (
    <div className="modal-overlay" onClick={handleDeny}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-icon modal-icon--warning">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L22 20H2L12 2Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M12 9V13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="12" cy="17" r="1" fill="currentColor" />
            </svg>
          </div>
          <h2 className="modal-title">{t("hostKey.title")}</h2>
          <p className="modal-desc">{t("hostKey.desc")}</p>
        </div>

        <div className="modal-body">
          <div className="key-info">
            <div className="key-info-row">
              <span className="key-info-label">{t("hostKey.keyType")}</span>
              <code className="key-info-value">{modal.keyType}</code>
            </div>
            <div className="key-info-row">
              <span className="key-info-label">{t("hostKey.fingerprint")}</span>
              <code className="key-info-value key-fingerprint">
                {modal.fingerprint}
              </code>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn--danger" onClick={handleDeny}>
            {t("hostKey.deny")}
          </button>
          <button className="btn btn--primary" onClick={handleAccept}>
            {t("hostKey.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
