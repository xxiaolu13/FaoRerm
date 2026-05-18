import { useEffect, useState } from "react";
import { useUIStore } from "../../stores/uiStore";
import { useServerStore } from "../../stores/serverStore";

export function BlacklistModal() {
  const show = useUIStore((s) => s.blacklistModal);
  const hideBlacklistModal = useUIStore((s) => s.hideBlacklistModal);
  const blacklist = useServerStore((s) => s.blacklist);
  const loadBlacklist = useServerStore((s) => s.loadBlacklist);
  const addBlacklistItem = useServerStore((s) => s.addBlacklistItem);

  const [newItem, setNewItem] = useState("");

  useEffect(() => {
    if (show) loadBlacklist();
  }, [show]);

  if (!show) return null;

  const handleAdd = async () => {
    if (!newItem.trim()) return;
    try {
      await addBlacklistItem(newItem.trim());
      setNewItem("");
    } catch {
      // Error logged in store
    }
  };

  return (
    <div className="modal-overlay" onClick={hideBlacklistModal}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Command Blacklist</h2>
          <p className="modal-desc">
            Commands containing these patterns will be blocked from execution
            on remote servers.
          </p>
        </div>

        <div className="modal-body">
          <div className="form-row">
            <div className="form-group form-group--row">
              <input
                className="input"
                placeholder="Add pattern (e.g., rm -rf)"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
              />
              <button className="btn btn--primary" onClick={handleAdd}>
                Add
              </button>
            </div>
          </div>

          <div className="blacklist-items">
            {(!blacklist?.contains || blacklist.contains.length === 0) && (
              <span className="empty-hint">No blacklist entries</span>
            )}
            {blacklist?.contains.map((item, i) => (
              <div key={i} className="blacklist-item">
                <code>{item}</code>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={hideBlacklistModal}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
