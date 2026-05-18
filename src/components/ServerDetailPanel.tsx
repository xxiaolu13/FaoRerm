import { useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useServerStore } from "../stores/serverStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useUIStore } from "../stores/uiStore";
import { toast } from "../stores/toastStore";
import { terminalManager } from "../terminal/terminalManager";
import type { ChannelOutput } from "../types";

export function ServerDetailPanel() {
  const selectedServerId = useUIStore((s) => s.selectedServerId);
  const servers = useServerStore((s) => s.servers);
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);
  const showServerModal = useUIStore((s) => s.showServerModal);
  const addTab = useTerminalStore((s) => s.addTab);
  const setChannel = useTerminalStore((s) => s.setChannel);
  const tabs = useTerminalStore((s) => s.tabs);
  const tabOrder = useTerminalStore((s) => s.tabOrder);
  const setSelectedServerId = useUIStore((s) => s.setSelectedServerId);

  const [connecting, setConnecting] = useState(false);

  if (!selectedServerId) return null;

  const server = servers[selectedServerId];
  if (!server) return null;

  const existingSessionTab = tabOrder.find((tid) => {
    const tab = tabs.get(tid);
    return tab?.serverId === selectedServerId && (tab.status === "connected" || tab.status === "connecting");
  });

  const handleConnect = async () => {
    if (!masterPasswordSet) {
      toast("Master password required", { variant: "warning" });
      return;
    }

    setConnecting(true);
    toast("Connecting...", { description: `Establishing SSH session to ${server.host}`, variant: "default" });

    try {
      const tabId = crypto.randomUUID();
      const channel = new Channel<ChannelOutput>();

      channel.onmessage = (output: ChannelOutput) => {
        terminalManager.writeByChannel(output.channel_id, new Uint8Array(output.data));
      };

      const sessionId = await invoke<string>("ssh_connect", {
        serverId: selectedServerId,
        outputChannel: channel,
      });

      setChannel(sessionId, channel);

      addTab({
        tabId,
        sessionId,
        serverId: selectedServerId,
        serverName: selectedServerId,
        host: server.host,
        channelId: "",
        status: "connecting",
      });

      toast("Session initiated", { description: `Connecting to ${server.host}...`, variant: "default" });
    } catch (err) {
      toast("Connection failed", { description: String(err), variant: "error" });
    } finally {
      setConnecting(false);
    }
  };

  const handleNewShell = async () => {
    if (!existingSessionTab) return;
    const tab = tabs.get(existingSessionTab);
    if (!tab) return;

    const newTabId = crypto.randomUUID();
    const channelId = crypto.randomUUID();

    try {
      await invoke("ssh_open_shell", {
        sessionId: tab.sessionId,
        channelId,
        cols: 80,
        rows: 24,
      });

      terminalManager.setChannelId(newTabId, channelId);

      const shellCount = tabOrder.filter((tid) => {
        const t = tabs.get(tid);
        return t?.sessionId === tab.sessionId;
      }).length + 1;

      addTab({
        tabId: newTabId,
        sessionId: tab.sessionId,
        serverId: selectedServerId,
        serverName: `${selectedServerId} (#${shellCount})`,
        host: server.host,
        channelId,
        status: "connecting",
      });

      toast("New shell opened", { description: `Shell #${shellCount} on ${server.host}`, variant: "success" });
    } catch (err) {
      toast("Failed to open shell", { description: String(err), variant: "error" });
    }
  };

  return (
    <div className="server-detail-panel">
      <div className="server-detail-header">
        <div className="server-detail-header-left">
          <button
            className="btn-icon"
            onClick={() => setSelectedServerId(null)}
            title="Back to dashboard"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h2 className="server-detail-name">{selectedServerId}</h2>
        </div>
        <button
          className="btn-icon"
          onClick={() => showServerModal("edit", server)}
          title="Edit server"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 2L14 4L5 13L2 14L3 11L12 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="server-detail-body">
        <div className="server-detail-grid">
          <div className="server-detail-field">
            <span className="server-detail-label">Host</span>
            <code className="server-detail-value">{server.host}</code>
          </div>
          <div className="server-detail-field">
            <span className="server-detail-label">Port</span>
            <code className="server-detail-value">{server.port}</code>
          </div>
          <div className="server-detail-field">
            <span className="server-detail-label">User</span>
            <code className="server-detail-value">{server.user}</code>
          </div>
          <div className="server-detail-field">
            <span className="server-detail-label">Auth</span>
            <code className="server-detail-value">{server.method}</code>
          </div>
          <div className="server-detail-field">
            <span className="server-detail-label">Insecure Algos</span>
            <code className="server-detail-value">{server.allow_insecure_algos ? "Yes" : "No"}</code>
          </div>
          {server.inactivity_timeout != null && (
            <div className="server-detail-field">
              <span className="server-detail-label">Inactivity Timeout</span>
              <code className="server-detail-value">{server.inactivity_timeout}s</code>
            </div>
          )}
          {server.keepalive_interval != null && (
            <div className="server-detail-field">
              <span className="server-detail-label">Keepalive</span>
              <code className="server-detail-value">{server.keepalive_interval}s</code>
            </div>
          )}
        </div>

        <div className="server-detail-actions">
          <button
            className="btn btn--primary btn--full"
            onClick={handleConnect}
            disabled={connecting || !masterPasswordSet}
          >
            {connecting ? (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="spinner">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="28" strokeLinecap="round" />
                </svg>
                Connecting...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2L12 7L2 12V2Z" fill="currentColor" />
                </svg>
                Connect
              </>
            )}
          </button>

          {existingSessionTab && (
            <button
              className="btn btn--ghost btn--full"
              onClick={handleNewShell}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2V12M2 7H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Open New Shell
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
