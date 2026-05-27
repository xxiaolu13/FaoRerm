import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AppearanceConfig } from "../types";

type Theme = "system" | "dark" | "light";

interface ThemeStore {
  theme: Theme;
  resolved: "dark" | "light";
  loaded: boolean;

  loadTheme: () => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  applyTheme: (theme: Theme) => void;
}

function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

function applyToDOM(resolved: "dark" | "light") {
  document.documentElement.setAttribute("data-theme", resolved);
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: "system",
  resolved: "dark",
  loaded: false,

  loadTheme: async () => {
    try {
      const config = await invoke<AppearanceConfig>("get_appearance_config");
      const theme = (config.theme as Theme) || "system";
      const resolved = resolveTheme(theme);
      applyToDOM(resolved);
      set({ theme, resolved, loaded: true });
    } catch {
      applyToDOM("dark");
      set({ theme: "system", resolved: "dark", loaded: true });
    }
  },

  setTheme: async (theme) => {
    const resolved = resolveTheme(theme);
    applyToDOM(resolved);
    set({ theme, resolved });
    try {
      await invoke("update_appearance_config", { theme });
    } catch (err) {
      console.error("Failed to save theme:", err);
    }
  },

  applyTheme: (theme) => {
    const resolved = resolveTheme(theme);
    applyToDOM(resolved);
    set({ theme, resolved });
  },
}));

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const { theme } = useThemeStore.getState();
    if (theme === "system") {
      const resolved = resolveTheme("system");
      applyToDOM(resolved);
      useThemeStore.setState({ resolved });
    }
  });
}
