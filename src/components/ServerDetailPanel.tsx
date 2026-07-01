import { useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useServerStore } from "../stores/serverStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useUIStore } from "../stores/uiStore";
import { toast } from "../stores/toastStore";
import { terminalManager } from "../terminal/terminalManager";
import { useT, t as _t } from "../stores/i18nStore";
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
  const t = useT();

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
      toast(_t("toast.masterPasswordRequired"), { variant: "warning" });
      return;
    }

    setConnecting(true);
    toast(_t("toast.connecting"), { description: _t("toast.establishingSshTo", { host: server.host }), variant: "default" });

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

      toast(_t("toast.sessionInitiated"), { description: _t("toast.connectingToHost", { host: server.host }), variant: "default" });
    } catch (err) {
      toast(_t("toast.connectionFailed"), { description: String(err), variant: "error" });
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
        const tItem = tabs.get(tid);
        return tItem?.sessionId === tab.sessionId;
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

      toast(_t("toast.newShellOpened"), { description: _t("toast.shellNOnHost", { host: server.host, n: shellCount }), variant: "success" });
    } catch (err) {
      toast(_t("toast.failedToOpenShell"), { description: String(err), variant: "error" });
    }
  };

  return (
    <div className="server-detail-panel">
      <div className="server-detail-header">
        <div className="server-detail-header-left">
          <button
            className="btn-icon"
            onClick={() => setSelectedServerId(null)}
            title={t("serverDetail.back")}
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
          title={t("serverDetail.edit")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 2L14 4L5 13L2 14L3 11L12 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="server-detail-body">
        <div className="server-detail-grid">
          <div className="server-detail-field">
            <span className="server-detail-label">{t("serverDetail.host")}</span>
            <code className="server-detail-value">{server.host}</code>
          </div>
          <div className="server-detail-field">
            <span className="server-detail-label">{t("serverDetail.port")}</span>
            <code className="server-detail-value">{server.port}</code>
          </div>
          <div className="server-detail-field">
            <span className="server-detail-label">{t("serverDetail.user")}</span>
            <code className="server-detail-value">{server.user}</code>
          </div>
          <div className="server-detail-field">
            <span className="server-detail-label">{t("serverDetail.auth")}</span>
            <code className="server-detail-value">{server.method}</code>
          </div>
          <div className="server-detail-field">
            <span className="server-detail-label">{t("serverDetail.insecureAlgos")}</span>
            <code className="server-detail-value">{server.allow_insecure_algos ? t("serverDetail.yes") : t("serverDetail.no")}</code>
          </div>
          {server.inactivity_timeout != null && (
            <div className="server-detail-field">
              <span className="server-detail-label">{t("serverDetail.inactivityTimeout")}</span>
              <code className="server-detail-value">{server.inactivity_timeout}s</code>
            </div>
          )}
          {server.keepalive_interval != null && (
            <div className="server-detail-field">
              <span className="server-detail-label">{t("serverDetail.keepalive")}</span>
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
                {t("serverDetail.connecting")}
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2L12 7L2 12V2Z" fill="currentColor" />
                </svg>
                {t("serverDetail.connect")}
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
              {t("serverDetail.openNewShell")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
