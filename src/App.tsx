import { useEffect, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useTerminalStore } from "./stores/terminalStore";
import { useUIStore } from "./stores/uiStore";
import { useServerStore } from "./stores/serverStore";
import { useSshEvents } from "./hooks/useSshEvents";
import { Sidebar } from "./components/Sidebar";
import { TabBar, TabContextMenu } from "./components/TabBar";
import { TerminalView } from "./components/TerminalView";
import { QuickCommands } from "./components/QuickCommands";
import { ServerDetailPanel } from "./components/ServerDetailPanel";
import { ManagementPage } from "./components/ManagementPage";
import { LockScreen } from "./components/LockScreen";
import { Toaster } from "./components/Toaster";
import { ServerModal } from "./components/modals/ServerModal";
import { MasterPasswordModal } from "./components/modals/MasterPasswordModal";
import { BlacklistModal } from "./components/modals/BlacklistModal";
import { toast } from "./stores/toastStore";
import { terminalManager } from "./terminal/terminalManager";
import "./App.css";

function ActivityBar() {
  const activeSection = useUIStore((s) => s.activeSection);
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const activateLockScreen = useUIStore((s) => s.activateLockScreen);
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);

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
          className={`activity-bar-btn ${activeSection === "management" ? "activity-bar-btn--active" : ""}`}
          onClick={() => setActiveSection("management")}
          title="Management"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
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
  const toggleRightDrawer = useUIStore((s) => s.toggleRightDrawer);
  const [activeTab, setActiveTab] = useState<"commands" | "ai">("commands");

  return (
    <>
      {!rightDrawerOpen && (
        <button
          className="right-drawer-toggle"
          onClick={toggleRightDrawer}
          title="Quick Commands (Ctrl+Shift+P)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L8 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M4 8L10 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M4 12L7 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M10 6L13 8.5L10 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <div className={`right-drawer ${rightDrawerOpen ? "right-drawer--open" : ""}`}>
        <div className="right-drawer-header">
          <div className="right-drawer-tabs">
            <button
              className={`right-drawer-tab ${activeTab === "commands" ? "right-drawer-tab--active" : ""}`}
              onClick={() => setActiveTab("commands")}
            >
              Commands
            </button>
            <button
              className={`right-drawer-tab ${activeTab === "ai" ? "right-drawer-tab--active" : ""}`}
              onClick={() => setActiveTab("ai")}
              disabled
              title="AI features coming soon"
            >
              AI
            </button>
          </div>
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
          {activeTab === "commands" && <QuickCommands />}
          {activeTab === "ai" && (
            <div className="right-drawer-section">
              <div className="ai-placeholder">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="ai-placeholder-icon">
                  <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 3" />
                  <path d="M12 14C12 14 14 12 16 12C18 12 20 14 20 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <path d="M12 18C12 18 14 20 16 20C18 20 20 18 20 18" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <span className="ai-placeholder-text">AI Assistant</span>
                <span className="ai-placeholder-hint">Coming soon</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TerminalArea() {
  const tabs = useTerminalStore((s) => s.tabs);
  const tabOrder = useTerminalStore((s) => s.tabOrder);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const activeSection = useUIStore((s) => s.activeSection);
  const selectedServerId = useUIStore((s) => s.selectedServerId);
  const servers = useServerStore((s) => s.servers);

  if (activeSection === "management") {
    return (
      <div className="terminal-area">
        <ManagementPage />
      </div>
    );
  }

  if (selectedServerId && tabOrder.length === 0) {
    return (
      <div className="terminal-area">
        <ServerDetailPanel />
      </div>
    );
  }

  if (selectedServerId && tabOrder.length > 0) {
    const hasServerTab = tabOrder.some((tid) => {
      const t = tabs.get(tid);
      return t?.serverId === selectedServerId;
    });

    if (!hasServerTab) {
      return (
        <div className="terminal-area">
          <ServerDetailPanel />
        </div>
      );
    }
  }

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
      {tabOrder.map((tabId) => {
        const tab = tabs.get(tabId);
        if (!tab) return null;
        return (
          <TerminalView
            key={tabId}
            tabId={tabId}
            sessionId={tab.sessionId}
            channelId={tab.channelId}
            active={tabId === activeTabId}
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
  const tabs = useTerminalStore((s) => s.tabs);
  const tabOrder = useTerminalStore((s) => s.tabOrder);

  const isActive = tabOrder.some((tid) => {
    const t = tabs.get(tid);
    return t?.serverId === id && (t.status === "connected" || t.status === "connecting");
  });

  const handleClick = async () => {
    if (!masterPasswordSet) {
      toast("Master password required", { variant: "warning" });
      return;
    }

    if (isActive) return;

    toast("Connecting...", { description: `Establishing SSH session to ${server.host}`, variant: "default" });

    try {
      const tabId = crypto.randomUUID();
      const channel = new Channel<import("./types").ChannelOutput>();

      channel.onmessage = (output: import("./types").ChannelOutput) => {
        terminalManager.writeByChannel(output.channel_id, new Uint8Array(output.data));
      };

      const sessionId = await invoke<string>("ssh_connect", {
        serverId: id,
        outputChannel: channel,
      });

      setChannel(sessionId, channel);

      addTab({
        tabId,
        sessionId,
        serverId: id,
        serverName: id,
        host: server.host,
        channelId: "",
        status: "connecting",
      });

      toast("Session initiated", { description: `Connecting to ${server.host}...`, variant: "default" });
    } catch (err) {
      toast("Connection failed", { description: String(err), variant: "error" });
    }
  };

  return (
    <button
      className={`dashboard-server-card ${isActive ? "dashboard-server-card--active" : ""}`}
      onClick={handleClick}
      disabled={!masterPasswordSet || isActive}
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
      {!isActive && (
        <svg className="dashboard-server-card-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2L10 6L2 10V2Z" fill="currentColor" opacity="0.4" />
        </svg>
      )}
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
      <TabContextMenu />

      <ServerModal />
      <MasterPasswordModal />
      <BlacklistModal />

      <Toaster />
    </div>
  );
}
