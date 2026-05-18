import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useServerStore } from "../stores/serverStore";
import { useTerminalStore } from "../stores/terminalStore";

export function QuickCommands() {
  const quickCommands = useServerStore((s) => s.quickCommands);
  const addQuickCommand = useServerStore((s) => s.addQuickCommand);
  const deleteQuickCommand = useServerStore((s) => s.deleteQuickCommand);
  const activeSession = useTerminalStore((s) => s.activeSession);

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
    if (!activeSession) return;

    const expanded = cmd.replace(/\\n/g, "\n");
    const encoder = new TextEncoder();
    const data = Array.from(encoder.encode(expanded));
    invoke("ssh_send_data", {
      sessionId: activeSession.sessionId,
      channelId: activeSession.channelId,
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
          disabled={!activeSession}
          title={activeSession ? `Send: ${cmd.replace(/\\n/g, " ↵ ")}` : "No active terminal"}
        >
          <div className="quick-command-info">
            <span className="quick-command-desc">{desc}</span>
            <code className="quick-command-cmd">{cmd.replace(/\\n/g, " ↵\n")}</code>
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
          <textarea
            className="input input--sm quick-command-textarea"
            placeholder="Command (use \n for multiple lines)"
            value={newCmd}
            onChange={(e) => setNewCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAdd();
              }
              if (e.key === "Escape") setShowAdd(false);
            }}
            rows={3}
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
