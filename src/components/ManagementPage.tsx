import { useState } from "react";
import { useServerStore } from "../stores/serverStore";
import { useUIStore } from "../stores/uiStore";
import { toast } from "../stores/toastStore";
import { SettingsPage } from "./SettingsPage";
import { ConfigLayout } from "./ConfigLayout";

function QuickCommandsManagement() {
  const quickCommands = useServerStore((s) => s.quickCommands);
  const addQuickCommand = useServerStore((s) => s.addQuickCommand);
  const deleteQuickCommand = useServerStore((s) => s.deleteQuickCommand);
  const [newDesc, setNewDesc] = useState("");
  const [newCmd, setNewCmd] = useState("");
  const [editingDesc, setEditingDesc] = useState<string | null>(null);
  const [editCmd, setEditCmd] = useState("");
  const [saving, setSaving] = useState(false);

  const entries = Object.entries(quickCommands);

  const handleAdd = async () => {
    if (!newDesc.trim() || !newCmd.trim()) {
      toast("Fill in both fields", { variant: "warning" });
      return;
    }
    setSaving(true);
    try {
      await addQuickCommand(newDesc.trim(), newCmd.trim());
      setNewDesc("");
      setNewCmd("");
      toast("Command added", { variant: "success" });
    } catch (err) {
      toast("Failed to add command", { description: String(err), variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (desc: string) => {
    try {
      await deleteQuickCommand(desc);
      toast("Command deleted", { variant: "success" });
    } catch (err) {
      toast("Failed to delete", { description: String(err), variant: "error" });
    }
  };

  const handleStartEdit = (desc: string, cmd: string) => {
    setEditingDesc(desc);
    setEditCmd(cmd);
  };

  const handleSaveEdit = async () => {
    if (!editingDesc || !editCmd.trim()) return;
    setSaving(true);
    try {
      await addQuickCommand(editingDesc, editCmd.trim());
      setEditingDesc(null);
      setEditCmd("");
      toast("Command updated", { variant: "success" });
    } catch (err) {
      toast("Failed to update", { description: String(err), variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingDesc(null);
    setEditCmd("");
  };

  return (
    <ConfigLayout className="mgmt-section">
      <div className="mgmt-section-header">
        <h3 className="mgmt-section-title">Quick Commands</h3>
        <span className="mgmt-section-count">{entries.length} commands</span>
      </div>

      <div className="mgmt-add-row">
        <input
          className="input"
          placeholder="Description (e.g., Restart nginx)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <textarea
          className="input mgmt-cmd-textarea"
          placeholder="Command (use \n for multiple lines, e.g., cd /tmp\nls -la)"
          value={newCmd}
          onChange={(e) => setNewCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleAdd();
            }
          }}
          rows={3}
        />
        <button
          className="btn btn--primary"
          onClick={handleAdd}
          disabled={saving || !newDesc.trim() || !newCmd.trim()}
        >
          Add
        </button>
      </div>

      {entries.length === 0 && (
        <div className="mgmt-empty">
          <p>No quick commands yet. Add one above to get started.</p>
        </div>
      )}

      <div className="mgmt-table">
        {entries.map(([desc, cmd]) => (
          <div key={desc} className="mgmt-table-row">
            <div className="mgmt-table-cell mgmt-table-cell--desc">
              {editingDesc === desc ? (
                <input
                  className="input input--sm"
                  value={editCmd}
                  onChange={(e) => setEditCmd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit();
                    if (e.key === "Escape") handleCancelEdit();
                  }}
                  autoFocus
                />
              ) : (
                <span className="mgmt-table-label">{desc}</span>
              )}
            </div>
            <div className="mgmt-table-cell mgmt-table-cell--cmd">
              {editingDesc === desc ? null : (
                <code className="mgmt-table-code">{cmd.replace(/\\n/g, " ↵\n")}</code>
              )}
            </div>
            <div className="mgmt-table-cell mgmt-table-cell--actions">
              {editingDesc === desc ? (
                <>
                  <button
                    className="btn btn--sm btn--primary"
                    onClick={handleSaveEdit}
                    disabled={saving}
                  >
                    Save
                  </button>
                  <button className="btn btn--sm btn--ghost" onClick={handleCancelEdit}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn-icon btn-icon--sm"
                    onClick={() => handleStartEdit(desc, cmd)}
                    title="Edit command"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M10.5 1.5L12.5 3.5L4.5 11.5L1.5 12.5L2.5 9.5L10.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    className="btn-icon btn-icon--sm btn-icon--danger"
                    onClick={() => handleDelete(desc)}
                    title="Delete command"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 4.5H11M5.5 4.5V3C5.5 2.724 5.724 2.5 6 2.5H8C8.276 2.5 8.5 2.724 8.5 3V4.5M6 7V10.5M8 7V10.5M2.5 4.5L3.5 11.5H10.5L11.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </ConfigLayout>
  );
}

function BlacklistManagement() {
  const blacklist = useServerStore((s) => s.blacklist);
  const addBlacklistItem = useServerStore((s) => s.addBlacklistItem);
  const [newItem, setNewItem] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newItem.trim()) return;
    setSaving(true);
    try {
      await addBlacklistItem(newItem.trim());
      setNewItem("");
      toast("Blacklist entry added", { variant: "success" });
    } catch (err) {
      toast("Failed to add entry", { description: String(err), variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const items = blacklist?.contains || [];

  return (
    <ConfigLayout className="mgmt-section">
      <div className="mgmt-section-header">
        <h3 className="mgmt-section-title">Command Blacklist</h3>
        <span className="mgmt-section-count">{items.length} patterns</span>
      </div>

      <p className="mgmt-section-desc">
        Commands containing these patterns will be blocked from execution on remote servers.
      </p>

      <div className="mgmt-add-row">
        <input
          className="input"
          placeholder="Add pattern (e.g., rm -rf)"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <button
          className="btn btn--danger"
          onClick={handleAdd}
          disabled={saving || !newItem.trim()}
        >
          Block
        </button>
      </div>

      {items.length === 0 && (
        <div className="mgmt-empty">
          <p>No blacklist entries. Your servers accept all commands.</p>
        </div>
      )}

      <div className="mgmt-table">
        {items.map((item, i) => (
          <div key={i} className="mgmt-table-row">
            <div className="mgmt-table-cell mgmt-table-cell--desc">
              <code className="mgmt-table-code mgmt-table-code--danger">{item}</code>
            </div>
            <div className="mgmt-table-cell mgmt-table-cell--actions">
              <span className="mgmt-table-index">#{i + 1}</span>
            </div>
          </div>
        ))}
      </div>
    </ConfigLayout>
  );
}

export function ManagementPage() {
  const managementTab = useUIStore((s) => s.managementTab);
  const setManagementTab = useUIStore((s) => s.setManagementTab);

  const tabs: { key: "commands" | "blacklist" | "settings"; label: string }[] = [
    { key: "commands", label: "Quick Commands" },
    { key: "blacklist", label: "Blacklist" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="mgmt-page">
      <div className="mgmt-page-header">
        <h2 className="mgmt-page-title">Management</h2>
        <div className="mgmt-page-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`mgmt-page-tab ${managementTab === t.key ? "mgmt-page-tab--active" : ""}`}
              onClick={() => setManagementTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mgmt-page-body">
        {managementTab === "commands" && <QuickCommandsManagement />}
        {managementTab === "blacklist" && <BlacklistManagement />}
        {managementTab === "settings" && <SettingsPage />}
      </div>
    </div>
  );
}
