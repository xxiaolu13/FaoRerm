import { useState } from "react";
import { useThemeStore } from "../stores/themeStore";
import { useTerminalSettingsStore } from "../stores/terminalSettingsStore";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  type CursorStyle,
} from "../terminal/terminalSettings";
import { useAIStore } from "../stores/aiStore";
import { toast } from "../stores/toastStore";
import { useI18nStore, useT } from "../stores/i18nStore";
import type { Lang } from "../stores/i18nStore";
import type { ProviderConfig } from "../types";
import { ConfigLayout } from "./ConfigLayout";

type Theme = "system" | "dark" | "light";

const defaultProviderConfig: ProviderConfig = {
  provider_type: "openai",
  url: "",
  token: "",
  model: "gpt-4o",
  max_turns: 10,
  thinking_budget: null,
  extra_system_prompt: null,
};

function AppearanceSection() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  const t = useT();

  const themeOptions: { value: Theme; label: string; desc: string }[] = [
    { value: "system", label: t("settings.themeAuto"), desc: t("settings.themeAutoDesc") },
    { value: "dark", label: t("settings.themeDark"), desc: t("settings.themeDarkDesc") },
    { value: "light", label: t("settings.themeLight"), desc: t("settings.themeLightDesc") },
  ];

  const langOptions: { value: Lang; label: string }[] = [
    { value: "en", label: t("settings.languageEn") },
    { value: "zh", label: t("settings.languageZh") },
  ];

  const handleThemeChange = async (value: Theme) => {
    await setTheme(value);
    toast(t("settings.themeUpdated"), { variant: "success" });
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("settings.appearance")}</h3>

      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">{t("settings.theme")}</span>
          <span className="settings-card-desc">{t("settings.themeDesc")}</span>
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

      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">{t("settings.language")}</span>
          <span className="settings-card-desc">{t("settings.languageDesc")}</span>
        </div>
        <div className="settings-segmented">
          {langOptions.map((opt) => (
            <button
              key={opt.value}
              className={`settings-segmented-btn ${lang === opt.value ? "settings-segmented-btn--active" : ""}`}
              onClick={() => setLang(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AIProviderSection() {
  const providers = useAIStore((s) => s.providers);
  const defaultProvider = useAIStore((s) => s.defaultProvider);
  const upsertProvider = useAIStore((s) => s.upsertProvider);
  const deleteProvider = useAIStore((s) => s.deleteProvider);
  const setDefaultProvider = useAIStore((s) => s.setDefaultProvider);
  const t = useT();

  const [showAdd, setShowAdd] = useState(false);
  const [editName, setEditName] = useState("");
  const [editConfig, setEditConfig] = useState<ProviderConfig>({ ...defaultProviderConfig });

  const entries = Object.entries(providers);

  const handleSave = async () => {
    if (!editName.trim()) {
      toast(t("aiProvider.nameRequired"), { variant: "warning" });
      return;
    }
    if (!editConfig.token.trim()) {
      toast(t("aiProvider.apiKeyRequired"), { variant: "warning" });
      return;
    }
    try {
      await upsertProvider(editName.trim(), editConfig);
      setShowAdd(false);
      setEditName("");
      setEditConfig({ ...defaultProviderConfig });
      toast(t("aiProvider.saved"), { variant: "success" });
    } catch (err) {
      toast(t("aiProvider.saveFailed"), { description: String(err), variant: "error" });
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
      toast(t("aiProvider.deleted"), { variant: "success" });
    } catch (err) {
      toast(t("aiProvider.deleteFailed"), { description: String(err), variant: "error" });
    }
  };

  const handleSetDefault = async (name: string) => {
    try {
      await setDefaultProvider(name);
      toast(t("aiProvider.defaultSet"), { variant: "success" });
    } catch (err) {
      toast(t("aiProvider.setDefaultFailed"), { description: String(err), variant: "error" });
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("aiProvider.title")}</h3>

      {!showAdd && (
        <button
          className="btn btn--primary btn--sm"
          onClick={() => {
            setEditName("");
            setEditConfig({ ...defaultProviderConfig });
            setShowAdd(true);
          }}
        >
          {t("aiProvider.add")}
        </button>
      )}

      {showAdd && (
        <div className="settings-card" style={{ marginTop: 12 }}>
          <div className="settings-card-header">
            <span className="settings-card-title">
              {providers[editName] ? t("aiProvider.editName", { name: editName }) : t("aiProvider.newName")}
            </span>
          </div>
          <div className="settings-form">
            {!providers[editName] && (
              <label className="settings-form-label">
                {t("aiProvider.name")}
                <input
                  className="input input--sm"
                  placeholder={t("aiProvider.namePlaceholder")}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
            )}
            <label className="settings-form-label">
              {t("aiProvider.providerType")}
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
                <option value="openai">{t("aiProvider.openaiCompatible")}</option>
                <option value="anthropic">{t("aiProvider.anthropicCompatible")}</option>
              </select>
            </label>
            <label className="settings-form-label">
              {t("aiProvider.baseUrl")}
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
              {t("aiProvider.apiKey")}
              <input
                className="input input--sm"
                type="password"
                placeholder="sk-..."
                value={editConfig.token}
                onChange={(e) => setEditConfig((c) => ({ ...c, token: e.target.value }))}
              />
            </label>
            <label className="settings-form-label">
              {t("aiProvider.model")}
              <input
                className="input input--sm"
                placeholder="gpt-4o"
                value={editConfig.model}
                onChange={(e) => setEditConfig((c) => ({ ...c, model: e.target.value }))}
              />
            </label>
            <label className="settings-form-label">
              {t("aiProvider.maxTurns")}
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
                {t("common.save")}
              </button>
              <button
                className="btn btn--sm"
                onClick={() => {
                  setShowAdd(false);
                  setEditName("");
                  setEditConfig({ ...defaultProviderConfig });
                }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {entries.length === 0 && !showAdd && (
        <span className="empty-hint" style={{ marginTop: 8, display: "block" }}>
          {t("aiProvider.noProviders")}
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
                  {t("aiProvider.default")}
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
                {t("aiProvider.setDefault")}
              </button>
            )}
            <button
              className="btn btn--sm"
              onClick={() => handleEdit(name, config)}
            >
              {t("common.edit")}
            </button>
            <button
              className="btn btn--sm btn--danger"
              onClick={() => handleDelete(name)}
            >
              {t("common.delete")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const cursorStyleOptions: { value: CursorStyle; labelKey: "block" | "underline" | "bar" }[] = [
  { value: "block", labelKey: "block" },
  { value: "underline", labelKey: "underline" },
  { value: "bar", labelKey: "bar" },
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
  const lineHeight = useTerminalSettingsStore((s) => s.lineHeight);
  const copyOnSelect = useTerminalSettingsStore((s) => s.copyOnSelect);
  const setFontSize = useTerminalSettingsStore((s) => s.setFontSize);
  const setFontFamily = useTerminalSettingsStore((s) => s.setFontFamily);
  const setCursorStyle = useTerminalSettingsStore((s) => s.setCursorStyle);
  const setCursorBlink = useTerminalSettingsStore((s) => s.setCursorBlink);
  const setLineHeight = useTerminalSettingsStore((s) => s.setLineHeight);
  const setCopyOnSelect = useTerminalSettingsStore((s) => s.setCopyOnSelect);
  const reset = useTerminalSettingsStore((s) => s.reset);
  const t = useT();

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("settings.terminal")}</h3>

      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">{t("settings.font")}</span>
          <span className="settings-card-desc">{t("settings.fontDesc")}</span>
        </div>
        <div className="settings-form">
          <label className="settings-form-label">
            {t("settings.size")}
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
            {t("settings.family")}
            <input
              className="input input--sm"
              list="mono-font-list"
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              placeholder={t("settings.familyPlaceholder")}
            />
            <datalist id="mono-font-list">
              {commonMonoFonts.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <label className="settings-form-label">
            {t("settings.lineHeightLabel")}
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
          <span className="settings-card-title">{t("settings.cursor")}</span>
          <span className="settings-card-desc">{t("settings.cursorDesc")}</span>
        </div>
        <div className="settings-form">
          <div className="settings-segmented">
            {cursorStyleOptions.map((opt) => (
              <button
                key={opt.value}
                className={`settings-segmented-btn ${cursorStyle === opt.value ? "settings-segmented-btn--active" : ""}`}
                onClick={() => setCursorStyle(opt.value)}
              >
                {t(`settings.${opt.labelKey}`)}
              </button>
            ))}
          </div>
          <label className="settings-toggle-row">
            <span>{t("settings.blinkCursor")}</span>
            <button
              className={`toggle ${cursorBlink ? "toggle--on" : ""}`}
              role="switch"
              aria-checked={cursorBlink}
              onClick={() => setCursorBlink(!cursorBlink)}
            />
          </label>
          <label className="settings-toggle-row">
            <span>{t("settings.copyOnSelectLabel")}</span>
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
          <span className="settings-card-title">{t("settings.reset")}</span>
          <span className="settings-card-desc">{t("settings.resetDesc")}</span>
        </div>
        <div className="settings-form-actions">
          <button
            className="btn btn--sm"
            onClick={() => {
              reset();
              toast(t("settings.settingsReset"), { variant: "default" });
            }}
          >
            {t("settings.resetToDefaults")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  return (
    <ConfigLayout>
      <AppearanceSection />
      <TerminalAppearanceSection />
      <AIProviderSection />
    </ConfigLayout>
  );
}
