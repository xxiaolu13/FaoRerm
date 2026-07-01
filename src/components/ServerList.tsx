import { useEffect } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useServerStore } from "../stores/serverStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useUIStore } from "../stores/uiStore";
import { toast } from "../stores/toastStore";
import { terminalManager } from "../terminal/terminalManager";
import { useT, t as _t } from "../stores/i18nStore";
import type { ChannelOutput } from "../types";

export function ServerList() {
  const servers = useServerStore((s) => s.servers);
  const loadServers = useServerStore((s) => s.loadServers);
  const deleteServer = useServerStore((s) => s.deleteServer);
  const showServerModal = useUIStore((s) => s.showServerModal);
  const checkMasterPassword = useServerStore((s) => s.checkMasterPassword);
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);
  const addTab = useTerminalStore((s) => s.addTab);
  const setChannel = useTerminalStore((s) => s.setChannel);
  const enterServers = useUIStore((s) => s.enterServers);
  const t = useT();

  useEffect(() => {
    checkMasterPassword().then(() => {
      loadServers();
    });
  }, []);

  const handleDelete = async (serverId: string) => {
    try {
      await deleteServer(serverId);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleConnect = async (serverId: string) => {
    const server = servers[serverId];
    if (!server) return;

    if (!masterPasswordSet) {
      toast(_t("toast.masterPasswordRequired"), { variant: "warning" });
      return;
    }

    toast(_t("toast.connecting"), { description: _t("toast.establishingSshTo", { host: server.host }), variant: "default" });

    try {
      const tabId = crypto.randomUUID();
      const channel = new Channel<ChannelOutput>();

      channel.onmessage = (output: ChannelOutput) => {
        terminalManager.writeByChannel(output.channel_id, new Uint8Array(output.data));
      };

      const sessionId = await invoke<string>("ssh_connect", {
        serverId,
        outputChannel: channel,
      });

      setChannel(sessionId, channel);

      addTab({
        tabId,
        sessionId,
        serverId,
        serverName: serverId,
        host: server.host,
        channelId: "",
        status: "connecting",
      });

      enterServers();

      toast(_t("toast.sessionInitiated"), { description: _t("toast.connectingToHost", { host: server.host }), variant: "default" });
    } catch (err) {
      toast(_t("toast.connectionFailed"), { description: String(err), variant: "error" });
    }
  };

  const serverEntries = Object.entries(servers);

  return (
    <div className="server-list">
      <div className="section-header">
        <span className="section-title">{t("serverList.title")}</span>
        <button
          className="btn-icon"
          onClick={() => showServerModal("add")}
          title={t("serverList.addServer")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3V13M3 8H13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {serverEntries.length === 0 && (
        <div className="empty-list">
          <p>{t("serverList.empty")}</p>
          <button
            className="btn btn--sm btn--primary"
            onClick={() => showServerModal("add")}
          >
            {t("serverList.emptyHint")}
          </button>
        </div>
      )}

      <div className="server-items">
        {serverEntries.map(([id, server]) => (
          <div key={id} className="server-item">
            <button
              className="server-connect"
              onClick={() => handleConnect(id)}
              disabled={!masterPasswordSet}
              title={t("serverList.connectTo", { host: server.host })}
            >
              <span className="server-icon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="2" y="3" width="10" height="3" rx="0.5" stroke="currentColor" strokeWidth="1" />
                  <rect x="2" y="8" width="10" height="3" rx="0.5" stroke="currentColor" strokeWidth="1" />
                </svg>
              </span>
              <div className="server-info">
                <span className="server-name">{id}</span>
                <span className="server-detail">
                  {server.user}@{server.host}:{server.port}
                </span>
              </div>
            </button>

            <button
              className="btn-icon btn-icon--sm"
              onClick={() => showServerModal("edit", server)}
              title={t("serverList.edit")}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M10.5 1.5L12.5 3.5L4.5 11.5L1.5 12.5L2.5 9.5L10.5 1.5Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <button
              className="btn-icon btn-icon--sm btn-icon--danger"
              onClick={() => handleDelete(id)}
              title={t("serverList.delete")}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3 4.5H11M5.5 4.5V3C5.5 2.724 5.724 2.5 6 2.5H8C8.276 2.5 8.5 2.724 8.5 3V4.5M6 7V10.5M8 7V10.5M2.5 4.5L3.5 11.5H10.5L11.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
