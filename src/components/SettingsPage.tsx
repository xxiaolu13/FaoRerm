import { useState } from "react";
import { useThemeStore } from "../stores/themeStore";
import { useTerminalSettingsStore } from "../stores/terminalSettingsStore";
import {
  BUILTIN_COLOR_SCHEMES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  type CursorStyle,
} from "../terminal/terminalSettings";
import { useAIStore } from "../stores/aiStore";
import { toast } from "../stores/toastStore";
import type { ProviderConfig } from "../types";
import { ConfigLayout } from "./ConfigLayout";

type Theme = "system" | "dark" | "light";

const themeOptions: { value: Theme; label: string; desc: string }[] = [
  { value: "system", label: "System", desc: "Follow OS setting" },
  { value: "dark", label: "Dark", desc: "Always dark" },
  { value: "light", label: "Light", desc: "Always light" },
];

const defaultProviderConfig: ProviderConfig = {
  provider_type: "openai",
  url: "",
  token: "",
  model: "gpt-4o",
  max_turns: 10,
  thinking_budget: null,
  extra_system_prompt: null,
};

function AIProviderSection() {
  const providers = useAIStore((s) => s.providers);
  const defaultProvider = useAIStore((s) => s.defaultProvider);
  const upsertProvider = useAIStore((s) => s.upsertProvider);
  const deleteProvider = useAIStore((s) => s.deleteProvider);
  const setDefaultProvider = useAIStore((s) => s.setDefaultProvider);

  const [showAdd, setShowAdd] = useState(false);
  const [editName, setEditName] = useState("");
  const [editConfig, setEditConfig] = useState<ProviderConfig>({ ...defaultProviderConfig });

  const entries = Object.entries(providers);

  const handleSave = async () => {
    if (!editName.trim()) {
      toast("Provider name is required", { variant: "warning" });
      return;
    }
    if (!editConfig.token.trim()) {
      toast("API key is required", { variant: "warning" });
      return;
    }
    try {
      await upsertProvider(editName.trim(), editConfig);
      setShowAdd(false);
      setEditName("");
      setEditConfig({ ...defaultProviderConfig });
      toast("Provider saved", { variant: "success" });
    } catch (err) {
      toast("Failed to save provider", { description: String(err), variant: "error" });
    }
  };

  const handleEdit = (name: string, config: ProviderConfig) => {
    setEditName(name);
    setEditConfig({ ...config });
    setShowAdd(true);
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteProvider(name);
      toast("Provider deleted", { variant: "success" });
    } catch (err) {
      toast("Failed to delete", { description: String(err), variant: "error" });
    }
  };

  const handleSetDefault = async (name: string) => {
    try {
      await setDefaultProvider(name);
      toast("Default provider set", { variant: "success" });
    } catch (err) {
      toast("Failed to set default", { description: String(err), variant: "error" });
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">AI Providers</h3>

      {!showAdd && (
        <button
          className="btn btn--primary btn--sm"
          onClick={() => {
            setEditName("");
            setEditConfig({ ...defaultProviderConfig });
            setShowAdd(true);
          }}
        >
          Add Provider
        </button>
      )}

      {showAdd && (
        <div className="settings-card" style={{ marginTop: 12 }}>
          <div className="settings-card-header">
            <span className="settings-card-title">
              {providers[editName] ? `Edit: ${editName}` : "New Provider"}
            </span>
          </div>
          <div className="settings-form">
            {!providers[editName] && (
              <label className="settings-form-label">
                Name
                <input
                  className="input input--sm"
                  placeholder="e.g. my-gpt4"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
            )}
            <label className="settings-form-label">
              Provider Type
              <select
                className="input input--sm"
                value={editConfig.provider_type}
                onChange={(e) =>
                  setEditConfig((c) => ({
                    ...c,
                    provider_type: e.target.value,
                    model: e.target.value === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o",
                  }))
                }
              >
                <option value="openai">OpenAI Compatible</option>
                <option value="anthropic">Anthropic Compatible</option>
              </select>
            </label>
            <label className="settings-form-label">
              Base URL
              <input
                className="input input--sm"
                placeholder={
                  editConfig.provider_type === "anthropic"
                    ? "https://api.anthropic.com"
                    : "https://api.openai.com/v1"
                }
                value={editConfig.url}
                onChange={(e) => setEditConfig((c) => ({ ...c, url: e.target.value }))}
              />
            </label>
            <label className="settings-form-label">
              API Key
              <input
                className="input input--sm"
                type="password"
                placeholder="sk-..."
                value={editConfig.token}
                onChange={(e) => setEditConfig((c) => ({ ...c, token: e.target.value }))}
              />
            </label>
            <label className="settings-form-label">
              Model
              <input
                className="input input--sm"
                placeholder="gpt-4o"
                value={editConfig.model}
                onChange={(e) => setEditConfig((c) => ({ ...c, model: e.target.value }))}
              />
            </label>
            <label className="settings-form-label">
              Max Turns
              <input
                className="input input--sm"
                type="number"
                min={1}
                max={50}
                value={editConfig.max_turns}
                onChange={(e) =>
                  setEditConfig((c) => ({ ...c, max_turns: parseInt(e.target.value) || 10 }))
                }
              />
            </label>
            <div className="settings-form-actions">
              <button className="btn btn--primary btn--sm" onClick={handleSave}>
                Save
              </button>
              <button
                className="btn btn--sm"
                onClick={() => {
                  setShowAdd(false);
                  setEditName("");
                  setEditConfig({ ...defaultProviderConfig });
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {entries.length === 0 && !showAdd && (
        <span className="empty-hint" style={{ marginTop: 8, display: "block" }}>
          No AI providers configured
        </span>
      )}

      {entries.map(([name, config]) => (
        <div key={name} className="settings-card" style={{ marginTop: 8 }}>
          <div className="settings-card-header">
            <div>
              <span className="settings-card-title">{name}</span>
              {defaultProvider === name && (
                <span
                  className="badge badge--primary"
                  style={{ marginLeft: 8, fontSize: 10, padding: "2px 6px" }}
                >
                  Default
                </span>
              )}
            </div>
            <span className="settings-card-desc">
              {config.provider_type} / {config.model}
            </span>
          </div>
          <div className="settings-provider-actions">
            {defaultProvider !== name && (
              <button
                className="btn btn--sm"
                onClick={() => handleSetDefault(name)}
              >
                Set Default
              </button>
            )}
            <button
              className="btn btn--sm"
              onClick={() => handleEdit(name, config)}
            >
              Edit
            </button>
            <button
              className="btn btn--sm btn--danger"
              onClick={() => handleDelete(name)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const cursorStyleOptions: { value: CursorStyle; label: string }[] = [
  { value: "block", label: "Block" },
  { value: "underline", label: "Underline" },
  { value: "bar", label: "Bar" },
];

const commonMonoFonts = [
  "Cascadia Code",
  "JetBrains Mono",
  "Fira Code",
  "SF Mono",
  "Source Code Pro",
  "Menlo",
  "Consolas",
  "Monaco",
  "DejaVu Sans Mono",
];

function TerminalAppearanceSection() {
  const fontSize = useTerminalSettingsStore((s) => s.fontSize);
  const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
  const cursorStyle = useTerminalSettingsStore((s) => s.cursorStyle);
  const cursorBlink = useTerminalSettingsStore((s) => s.cursorBlink);
  const colorSchemeId = useTerminalSettingsStore((s) => s.colorSchemeId);
  const lineHeight = useTerminalSettingsStore((s) => s.lineHeight);
  const copyOnSelect = useTerminalSettingsStore((s) => s.copyOnSelect);
  const setFontSize = useTerminalSettingsStore((s) => s.setFontSize);
  const setFontFamily = useTerminalSettingsStore((s) => s.setFontFamily);
  const setCursorStyle = useTerminalSettingsStore((s) => s.setCursorStyle);
  const setCursorBlink = useTerminalSettingsStore((s) => s.setCursorBlink);
  const setColorScheme = useTerminalSettingsStore((s) => s.setColorScheme);
  const setLineHeight = useTerminalSettingsStore((s) => s.setLineHeight);
  const setCopyOnSelect = useTerminalSettingsStore((s) => s.setCopyOnSelect);
  const reset = useTerminalSettingsStore((s) => s.reset);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Terminal</h3>

      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Font</span>
          <span className="settings-card-desc">Font size, family and line height</span>
        </div>
        <div className="settings-form">
          <label className="settings-form-label">
            Size
            <span className="settings-form-value">{fontSize}px</span>
            <input
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value))}
            />
          </label>
          <label className="settings-form-label">
            Family
            <input
              className="input input--sm"
              list="mono-font-list"
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              placeholder="Select or enter a monospace font"
            />
            <datalist id="mono-font-list">
              {commonMonoFonts.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <label className="settings-form-label">
            Line height
            <span className="settings-form-value">{lineHeight.toFixed(2)}</span>
            <input
              type="range"
              min={1}
              max={2}
              step={0.05}
              value={lineHeight}
              onChange={(e) => setLineHeight(parseFloat(e.target.value))}
            />
          </label>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Cursor</span>
          <span className="settings-card-desc">Cursor shape and blink</span>
        </div>
        <div className="settings-form">
          <div className="settings-segmented">
            {cursorStyleOptions.map((opt) => (
              <button
                key={opt.value}
                className={`settings-segmented-btn ${cursorStyle === opt.value ? "settings-segmented-btn--active" : ""}`}
                onClick={() => setCursorStyle(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="settings-toggle-row">
            <span>Blink cursor</span>
            <button
              className={`toggle ${cursorBlink ? "toggle--on" : ""}`}
              role="switch"
              aria-checked={cursorBlink}
              onClick={() => setCursorBlink(!cursorBlink)}
            />
          </label>
          <label className="settings-toggle-row">
            <span>Copy on select</span>
            <button
              className={`toggle ${copyOnSelect ? "toggle--on" : ""}`}
              role="switch"
              aria-checked={copyOnSelect}
              onClick={() => setCopyOnSelect(!copyOnSelect)}
            />
          </label>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Color Scheme</span>
          <span className="settings-card-desc">Auto follows the app theme</span>
        </div>
        <div className="settings-scheme-grid">
          <button
            className={`settings-scheme-btn ${colorSchemeId === "auto" ? "settings-scheme-btn--active" : ""}`}
            onClick={() => setColorScheme("auto")}
            title="Follow app theme"
          >
            <span className="settings-scheme-swatch settings-scheme-swatch--auto" />
            <span className="settings-scheme-label">Auto</span>
          </button>
          {BUILTIN_COLOR_SCHEMES.map((scheme) => (
            <button
              key={scheme.id}
              className={`settings-scheme-btn ${colorSchemeId === scheme.id ? "settings-scheme-btn--active" : ""}`}
              onClick={() => setColorScheme(scheme.id)}
              title={scheme.name}
            >
              <span
                className="settings-scheme-swatch"
                style={{
                  background: `linear-gradient(135deg, ${scheme.background} 0 50%, ${scheme.foreground} 50% 100%)`,
                  boxShadow: `inset 0 0 0 1px ${scheme.blue}`,
                }}
              />
              <span className="settings-scheme-label">{scheme.name}</span>
            </button>
          ))}
        </div>
        <div className="settings-form-actions">
          <button
            className="btn btn--sm"
            onClick={() => {
              reset();
              toast("Terminal settings reset", { variant: "default" });
            }}
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const handleThemeChange = async (value: Theme) => {
    await setTheme(value);
    toast("Theme updated", { variant: "success" });
  };

  return (
    <ConfigLayout>
      <div className="settings-section">
        <h3 className="settings-section-title">Appearance</h3>
        <div className="settings-card">
          <div className="settings-card-header">
            <span className="settings-card-title">Theme</span>
            <span className="settings-card-desc">Choose the application color scheme</span>
          </div>
          <div className="settings-theme-options">
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                className={`settings-theme-btn ${theme === opt.value ? "settings-theme-btn--active" : ""}`}
                onClick={() => handleThemeChange(opt.value)}
              >
                <span className="settings-theme-btn-indicator">
                  {theme === opt.value && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <div className="settings-theme-btn-preview">
                  {opt.value === "system" && (
                    <svg width="28" height="20" viewBox="0 0 28 20" fill="none">
                      <rect x="0.5" y="0.5" width="12" height="19" rx="1.5" fill="var(--bg-secondary)" stroke="var(--border)" />
                      <rect x="15.5" y="0.5" width="12" height="19" rx="1.5" fill="var(--bg-surface)" stroke="var(--border)" />
                    </svg>
                  )}
                  {opt.value === "dark" && (
                    <svg width="28" height="20" viewBox="0 0 28 20" fill="none">
                      <rect x="0.5" y="0.5" width="27" height="19" rx="1.5" fill="#1e1e1e" stroke="#3a3a3a" />
                      <circle cx="14" cy="10" r="4" fill="#d4d4d4" opacity="0.3" />
                    </svg>
                  )}
                  {opt.value === "light" && (
                    <svg width="28" height="20" viewBox="0 0 28 20" fill="none">
                      <rect x="0.5" y="0.5" width="27" height="19" rx="1.5" fill="#f5f5f4" stroke="#d6d3d1" />
                      <circle cx="14" cy="10" r="4" fill="#1c1917" opacity="0.1" />
                    </svg>
                  )}
                </div>
                <span className="settings-theme-btn-label">{opt.label}</span>
                <span className="settings-theme-btn-desc">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <TerminalAppearanceSection />

      <AIProviderSection />
    </ConfigLayout>
  );
}
