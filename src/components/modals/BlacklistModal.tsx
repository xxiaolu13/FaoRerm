import { useEffect, useState } from "react";
import { useUIStore } from "../../stores/uiStore";
import { useServerStore } from "../../stores/serverStore";
import { useT } from "../../stores/i18nStore";

export function BlacklistModal() {
  const show = useUIStore((s) => s.blacklistModal);
  const hideBlacklistModal = useUIStore((s) => s.hideBlacklistModal);
  const blacklist = useServerStore((s) => s.blacklist);
  const loadBlacklist = useServerStore((s) => s.loadBlacklist);
  const addBlacklistItem = useServerStore((s) => s.addBlacklistItem);
  const t = useT();

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
          <h2 className="modal-title">{t("blacklistModal.title")}</h2>
          <p className="modal-desc">{t("blacklistModal.desc")}</p>
        </div>

        <div className="modal-body">
          <div className="form-row">
            <div className="form-group form-group--row">
              <input
                className="input"
                placeholder={t("blacklistModal.patternPlaceholder")}
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
              />
              <button className="btn btn--primary" onClick={handleAdd}>
                {t("blacklistModal.add")}
              </button>
            </div>
          </div>

          <div className="blacklist-items">
            {(!blacklist?.contains || blacklist.contains.length === 0) && (
              <span className="empty-hint">{t("blacklistModal.empty")}</span>
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
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
