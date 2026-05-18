import { ServerList } from "./ServerList";
import { useUIStore } from "../stores/uiStore";

export function Sidebar() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const activeSection = useUIStore((s) => s.activeSection);
  const managementTab = useUIStore((s) => s.managementTab);
  const setManagementTab = useUIStore((s) => s.setManagementTab);

  if (sidebarCollapsed) {
    return null;
  }

  if (activeSection === "management") {
    return (
      <div className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">Management</span>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <div className="section-header">
              <span className="section-title">Data Management</span>
            </div>
            <div className="sidebar-actions">
              <button
                className={`sidebar-action-btn ${managementTab === "commands" ? "sidebar-action-btn--active" : ""}`}
                onClick={() => setManagementTab("commands")}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 4L6 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <path d="M2 7L9 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <path d="M2 10L7 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <path d="M10 6L12 7.5L10 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Quick Commands
              </button>
              <button
                className={`sidebar-action-btn ${managementTab === "blacklist" ? "sidebar-action-btn--active" : ""}`}
                onClick={() => setManagementTab("blacklist")}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                Blacklist
              </button>
            </div>
          </div>
        </nav>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">FaoRerm</span>
      </div>

      <nav className="sidebar-nav">
        <ServerList />
      </nav>
    </div>
  );
}
