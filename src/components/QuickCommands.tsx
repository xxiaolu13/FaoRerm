import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useServerStore } from "../stores/serverStore";
import { useTerminalStore } from "../stores/terminalStore";

export function QuickCommands() {
  const quickCommands = useServerStore((s) => s.quickCommands);
  const addQuickCommand = useServerStore((s) => s.addQuickCommand);
  const deleteQuickCommand = useServerStore((s) => s.deleteQuickCommand);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const tabs = useTerminalStore((s) => s.tabs);

  const [newDesc, setNewDesc] = useState("");
  const [newCmd, setNewCmd] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const handleAdd = async () => {
    if (!newDesc.trim() || !newCmd.trim()) return;
    try {
      await addQuickCommand(newDesc.trim(), newCmd.trim());
      setNewDesc("");
      setNewCmd("");
      setShowAdd(false);
    } catch {}
  };

  const sendCommand = (cmd: string) => {
    if (!activeTabId) return;
    const tab = tabs.get(activeTabId);
    if (!tab || !tab.channelId) return;

    const encoder = new TextEncoder();
    const data = Array.from(encoder.encode(cmd + "\n"));
    invoke("ssh_send_data", {
      sessionId: tab.sessionId,
      channelId: tab.channelId,
      data,
    }).catch(console.error);
  };

  const entries = Object.entries(quickCommands);

  return (
    <div className="right-drawer-section">
      <div className="right-drawer-section-header">
        <span className="right-drawer-section-title">Quick Commands</span>
      </div>

      {entries.length === 0 && (
        <span className="empty-hint">No saved commands</span>
      )}
      {entries.map(([desc, cmd]) => (
        <button
          key={desc}
          className="quick-command-item"
          onClick={() => sendCommand(cmd)}
          disabled={!activeTabId}
          title={activeTabId ? `Send: ${cmd}` : "No active terminal"}
        >
          <div className="quick-command-info">
            <span className="quick-command-desc">{desc}</span>
            <code className="quick-command-cmd">{cmd}</code>
          </div>
          <button
            className="btn-icon btn-icon--sm btn-icon--danger"
            onClick={(e) => {
              e.stopPropagation();
              deleteQuickCommand(desc);
            }}
            title="Delete command"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 3L9 9M9 3L3 9"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </button>
      ))}

      {showAdd ? (
        <div className="quick-command-add-form">
          <input
            className="input input--sm"
            placeholder="Description"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") setShowAdd(false);
            }}
          />
          <input
            className="input input--sm"
            placeholder="Command"
            value={newCmd}
            onChange={(e) => setNewCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") setShowAdd(false);
            }}
          />
          <div className="quick-command-add-actions">
            <button className="btn btn--sm btn--primary" onClick={handleAdd}>
              Save
            </button>
            <button
              className="btn btn--sm btn--ghost"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn--sm btn--ghost btn--full"
          onClick={() => setShowAdd(true)}
        >
          + Add Command
        </button>
      )}
    </div>
  );
}
