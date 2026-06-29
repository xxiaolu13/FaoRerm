/**
 * 终端动态配置 Store。
 *
 * - 持久化到 localStorage（生产环境可平滑迁移到 Tauri Store）。
 * - 变更时同步注入 :root CSS 变量（--term-*），供外围 chrome 复用。
 * - 变更时通过 terminalManager.applySettingsToAll() 实时下发给所有 xterm 实例。
 *
 * 设计参考 Tabby ConfigService：配置变更 → 通知所有 Frontend 重算。
 */
import { create } from "zustand";
import {
  applySchemeToCSSVars,
  DEFAULT_TERMINAL_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TERMINAL_SETTINGS_STORAGE_KEY,
  getEffectiveScheme,
  schemeToTheme,
  type TerminalSettings,
} from "../terminal/terminalSettings";
import { terminalManager } from "../terminal/terminalManager";
import { useThemeStore } from "./themeStore";

interface TerminalSettingsStore extends TerminalSettings {
  loaded: boolean;
  load: () => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  setCursorStyle: (
    style: TerminalSettings["cursorStyle"],
  ) => void;
  setCursorBlink: (blink: boolean) => void;
  setColorScheme: (id: string) => void;
  setScrollback: (lines: number) => void;
  setCopyOnSelect: (on: boolean) => void;
  setLineHeight: (h: number) => void;
  setLetterSpacing: (s: number) => void;
  reset: () => void;
}

function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_TERMINAL_SETTINGS.fontSize;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
}

function loadFromStorage(): TerminalSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_TERMINAL_SETTINGS };
  try {
    const raw = localStorage.getItem(TERMINAL_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TERMINAL_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<TerminalSettings>;
    return { ...DEFAULT_TERMINAL_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_TERMINAL_SETTINGS };
  }
}

function persist(settings: TerminalSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      TERMINAL_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings),
    );
  } catch {
    // 忽略配额或隐私模式写入失败
  }
}

/** 注入 CSS 变量，供 Tab 状态点等 chrome 与终端字号保持一致视觉。 */
function applyCSSVars(settings: TerminalSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--term-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--term-font-family", settings.fontFamily);
  root.style.setProperty("--term-line-height", String(settings.lineHeight));
  root.style.setProperty("--term-letter-spacing", `${settings.letterSpacing}px`);
}

/** 计算当前生效的 xterm theme（受应用主题联动）。 */
export function getActiveTerminalTheme() {
  const s = useTerminalSettingsStore.getState();
  const resolved = useThemeStore.getState().resolved;
  return schemeToTheme(getEffectiveScheme(s, resolved));
}

/**
 * 通知所有终端实例应用最新配置。
 *
 * 单一写入点：先把配色写入 :root CSS 变量，再下发到 xterm 实例。
 * terminalManager.applySettings 通过 readXtermThemeFromCSS() 读取，
 * 保证 xterm 与外壳 chrome 同源（impeccable / stitch-design-taste）。
 */
function broadcast(settings: TerminalSettings): void {
  const resolved = useThemeStore.getState().resolved;
  applySchemeToCSSVars(getEffectiveScheme(settings, resolved));
  terminalManager.applySettingsToAll(settings, resolved);
}

export const useTerminalSettingsStore = create<TerminalSettingsStore>(
  (set, get) => ({
    ...DEFAULT_TERMINAL_SETTINGS,
    loaded: false,

    load: () => {
      const stored = loadFromStorage();
      applyCSSVars(stored);
      set({ ...stored, loaded: true });
      // 已存在的终端实例（极少：首屏前无 Tab）也同步一次
      broadcast(stored);
    },

    setFontSize: (size) => {
      const fontSize = clampFontSize(size);
      const next = { ...get(), fontSize };
      applyCSSVars(next);
      persist(next);
      set({ fontSize });
      broadcast(next);
    },

    setFontFamily: (family) => {
      const fontFamily = family.trim() || DEFAULT_TERMINAL_SETTINGS.fontFamily;
      const next = { ...get(), fontFamily };
      applyCSSVars(next);
      persist(next);
      set({ fontFamily });
      broadcast(next);
    },

    setCursorStyle: (style) => {
      const next = { ...get(), cursorStyle: style };
      persist(next);
      set({ cursorStyle: style });
      broadcast(next);
    },

    setCursorBlink: (blink) => {
      const next = { ...get(), cursorBlink: blink };
      persist(next);
      set({ cursorBlink: blink });
      broadcast(next);
    },

    setColorScheme: (id) => {
      const next = { ...get(), colorSchemeId: id };
      persist(next);
      set({ colorSchemeId: id });
      broadcast(next);
    },

    setScrollback: (lines) => {
      const scrollback = Math.min(100000, Math.max(0, Math.round(lines)));
      const next = { ...get(), scrollback };
      persist(next);
      set({ scrollback });
      broadcast(next);
    },

    setCopyOnSelect: (on) => {
      const next = { ...get(), copyOnSelect: on };
      persist(next);
      set({ copyOnSelect: on });
      broadcast(next);
    },

    setLineHeight: (h) => {
      const lineHeight = Math.min(2, Math.max(1, Number(h) || 1));
      const next = { ...get(), lineHeight };
      applyCSSVars(next);
      persist(next);
      set({ lineHeight });
      broadcast(next);
    },

    setLetterSpacing: (s) => {
      const letterSpacing = Math.min(2, Math.max(0, Number(s) || 0));
      const next = { ...get(), letterSpacing };
      persist(next);
      set({ letterSpacing });
      broadcast(next);
    },

    reset: () => {
      applyCSSVars(DEFAULT_TERMINAL_SETTINGS);
      persist(DEFAULT_TERMINAL_SETTINGS);
      set({ ...DEFAULT_TERMINAL_SETTINGS });
      broadcast(DEFAULT_TERMINAL_SETTINGS);
    },
  }),
);

/** 当应用主题变化时，联动刷新所有终端配色（auto 方案 / 配色 mode）。 */
if (typeof window !== "undefined") {
  useThemeStore.subscribe((state) => {
    if (!state.loaded) return;
    const ts = useTerminalSettingsStore.getState();
    if (!ts.loaded) return;
    broadcast(ts);
  });
}
