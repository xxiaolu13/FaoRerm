import { useState, useEffect } from "react";
import { useUIStore } from "../../stores/uiStore";
import { useServerStore } from "../../stores/serverStore";
import type { ServerConfig } from "../../types";

const DEFAULT_SERVER: Partial<ServerConfig> = {
  host: "",
  port: 22,
  user: "root",
  method: "password",
  secret: "",
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
      setError("Server name is required");
      return;
    }
    if (!form.host?.trim()) {
      setError("Host is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await addServer(serverKey.trim(), form as ServerConfig);
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
    <div className="modal-overlay" onClick={hideServerModal}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {isEdit ? "Edit Server" : "Add Server"}
          </h2>
        </div>

        <div className="modal-body">
          {!masterPasswordSet && (
            <div className="alert alert--warning">
              Master password is not set. Unlock the app before adding servers.
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Server Name</label>
              <input
                className="input"
                placeholder="e.g., production-web"
                value={serverKey}
                onChange={(e) => setServerKey(e.target.value)}
                disabled={isEdit}
              />
            </div>
          </div>

          <div className="form-row form-row--3">
            <div className="form-group form-group--grow">
              <label className="form-label">Host</label>
              <input
                className="input"
                placeholder="192.168.1.1"
                value={form.host || ""}
                onChange={(e) => update("host", e.target.value)}
              />
            </div>
            <div className="form-group form-group--fixed">
              <label className="form-label">Port</label>
              <input
                className="input"
                type="number"
                value={form.port || 22}
                onChange={(e) => update("port", parseInt(e.target.value) || 22)}
              />
            </div>
            <div className="form-group form-group--fixed">
              <label className="form-label">Username</label>
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
              <label className="form-label">Auth Method</label>
              <div className="toggle-group">
                <button
                  className={`toggle-btn ${
                    form.method === "password" ? "toggle-btn--active" : ""
                  }`}
                  onClick={() => update("method", "password")}
                >
                  Password
                </button>
                <button
                  className={`toggle-btn ${
                    form.method === "key" ? "toggle-btn--active" : ""
                  }`}
                  onClick={() => update("method", "key")}
                >
                  Private Key
                </button>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">
                {form.method === "password"
                  ? "Password"
                  : "Private Key Path"}
              </label>
              <input
                className="input"
                type={form.method === "password" ? "password" : "text"}
                placeholder={
                  form.method === "password"
                    ? "Enter password"
                    : "/home/user/.ssh/id_ed25519"
                }
                value={form.secret || ""}
                onChange={(e) => update("secret", e.target.value)}
              />
            </div>
          </div>

          <details className="form-details">
            <summary className="form-details-summary">Advanced Options</summary>
            <div className="form-row form-row--3">
              <div className="form-group">
                <label className="form-label">Inactivity Timeout (s)</label>
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
                <label className="form-label">Keepalive Interval (s)</label>
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
                  <span>Allow Insecure Algorithms</span>
                </label>
              </div>
            </div>
          </details>

          {error && <div className="alert alert--error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={hideServerModal}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            onClick={handleSubmit}
            disabled={saving || !masterPasswordSet}
          >
            {saving ? "Saving..." : isEdit ? "Update" : "Add Server"}
          </button>
        </div>
      </div>
    </div>
  );
}
