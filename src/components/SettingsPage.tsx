import { useThemeStore } from "../stores/themeStore";
import { toast } from "../stores/toastStore";

type Theme = "system" | "dark" | "light";

const themeOptions: { value: Theme; label: string; desc: string }[] = [
  { value: "system", label: "System", desc: "Follow OS setting" },
  { value: "dark", label: "Dark", desc: "Always dark" },
  { value: "light", label: "Light", desc: "Always light" },
];

export function SettingsPage() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const handleThemeChange = async (value: Theme) => {
    await setTheme(value);
    toast("Theme updated", { variant: "success" });
  };

  return (
    <div className="settings-page">
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
    </div>
  );
}
