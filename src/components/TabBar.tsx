import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTerminalStore } from "../stores/terminalStore";
import { useUIStore } from "../stores/uiStore";
import { toast } from "../stores/toastStore";
import { terminalManager } from "../terminal/terminalManager";

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
  const showContextMenu = useUIStore((s) => s.showContextMenu);
  const enterServers = useUIStore((s) => s.enterServers);

  const handleClose = (tabId: string) => {
    const tab = tabs.get(tabId);
    if (!tab) return;

    if (tab.channelId) {
      invoke("ssh_close_channel", { sessionId: tab.sessionId, channelId: tab.channelId }).catch(() => {});
    } else if (tab.status === "connecting") {
      invoke("ssh_disconnect", { sessionId: tab.sessionId }).catch(() => {});
    }

    if (hostKeyModal?.sessionId === tab.sessionId) hideHostKeyModal();
    if (keyboardAuthModal?.sessionId === tab.sessionId) hideKeyboardAuthModal();

    removeTab(tabId);
    toast("Tab closed", { variant: "default", duration: 2000 });
  };

  // 仅切换 Tab，绝不触发侧边栏 toggle（穿透 Bug 修复）。
  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    enterServers();
  };

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const tab = tabs.get(tabId);
    if (!tab) return;
    showContextMenu(e.clientX, e.clientY, tabId, tab.sessionId, tab.serverId);
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
      {tabOrder.map((tabId) => {
        const tab = tabs.get(tabId);
        if (!tab) return null;

        const isActive = tabId === activeTabId;

        return (
          <div
            key={tabId}
            className={`tab-item ${isActive ? "tab-item--active" : ""}`}
            onClick={() => handleTabClick(tabId)}
            onContextMenu={(e) => handleContextMenu(e, tabId)}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleTabClick(tabId);
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
                handleClose(tabId);
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

export function TabContextMenu() {
  const contextMenu = useUIStore((s) => s.contextMenu);
  const hideContextMenu = useUIStore((s) => s.hideContextMenu);
  const tabs = useTerminalStore((s) => s.tabs);
  const tabOrder = useTerminalStore((s) => s.tabOrder);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const hostKeyModal = useUIStore((s) => s.hostKeyModal);
  const keyboardAuthModal = useUIStore((s) => s.keyboardAuthModal);
  const hideHostKeyModal = useUIStore((s) => s.hideHostKeyModal);
  const hideKeyboardAuthModal = useUIStore((s) => s.hideKeyboardAuthModal);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => hideContextMenu();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideContextMenu();
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu, hideContextMenu]);

  if (!contextMenu) return null;

  const { x, y, tabId, sessionId, serverId } = contextMenu;
  const tab = tabs.get(tabId);
  if (!tab) return null;

  const sessionTabs = tabOrder.filter((tid) => {
    const t = tabs.get(tid);
    return t?.sessionId === sessionId;
  });

  const otherTabs = tabOrder.filter((tid) => tid !== tabId);
  const rightTabs = tabOrder.slice(tabOrder.indexOf(tabId) + 1);

  const handleNewShell = async () => {
    hideContextMenu();

    const channelId = crypto.randomUUID();
    const newTabId = crypto.randomUUID();

    const currentTerm = terminalManager.getTerminal(tabId);
    const cols = currentTerm?.cols ?? 80;
    const rows = currentTerm?.rows ?? 24;

    try {
      await invoke("ssh_open_shell", {
        sessionId,
        channelId,
        cols,
        rows,
      });

      terminalManager.setChannelId(newTabId, channelId);

      const shellCount = sessionTabs.length + 1;

      useTerminalStore.getState().addTab({
        tabId: newTabId,
        sessionId,
        serverId,
        serverName: `${serverId} (#${shellCount})`,
        host: tab.host,
        channelId,
        status: "connecting",
      });

      toast("New shell opened", { description: `Shell #${shellCount} on ${tab.host}`, variant: "success" });
    } catch (err) {
      toast("Failed to open shell", { description: String(err), variant: "error" });
    }
  };

  const handleCloseTab = () => {
    hideContextMenu();
    const t = tabs.get(tabId);
    if (t?.channelId) {
      invoke("ssh_close_channel", { sessionId, channelId: t.channelId }).catch(() => {});
    } else if (t?.status === "connecting") {
      invoke("ssh_disconnect", { sessionId }).catch(() => {});
    }
    if (hostKeyModal?.sessionId === sessionId) hideHostKeyModal();
    if (keyboardAuthModal?.sessionId === sessionId) hideKeyboardAuthModal();
    removeTab(tabId);
  };

  const handleCloseOthers = () => {
    hideContextMenu();
    for (const tid of otherTabs) {
      const t = tabs.get(tid);
      if (t?.channelId) {
        invoke("ssh_close_channel", { sessionId: t.sessionId, channelId: t.channelId }).catch(() => {});
      } else if (t?.status === "connecting") {
        invoke("ssh_disconnect", { sessionId: t.sessionId }).catch(() => {});
      }
      removeTab(tid);
    }
    setActiveTab(tabId);
  };

  const handleCloseToRight = () => {
    hideContextMenu();
    for (const tid of rightTabs) {
      const t = tabs.get(tid);
      if (t?.channelId) {
        invoke("ssh_close_channel", { sessionId: t.sessionId, channelId: t.channelId }).catch(() => {});
      } else if (t?.status === "connecting") {
        invoke("ssh_disconnect", { sessionId: t.sessionId }).catch(() => {});
      }
      removeTab(tid);
    }
  };

  const canNewShell = tab.status === "connected";

  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className={`context-menu-item ${!canNewShell ? "context-menu-item--disabled" : ""}`}
        onClick={canNewShell ? handleNewShell : undefined}
        disabled={!canNewShell}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 2V12M2 7H12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        Open New Shell
      </button>
      <div className="context-menu-separator" />
      <button className="context-menu-item" onClick={handleCloseTab}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        Close Tab
      </button>
      <button
        className={`context-menu-item ${otherTabs.length === 0 ? "context-menu-item--disabled" : ""}`}
        onClick={otherTabs.length > 0 ? handleCloseOthers : undefined}
        disabled={otherTabs.length === 0}
      >
        Close Others
      </button>
      <button
        className={`context-menu-item ${rightTabs.length === 0 ? "context-menu-item--disabled" : ""}`}
        onClick={rightTabs.length > 0 ? handleCloseToRight : undefined}
        disabled={rightTabs.length === 0}
      >
        Close to Right
      </button>
    </div>
  );
}
