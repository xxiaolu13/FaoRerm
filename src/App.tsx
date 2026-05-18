import { useEffect, useState } from "react";
import { useTerminalStore } from "./stores/terminalStore";
import { useUIStore } from "./stores/uiStore";
import { useServerStore } from "./stores/serverStore";
import { useSshEvents } from "./hooks/useSshEvents";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { TerminalView } from "./components/TerminalView";
import { QuickCommands } from "./components/QuickCommands";
import { LockScreen } from "./components/LockScreen";
import { ServerModal } from "./components/modals/ServerModal";
import { MasterPasswordModal } from "./components/modals/MasterPasswordModal";
import { BlacklistModal } from "./components/modals/BlacklistModal";
import "./App.css";

function ActivityBar() {
  const activeSection = useUIStore((s) => s.activeSection);
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const activateLockScreen = useUIStore((s) => s.activateLockScreen);
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);
  const showBlacklistModal = useUIStore((s) => s.showBlacklistModal);

  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        <button
          className={`activity-bar-btn ${activeSection === "servers" ? "activity-bar-btn--active" : ""}`}
          onClick={() => setActiveSection("servers")}
          title="Servers"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="3" y="4" width="14" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="3" y="12" width="14" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="5.5" cy="6" r="0.8" fill="currentColor" />
            <circle cx="5.5" cy="14" r="0.8" fill="currentColor" />
          </svg>
        </button>
        <button
          className={`activity-bar-btn ${activeSection === "commands" ? "activity-bar-btn--active" : ""}`}
          onClick={() => setActiveSection("commands")}
          title="Quick Commands"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M4 5L8 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M4 10L12 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M4 15L10 15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M14 8L17 10.5L14 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="activity-bar-btn"
          onClick={showBlacklistModal}
          title="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10 2V4M10 16V18M2 10H4M16 10H18M4.22 4.22L5.64 5.64M14.36 14.36L15.78 15.78M15.78 4.22L14.36 5.64M5.64 14.36L4.22 15.78" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="activity-bar-bottom">
        {masterPasswordSet && (
          <button
            className="activity-bar-btn"
            onClick={activateLockScreen}
            title="Lock App (Ctrl+L)"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="5" y="9" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M7 9V6.5C7 4.567 8.567 3 10.5 3V3C12.433 3 14 4.567 14 6.5V9" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function RightDrawer() {
  const rightDrawerOpen = useUIStore((s) => s.rightDrawerOpen);
  const setRightDrawerOpen = useUIStore((s) => s.setRightDrawerOpen);

  return (
    <div className={`right-drawer ${rightDrawerOpen ? "right-drawer--open" : ""}`}>
      <div className="right-drawer-header">
        <span className="right-drawer-title">Commands</span>
        <button
          className="btn-icon"
          onClick={() => setRightDrawerOpen(false)}
          title="Close panel"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="right-drawer-content">
        <QuickCommands />
        <div className="right-drawer-section">
          <details className="right-drawer-accordion">
            <summary className="right-drawer-accordion-header">
              <span className="right-drawer-section-title">AI Assistant</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M4 5L6 7L8 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <div className="right-drawer-accordion-body">
              <span className="empty-hint">AI features coming soon</span>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function TerminalArea() {
  const tabs = useTerminalStore((s) => s.tabs);
  const tabOrder = useTerminalStore((s) => s.tabOrder);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const servers = useServerStore((s) => s.servers);

  if (tabOrder.length === 0) {
    const serverEntries = Object.entries(servers);
    return (
      <div className="terminal-area terminal-area--empty">
        <div className="dashboard">
          <div className="dashboard-hero">
            <svg className="dashboard-logo" width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="6" y="10" width="36" height="28" rx="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M14 18L18 22L14 26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M22 26H30" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <h2 className="dashboard-title">Welcome to FaoRerm</h2>
            <p className="dashboard-desc">
              Connect to a server to start a remote terminal session.
            </p>
          </div>
          {serverEntries.length > 0 && (
            <div className="dashboard-servers">
              <h3 className="dashboard-section-title">Quick Connect</h3>
              <div className="dashboard-server-grid">
                {serverEntries.slice(0, 6).map(([id, server]) => (
                  <ServerCard key={id} id={id} server={server} />
                ))}
              </div>
            </div>
          )}
          <div className="dashboard-shortcuts">
            <h3 className="dashboard-section-title">Keyboard Shortcuts</h3>
            <div className="shortcut-list">
              <div className="shortcut-item">
                <kbd className="shortcut-key">Ctrl+L</kbd>
                <span className="shortcut-desc">Lock application</span>
              </div>
              <div className="shortcut-item">
                <kbd className="shortcut-key">Ctrl+Shift+P</kbd>
                <span className="shortcut-desc">Toggle command panel</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-area">
      {tabOrder.map((sessionId) => {
        const tab = tabs.get(sessionId);
        if (!tab) return null;
        return (
          <TerminalView
            key={sessionId}
            sessionId={tab.sessionId}
            channelId={tab.channelId}
            active={sessionId === activeTabId}
          />
        );
      })}
    </div>
  );
}

function ServerCard({ id, server }: { id: string; server: import("./types").ServerConfig }) {
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);
  const addTab = useTerminalStore((s) => s.addTab);
  const setChannel = useTerminalStore((s) => s.setChannel);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    if (!masterPasswordSet) return;
    setConnecting(true);
    try {
      const { invoke, Channel } = await import("@tauri-apps/api/core");
      const { terminalManager } = await import("./terminal/terminalManager");

      const channel = new Channel<number[]>();
      const outputBuffer: number[][] = [];
      let resolvedSessionId: string | null = null;

      channel.onmessage = (data) => {
        if (resolvedSessionId) {
          terminalManager.write(resolvedSessionId, new Uint8Array(data));
        } else {
          outputBuffer.push(data);
        }
      };

      const sessionId = await invoke<string>("ssh_connect", { serverId: id, outputChannel: channel });
      resolvedSessionId = sessionId;

      for (const data of outputBuffer) {
        terminalManager.write(sessionId, new Uint8Array(data));
      }
      outputBuffer.length = 0;

      setChannel(sessionId, channel);
      addTab({
        sessionId,
        serverId: id,
        serverName: id,
        host: server.host,
        channelId: "",
        status: "connecting",
      });
    } catch (err) {
      console.error("Connect failed:", err);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <button
      className="dashboard-server-card"
      onClick={handleConnect}
      disabled={connecting || !masterPasswordSet}
    >
      <div className="dashboard-server-card-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1" />
          <rect x="2" y="9" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>
      <div className="dashboard-server-card-info">
        <span className="dashboard-server-card-name">{id}</span>
        <span className="dashboard-server-card-detail">{server.user}@{server.host}</span>
      </div>
    </button>
  );
}

function GlobalKeyboardShortcuts() {
  const activateLockScreen = useUIStore((s) => s.activateLockScreen);
  const toggleRightDrawer = useUIStore((s) => s.toggleRightDrawer);
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "l") {
        e.preventDefault();
        if (masterPasswordSet) activateLockScreen();
      }
      if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        toggleRightDrawer();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activateLockScreen, toggleRightDrawer, masterPasswordSet]);

  return null;
}

export default function App() {
  useSshEvents();

  return (
    <div className="app">
      <GlobalKeyboardShortcuts />
      <ActivityBar />
      <Sidebar />
      <main className="main-content">
        <TabBar />
        <TerminalArea />
      </main>
      <RightDrawer />

      <LockScreen />

      <ServerModal />
      <MasterPasswordModal />
      <BlacklistModal />
    </div>
  );
}
