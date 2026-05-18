import { invoke } from "@tauri-apps/api/core";
import { useTerminalStore } from "../stores/terminalStore";
import { useUIStore } from "../stores/uiStore";

export function TabBar() {
  const tabs = useTerminalStore((s) => s.tabs);
  const tabOrder = useTerminalStore((s) => s.tabOrder);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const hostKeyModal = useUIStore((s) => s.hostKeyModal);
  const keyboardAuthModal = useUIStore((s) => s.keyboardAuthModal);
  const hideHostKeyModal = useUIStore((s) => s.hideHostKeyModal);
  const hideKeyboardAuthModal = useUIStore((s) => s.hideKeyboardAuthModal);

  const handleClose = (sessionId: string) => {
    invoke("ssh_disconnect", { sessionId }).catch(() => {});
    if (hostKeyModal?.sessionId === sessionId) hideHostKeyModal();
    if (keyboardAuthModal?.sessionId === sessionId) hideKeyboardAuthModal();
    removeTab(sessionId);
  };

  if (tabOrder.length === 0) {
    return (
      <div className="tab-bar tab-bar--empty">
        <span className="tab-bar-empty-text">
          Connect to a server from the sidebar to begin
        </span>
      </div>
    );
  }

  return (
    <div className="tab-bar">
      {tabOrder.map((sessionId) => {
        const tab = tabs.get(sessionId);
        if (!tab) return null;

        const isActive = sessionId === activeTabId;

        return (
          <div
            key={sessionId}
            className={`tab-item ${isActive ? "tab-item--active" : ""}`}
            onClick={() => setActiveTab(sessionId)}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") setActiveTab(sessionId);
            }}
          >
            <span
              className={`tab-status tab-status--${tab.status}`}
              title={tab.status}
            />
            <span className="tab-label">
              {tab.serverName}
            </span>
            <span className="tab-host">{tab.host}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                handleClose(sessionId);
              }}
              title="Close tab"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M3 3L9 9M9 3L3 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
