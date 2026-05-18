import { useEffect, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useServerStore } from "../stores/serverStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useUIStore } from "../stores/uiStore";
import { terminalManager } from "../terminal/terminalManager";

export function ServerList() {
  const servers = useServerStore((s) => s.servers);
  const loadServers = useServerStore((s) => s.loadServers);
  const deleteServer = useServerStore((s) => s.deleteServer);

  const addTab = useTerminalStore((s) => s.addTab);
  const setChannel = useTerminalStore((s) => s.setChannel);
  const showServerModal = useUIStore((s) => s.showServerModal);
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);
  const checkMasterPassword = useServerStore((s) => s.checkMasterPassword);

  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    checkMasterPassword().then(() => {
      loadServers();
    });
  }, []);

  const handleConnect = async (serverId: string, serverName: string, host: string) => {
    if (!masterPasswordSet) return;

    setConnecting(serverId);
    try {
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

      const sessionId = await invoke<string>("ssh_connect", { serverId, outputChannel: channel });
      resolvedSessionId = sessionId;

      for (const data of outputBuffer) {
        terminalManager.write(sessionId, new Uint8Array(data));
      }
      outputBuffer.length = 0;

      setChannel(sessionId, channel);
      addTab({
        sessionId,
        serverId,
        serverName,
        host,
        channelId: "",
        status: "connecting",
      });
    } catch (err) {
      console.error("Connect failed:", err);
    } finally {
      setConnecting(null);
    }
  };

  const handleDelete = async (serverId: string) => {
    try {
      await deleteServer(serverId);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const serverEntries = Object.entries(servers);

  return (
    <div className="server-list">
      <div className="section-header">
        <span className="section-title">Servers</span>
        <button
          className="btn-icon"
          onClick={() => showServerModal("add")}
          title="Add server"
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
          <p>No servers configured</p>
          <button
            className="btn btn--sm btn--primary"
            onClick={() => showServerModal("add")}
          >
            Add your first server
          </button>
        </div>
      )}

      <div className="server-items">
        {serverEntries.map(([id, server]) => (
          <div key={id} className="server-item">
            <button
              className="server-connect"
              onClick={() => handleConnect(id, id, server.host)}
              disabled={connecting === id || !masterPasswordSet}
              title={
                !masterPasswordSet
                  ? "Unlock master password first"
                  : `Connect to ${server.host}`
              }
            >
              <span className="server-icon">
                {connecting === id ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    className="spinner"
                  >
                    <circle
                      cx="7"
                      cy="7"
                      r="5.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeDasharray="28"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M2 2L12 7L2 12V2Z"
                      fill="currentColor"
                    />
                  </svg>
                )}
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
              title="Edit server"
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
              title="Delete server"
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
