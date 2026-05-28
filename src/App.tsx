import { useEffect, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useTerminalStore } from "./stores/terminalStore";
import { useUIStore } from "./stores/uiStore";
import { useServerStore } from "./stores/serverStore";
import { useSshEvents } from "./hooks/useSshEvents";
import { useThemeStore } from "./stores/themeStore";
import { Sidebar } from "./components/Sidebar";
import { TabBar, TabContextMenu } from "./components/TabBar";
import { TerminalView } from "./components/TerminalView";
import { QuickCommands } from "./components/QuickCommands";
import { ManagementPage } from "./components/ManagementPage";
import { LockScreen } from "./components/LockScreen";
import { useAIStore } from "./stores/aiStore";
import { Toaster } from "./components/Toaster";
import { ServerModal } from "./components/modals/ServerModal";
import { MasterPasswordModal } from "./components/modals/MasterPasswordModal";
import { BlacklistModal } from "./components/modals/BlacklistModal";
import { ZmodemTransferBar, ZmodemEventHandler } from "./components/ZmodemTransferBar";
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

function RightDrawerToggle() {
  const rightDrawerOpen = useUIStore((s) => s.rightDrawerOpen);
  const toggleRightDrawer = useUIStore((s) => s.toggleRightDrawer);

  return (
    <button
      className="right-drawer-toggle"
      onClick={toggleRightDrawer}
      title={rightDrawerOpen ? "Close panel (Ctrl+Shift+P)" : "Quick Commands (Ctrl+Shift+P)"}
    >
      {rightDrawerOpen ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 3L5 7L9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3.5L7 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M3 7L9 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M3 10.5L6 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M9 5L12 7.5L9 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function RightDrawer() {
  const rightDrawerOpen = useUIStore((s) => s.rightDrawerOpen);
  const [activeTab, setActiveTab] = useState<"commands" | "ai">("commands");
  const activeSession = useTerminalStore((s) => s.activeSession);
  const channelId = activeSession?.channelId || "";
  const convMessages = useAIStore((s) => s.conversations[channelId]?.messages);
  const convLoading = useAIStore((s) => s.conversations[channelId]?.loading ?? false);
  const confirmRequest = useAIStore((s) => s.confirmRequest);
  const ask = useAIStore((s) => s.ask);
  const cancelAsk = useAIStore((s) => s.cancelAsk);
  const confirmDecision = useAIStore((s) => s.confirmDecision);
  const clearMessages = useAIStore((s) => s.clearMessages);
  const [input, setInput] = useState("");

  const loading = convLoading;

  const handleAsk = () => {
    if (!input.trim() || !activeSession || loading) return;
    ask(activeSession.sessionId, channelId, input.trim());
    setInput("");
  };

  const handleCancel = () => {
    cancelAsk(channelId);
  };

  return (
    <div className={`right-drawer-wrapper ${rightDrawerOpen ? "right-drawer-wrapper--open" : ""}`}>
      <div className="right-drawer">
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
            >
              AI
            </button>
          </div>
        </div>
        <div className="right-drawer-content">
          {activeTab === "commands" && <QuickCommands />}
          {activeTab === "ai" && (
            <div className="right-drawer-section ai-panel">
              {confirmRequest && (
                <div className="ai-confirm-bar">
                  <div className="ai-confirm-header">
                    <span className="ai-confirm-badge">Permission Required</span>
                    <span className="ai-confirm-tool">{confirmRequest.tool}</span>
                  </div>
                  {confirmRequest.description && (
                    <div className="ai-confirm-desc">{confirmRequest.description}</div>
                  )}
                  <div className="ai-confirm-input">
                    <code>{formatToolInput(confirmRequest.tool, confirmRequest.input)}</code>
                  </div>
                  <div className="ai-confirm-actions">
                    <button
                      className="btn btn--sm btn--primary"
                      onClick={() => confirmDecision(confirmRequest.requestId, true)}
                    >
                      Allow
                    </button>
                    <button
                      className="btn btn--sm btn--danger"
                      onClick={() => confirmDecision(confirmRequest.requestId, false)}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              )}
              <div className="ai-messages">
                {(convMessages || []).length === 0 && (
                  <div className="ai-empty">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 2a8 8 0 0 1 8 8c0 3.4-2.1 6.3-5 7.5V20a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2.5C6.1 16.3 4 13.4 4 10a8 8 0 0 1 8-8z" />
                      <path d="M9 22h6" />
                    </svg>
                    <span>Ask AI about your terminal session</span>
                  </div>
                )}
                {(convMessages || []).map((msg) => (
                  <div key={msg.id} className={`ai-message ai-message--${msg.role}`}>
                    <div className="ai-message-header">
                      <span className="ai-message-role">{msg.role === "user" ? "You" : "AI"}</span>
                      {msg.role === "assistant" && msg.status === "streaming" && (
                        <span className="ai-message-status">
                          <span className="ai-pulse" />
                          Working
                        </span>
                      )}
                      {msg.role === "assistant" && msg.status === "error" && (
                        <span className="ai-message-status ai-message-status--error">Error</span>
                      )}
                    </div>
                    {msg.thinking && (
                      <details className="ai-thinking">
                        <summary>Thinking...</summary>
                        <pre className="ai-thinking-content">{msg.thinking}</pre>
                      </details>
                    )}
                    {msg.toolCalls.length > 0 && (
                      <div className="ai-tool-calls">
                        {msg.toolCalls.map((tc) => (
                          <div key={tc.id} className={`ai-tool-call ai-tool-call--${tc.status}`}>
                            <div className="ai-tool-call-header">
                              <span className="ai-tool-call-name">{tc.name}</span>
                              <span className="ai-tool-call-status">
                                {tc.status === "running" && "⏳"}
                                {tc.status === "done" && "✓"}
                                {tc.status === "error" && "✗"}
                                {tc.durationMs != null && ` ${tc.durationMs}ms`}
                              </span>
                            </div>
                            <code className="ai-tool-call-input">{formatToolInput(tc.name, tc.input)}</code>
                            {tc.result && (
                              <details className="ai-tool-call-result">
                                <summary>Output</summary>
                                <pre>{truncate(tc.result, 500)}</pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.content && (
                      <pre className="ai-message-content">{msg.content}</pre>
                    )}
                    {msg.error && (
                      <div className="ai-message-error">{msg.error}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="ai-input-bar">
                <input
                  className="ai-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAsk();
                    }
                  }}
                  placeholder={activeSession ? "Ask AI..." : "No active terminal"}
                  disabled={!activeSession}
                />
                {loading ? (
                  <button
                    className="btn btn--danger btn--sm"
                    onClick={handleCancel}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={handleAsk}
                    disabled={!activeSession || !input.trim()}
                  >
                    Send
                  </button>
                )}
                {(convMessages || []).length > 0 && !loading && (
                  <button
                    className="btn btn--sm"
                    onClick={() => clearMessages(channelId)}
                    title="Clear conversation"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 3H10M5 3V2H7V3M3 3V10H9V3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatToolInput(toolName: string, input: unknown): string {
  if (!input) return "";
  if (typeof input === "string") return input;
  try {
    const obj = input as Record<string, unknown>;
    if (toolName === "TerminalType" && obj.command) return String(obj.command);
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

function TerminalArea() {
  const tabs = useTerminalStore((s) => s.tabs);
  const tabOrder = useTerminalStore((s) => s.tabOrder);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const activeSection = useUIStore((s) => s.activeSection);
  const servers = useServerStore((s) => s.servers);

  const isServersSection = activeSection === "servers";

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
            active={tabId === activeTabId && isServersSection}
          />
        );
      })}

      {activeSection === "management" && (
        <div className="terminal-area-overlay">
          <ManagementPage />
        </div>
      )}

      {isServersSection && tabOrder.length === 0 && (
        <div className="dashboard">
          <div className="dashboard-hero">
            <img className="dashboard-logo" src="/logo.png" alt="FaoRerm" />
            <h2 className="dashboard-title">Welcome to FaoRerm</h2>
            <p className="dashboard-desc">
              Connect to a server to start a remote terminal session.
            </p>
          </div>
          {Object.entries(servers).length > 0 && (
            <div className="dashboard-servers">
              <h3 className="dashboard-section-title">Quick Connect</h3>
              <div className="dashboard-server-grid">
                {Object.entries(servers).slice(0, 6).map(([id, server]) => (
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
              <div className="shortcut-item">
                <kbd className="shortcut-key">Ctrl+Shift+C</kbd>
                <span className="shortcut-desc">Copy from terminal</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ServerCard({ id, server }: { id: string; server: import("./types").ServerConfig }) {
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);
  const addTab = useTerminalStore((s) => s.addTab);
  const setChannel = useTerminalStore((s) => s.setChannel);
  const setActiveSection = useUIStore((s) => s.setActiveSection);

  const handleClick = async () => {
    if (!masterPasswordSet) {
      toast("Master password required", { variant: "warning" });
      return;
    }

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

      setActiveSection("servers");

      toast("Session initiated", { description: `Connecting to ${server.host}...`, variant: "default" });
    } catch (err) {
      toast("Connection failed", { description: String(err), variant: "error" });
    }
  };

  return (
    <button
      className="dashboard-server-card"
      onClick={handleClick}
      disabled={!masterPasswordSet}
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
      <svg className="dashboard-server-card-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 2L10 6L2 10V2Z" fill="currentColor" opacity="0.4" />
      </svg>
    </button>
  );
}

function GlobalKeyboardShortcuts() {
  const activateLockScreen = useUIStore((s) => s.activateLockScreen);
  const toggleRightDrawer = useUIStore((s) => s.toggleRightDrawer);
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);
  const activeTabId = useTerminalStore((s) => s.activeTabId);

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
      if (e.ctrlKey && e.shiftKey && e.key === "C") {
        e.preventDefault();
        if (activeTabId) {
          const term = terminalManager.getTerminal(activeTabId);
          if (term && term.hasSelection()) {
            const selection = term.getSelection();
            if (selection) {
              navigator.clipboard.writeText(selection).catch(() => {});
            }
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activateLockScreen, toggleRightDrawer, masterPasswordSet, activeTabId]);

  return null;
}

export default function App() {
  useSshEvents();
  const loadTheme = useThemeStore((s) => s.loadTheme);
  const initConfirmListener = useAIStore((s) => s.initConfirmListener);
  const loadProviders = useAIStore((s) => s.loadProviders);

  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  useEffect(() => {
    loadProviders().catch(() => {});
    let unlisten: (() => void) | undefined;
    initConfirmListener().then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  return (
    <div className="app">
      <GlobalKeyboardShortcuts />
      <ZmodemEventHandler />
      <ActivityBar />
      <Sidebar />
      <main className="main-content">
        <TabBar />
        <ZmodemTransferBar />
        <TerminalArea />
        <RightDrawerToggle />
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
