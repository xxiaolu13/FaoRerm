import { ServerList } from "./ServerList";
import { useUIStore } from "../stores/uiStore";
import { useServerStore } from "../stores/serverStore";

export function Sidebar() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const activeSection = useUIStore((s) => s.activeSection);
  const showBlacklistModal = useUIStore((s) => s.showBlacklistModal);
  const clearMasterPassword = useServerStore((s) => s.clearMasterPassword);
  const showMasterPasswordModal = useUIStore((s) => s.showMasterPasswordModal);
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);

  if (sidebarCollapsed || activeSection !== "servers") {
    return null;
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">FaoRerm</span>
      </div>

      <nav className="sidebar-nav">
        <ServerList />

        <div className="sidebar-section">
          <div className="section-header">
            <span className="section-title">Settings</span>
          </div>
          <div className="sidebar-actions">
            <button
              className="sidebar-action-btn"
              onClick={showBlacklistModal}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7 1L13 12H1L7 1Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <path
                  d="M7 5V8"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <circle cx="7" cy="10" r="0.5" fill="currentColor" />
              </svg>
              Command Blacklist
            </button>
            {masterPasswordSet && (
              <button
                className="sidebar-action-btn sidebar-action-btn--danger"
                onClick={async () => {
                  await clearMasterPassword();
                  showMasterPasswordModal();
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect
                    x="2.5"
                    y="6"
                    width="9"
                    height="6"
                    rx="1"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                  <path
                    d="M4.5 6V4C4.5 2.619 5.619 1.5 7 1.5C8.381 1.5 9.5 2.619 9.5 4V6"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                </svg>
                Lock App
              </button>
            )}
          </div>
        </div>
      </nav>
    </div>
  );
}
