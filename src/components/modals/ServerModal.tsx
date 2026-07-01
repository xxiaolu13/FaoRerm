import { useState, useEffect } from "react";
import { useUIStore } from "../../stores/uiStore";
import { useServerStore } from "../../stores/serverStore";
import { useT } from "../../stores/i18nStore";
import type { ServerConfig } from "../../types";

const DEFAULT_SERVER: Partial<ServerConfig> = {
  host: "",
  port: 22,
  user: "root",
  method: "password",
  password: "",
  allow_insecure_algos: false,
  enabled: false,
  contains: [],
  inactivity_timeout: undefined,
  keepalive_interval: undefined,
};

export function ServerModal() {
  const modal = useUIStore((s) => s.serverModal);
  const hideServerModal = useUIStore((s) => s.hideServerModal);
  const addServer = useServerStore((s) => s.addServer);
  const masterPasswordSet = useServerStore((s) => s.masterPasswordSet);
  const t = useT();

  const isEdit = modal?.mode === "edit";
  const [form, setForm] = useState<Partial<ServerConfig>>(DEFAULT_SERVER);
  const [serverKey, setServerKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (modal) {
      if (isEdit && modal.server) {
        setForm({ ...modal.server });
        setServerKey(modal.server.id);
      } else {
        setForm(DEFAULT_SERVER);
        setServerKey("");
      }
      setError(null);
    }
  }, [modal]);

  if (!modal) return null;

  const handleSubmit = async () => {
    if (!serverKey.trim()) {
      setError(t("serverModal.serverNameRequired"));
      return;
    }
    if (!form.host?.trim()) {
      setError(t("serverModal.hostRequired"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await addServer(serverKey.trim(), { ...form, id: serverKey.trim() } as ServerConfig);
      hideServerModal();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const update = (field: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {isEdit ? t("serverModal.titleEdit") : t("serverModal.titleAdd")}
          </h2>
        </div>

        <div className="modal-body">
          {!masterPasswordSet && (
            <div className="alert alert--warning">
              {t("serverModal.masterNotSet")}
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{t("serverModal.serverName")}</label>
              <input
                className="input"
                placeholder={t("serverModal.serverNamePlaceholder")}
                value={serverKey}
                onChange={(e) => setServerKey(e.target.value)}
                disabled={isEdit}
              />
            </div>
          </div>

          <div className="form-row form-row--3">
            <div className="form-group form-group--grow">
              <label className="form-label">{t("serverModal.host")}</label>
              <input
                className="input"
                placeholder={t("serverModal.hostPlaceholder")}
                value={form.host || ""}
                onChange={(e) => update("host", e.target.value)}
              />
            </div>
            <div className="form-group form-group--fixed">
              <label className="form-label">{t("serverModal.port")}</label>
              <input
                className="input"
                type="number"
                value={form.port || 22}
                onChange={(e) => update("port", parseInt(e.target.value) || 22)}
              />
            </div>
            <div className="form-group form-group--fixed">
              <label className="form-label">{t("serverModal.username")}</label>
              <input
                className="input"
                placeholder="root"
                value={form.user || ""}
                onChange={(e) => update("user", e.target.value)}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{t("serverModal.authMethod")}</label>
              <div className="toggle-group">
                <button
                  className={`toggle-btn ${
                    form.method === "password" ? "toggle-btn--active" : ""
                  }`}
                  onClick={() => update("method", "password")}
                >
                  {t("serverModal.password")}
                </button>
                <button
                  className={`toggle-btn ${
                    form.method === "key" ? "toggle-btn--active" : ""
                  }`}
                  onClick={() => update("method", "key")}
                >
                  {t("serverModal.privateKey")}
                </button>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">
                {form.method === "password"
                  ? t("serverModal.password")
                  : t("serverModal.privateKeyPath")}
              </label>
              <input
                className="input"
                type={form.method === "password" ? "password" : "text"}
                placeholder={
                  form.method === "password"
                    ? t("serverModal.passwordPlaceholder")
                    : t("serverModal.privateKeyPathPlaceholder")
                }
                value={form.password || ""}
                onChange={(e) => update("password", e.target.value)}
              />
            </div>
          </div>

          <details className="form-details">
            <summary className="form-details-summary">{t("serverModal.advancedOptions")}</summary>
            <div className="form-row form-row--3">
              <div className="form-group">
                <label className="form-label">{t("serverModal.inactivityTimeout")}</label>
                <input
                  className="input"
                  type="number"
                  value={form.inactivity_timeout || ""}
                  onChange={(e) =>
                    update(
                      "inactivity_timeout",
                      e.target.value ? parseInt(e.target.value) : undefined,
                    )
                  }
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t("serverModal.keepaliveInterval")}</label>
                <input
                  className="input"
                  type="number"
                  value={form.keepalive_interval || ""}
                  onChange={(e) =>
                    update(
                      "keepalive_interval",
                      e.target.value ? parseInt(e.target.value) : undefined,
                    )
                  }
                />
              </div>
              <div className="form-group form-group--checkbox">
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={form.allow_insecure_algos || false}
                    onChange={(e) =>
                      update("allow_insecure_algos", e.target.checked)
                    }
                  />
                  <span>{t("serverModal.allowInsecureAlgos")}</span>
                </label>
              </div>
            </div>
          </details>

          {error && <div className="alert alert--error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={hideServerModal}>
            {t("common.cancel")}
          </button>
          <button
            className="btn btn--primary"
            onClick={handleSubmit}
            disabled={saving || !masterPasswordSet}
          >
            {saving ? t("serverModal.saving") : isEdit ? t("serverModal.update") : t("serverModal.addServerBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}
