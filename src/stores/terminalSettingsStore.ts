/**
 * 终端动态配置 Store。
 *
 * - 持久化到 Rust 配置（faoconfig.toml 的 appearance.terminal），通过 Tauri command 读写。
 * - 浏览器环境（无 invoke）或命令失败时 fallback 到 localStorage，保证 dev 可用。
 * - 变更时同步注入 :root CSS 变量（--term-*），供外围 chrome 复用。
 * - 变更时通过 terminalManager.applySettingsToAll() 实时下发给所有 xterm 实例。
 *
 * 设计参考 Tabby ConfigService：配置变更 → 通知所有 Frontend 重算。
 */
import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  applySchemeToCSSVars,
  DEFAULT_TERMINAL_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TERMINAL_SETTINGS_STORAGE_KEY,
  getEffectiveScheme,
  schemeToTheme,
  type CursorStyle,
  type TerminalSettings,
} from "../terminal/terminalSettings";
import { terminalManager } from "../terminal/terminalManager";
import { useThemeStore } from "./themeStore";

interface TerminalSettingsStore extends TerminalSettings {
  loaded: boolean;
  load: () => Promise<void>;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  setCursorStyle: (style: CursorStyle) => void;
  setCursorBlink: (blink: boolean) => void;
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

/** 与 Rust TerminalConfig 对应的传输结构（snake_case）。 */
interface TerminalConfigDTO {
  font_size: number;
  font_family: string;
  cursor_style: string;
  cursor_blink: boolean;
  scrollback: number;
  copy_on_select: boolean;
  line_height: number;
  letter_spacing: number;
}

function toDTO(s: TerminalSettings): TerminalConfigDTO {
  return {
    font_size: s.fontSize,
    font_family: s.fontFamily,
    cursor_style: s.cursorStyle,
    cursor_blink: s.cursorBlink,
    scrollback: s.scrollback,
    copy_on_select: s.copyOnSelect,
    line_height: s.lineHeight,
    letter_spacing: s.letterSpacing,
  };
}

function fromDTO(dto: Partial<TerminalConfigDTO>): TerminalSettings {
  return {
    ...DEFAULT_TERMINAL_SETTINGS,
    fontSize: Number(dto.font_size) || DEFAULT_TERMINAL_SETTINGS.fontSize,
    fontFamily: dto.font_family || DEFAULT_TERMINAL_SETTINGS.fontFamily,
    cursorStyle: (dto.cursor_style as CursorStyle) || DEFAULT_TERMINAL_SETTINGS.cursorStyle,
    cursorBlink: dto.cursor_blink ?? DEFAULT_TERMINAL_SETTINGS.cursorBlink,
    scrollback: Number(dto.scrollback) || DEFAULT_TERMINAL_SETTINGS.scrollback,
    copyOnSelect: dto.copy_on_select ?? DEFAULT_TERMINAL_SETTINGS.copyOnSelect,
    lineHeight: Number(dto.line_height) || DEFAULT_TERMINAL_SETTINGS.lineHeight,
    letterSpacing: Number(dto.letter_spacing) ?? DEFAULT_TERMINAL_SETTINGS.letterSpacing,
  };
}

/** 读取：优先 Rust 配置，失败/非 Tauri 环境 fallback localStorage。 */
async function loadPersisted(): Promise<TerminalSettings> {
  // 非 Tauri 环境（纯浏览器 dev）用 localStorage
  if (!isTauri()) {
    return loadFromStorage();
  }
  try {
    const dto = await invoke<TerminalConfigDTO>("get_terminal_config");
    return fromDTO(dto);
  } catch (err) {
    console.warn("get_terminal_config failed, fallback to localStorage:", err);
    return loadFromStorage();
  }
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

/** 写入：优先 Rust 配置，失败/非 Tauri 环境 fallback localStorage。 */
async function persist(settings: TerminalSettings): Promise<void> {
  if (!isTauri()) {
    persistToStorage(settings);
    return;
  }
  try {
    await invoke("update_terminal_config", { config: toDTO(settings) });
  } catch (err) {
    console.warn("update_terminal_config failed, fallback to localStorage:", err);
    persistToStorage(settings);
  }
}

function persistToStorage(settings: TerminalSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TERMINAL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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

    load: async () => {
      const stored = await loadPersisted();
      applyCSSVars(stored);
      set({ ...stored, loaded: true });
      broadcast(stored);
    },

    setFontSize: (size) => {
      const fontSize = clampFontSize(size);
      const next = { ...get(), fontSize };
      applyCSSVars(next);
      void persist(next);
      set({ fontSize });
      broadcast(next);
    },

    setFontFamily: (family) => {
      const fontFamily = family.trim() || DEFAULT_TERMINAL_SETTINGS.fontFamily;
      const next = { ...get(), fontFamily };
      applyCSSVars(next);
      void persist(next);
      set({ fontFamily });
      broadcast(next);
    },

    setCursorStyle: (style) => {
      const next = { ...get(), cursorStyle: style };
      void persist(next);
      set({ cursorStyle: style });
      broadcast(next);
    },

    setCursorBlink: (blink) => {
      const next = { ...get(), cursorBlink: blink };
      void persist(next);
      set({ cursorBlink: blink });
      broadcast(next);
    },

    setScrollback: (lines) => {
      const scrollback = Math.min(100000, Math.max(0, Math.round(lines)));
      const next = { ...get(), scrollback };
      void persist(next);
      set({ scrollback });
      broadcast(next);
    },

    setCopyOnSelect: (on) => {
      const next = { ...get(), copyOnSelect: on };
      void persist(next);
      set({ copyOnSelect: on });
      broadcast(next);
    },

    setLineHeight: (h) => {
      const lineHeight = Math.min(2, Math.max(1, Number(h) || 1));
      const next = { ...get(), lineHeight };
      applyCSSVars(next);
      void persist(next);
      set({ lineHeight });
      broadcast(next);
    },

    setLetterSpacing: (s) => {
      const letterSpacing = Math.min(2, Math.max(0, Number(s) || 0));
      const next = { ...get(), letterSpacing };
      void persist(next);
      set({ letterSpacing });
      broadcast(next);
    },

    reset: () => {
      applyCSSVars(DEFAULT_TERMINAL_SETTINGS);
      void persist(DEFAULT_TERMINAL_SETTINGS);
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
