import { ServerList } from "./ServerList";
import { useUIStore } from "../stores/uiStore";
import { useT } from "../stores/i18nStore";

export function Sidebar() {
  const activeSection = useUIStore((s) => s.activeSection);
  const managementTab = useUIStore((s) => s.managementTab);
  const setManagementTab = useUIStore((s) => s.setManagementTab);
  const t = useT();

  if (activeSection === "management") {
    return (
      <div className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">{t("sidebar.management")}</span>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <div className="section-header">
              <span className="section-title">{t("sidebar.dataManagement")}</span>
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
                {t("sidebar.quickCommands")}
              </button>
              <button
                className={`sidebar-action-btn ${managementTab === "blacklist" ? "sidebar-action-btn--active" : ""}`}
                onClick={() => setManagementTab("blacklist")}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                {t("sidebar.blacklist")}
              </button>
              <button
                className={`sidebar-action-btn ${managementTab === "settings" ? "sidebar-action-btn--active" : ""}`}
                onClick={() => setManagementTab("settings")}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M7 1V3M7 11V13M1 7H3M11 7H13M2.5 2.5L4 4M10 10L11.5 11.5M11.5 2.5L10 4M4 10L2.5 11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                {t("sidebar.settings")}
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
        <span className="sidebar-logo">{t("sidebar.logo")}</span>
      </div>

      <nav className="sidebar-nav">
        <ServerList />
      </nav>
    </div>
  );
}
