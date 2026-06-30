/**
 * 终端动态配置的类型与内置配色方案。
 *
 * 设计参考 Tabby 的 colorSchemes.ts：配色以结构化 ITheme 表达，
 * 由 terminalSettingsStore 在运行时注入到 xterm 实例与 :root CSS 变量。
 */

/** xterm ITheme 的关键子集（与 @xterm/xterm 的 ITheme 兼容）。 */
export interface TerminalColorScheme {
  /** 适配的明暗模式，用于在 system 主题下挑选匹配方案。 */
  mode: "dark" | "light";
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export type CursorStyle = "block" | "underline" | "bar";

/** 终端运行时可调配置。配色跟随应用主题（dark/light），不再单独存储。 */
export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  scrollback: number;
  copyOnSelect: boolean;
  /** 行高倍数，1.0~2.0。 */
  lineHeight: number;
  /** 字间距倍数，0.8~2.0。 */
  letterSpacing: number;
}

export const TERMINAL_SETTINGS_STORAGE_KEY = "faorerm.terminalSettings.v1";

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontSize: 14,
  fontFamily:
    '"Cascadia Code", "JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace',
  cursorStyle: "bar",
  cursorBlink: true,
  scrollback: 10000,
  copyOnSelect: false,
  lineHeight: 1.1,
  letterSpacing: 0,
};

/** 字号允许区间，供 UI 与 store 校验。 */
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;
export const FONT_SIZE_STEP = 1;

/** 内置 dark / light 配色（与应用主题联动，不再提供多套方案选择）。 */
const DARK_SCHEME: TerminalColorScheme = {
  mode: "dark",
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  cursor: "#f5e0dc",
  cursorAccent: "#1e1e1e",
  selectionBackground: "#3a3a3a",
  selectionForeground: "#d4d4d4",
  black: "#3a3a3a",
  red: "#f38ba8",
  green: "#639f5d",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#f5c2e7",
  cyan: "#54ae9f",
  white: "#d4d4d4",
  brightBlack: "#4a4a4a",
  brightRed: "#f38ba8",
  brightGreen: "#639f5d",
  brightYellow: "#f9e2af",
  brightBlue: "#89b4fa",
  brightMagenta: "#f5c2e7",
  brightCyan: "#54ae9f",
  brightWhite: "#a0a0a0",
};

const LIGHT_SCHEME: TerminalColorScheme = {
  mode: "light",
  background: "#f5f5f4",
  foreground: "#1c1917",
  cursor: "#dc2626",
  cursorAccent: "#f5f5f4",
  selectionBackground: "#bfdbfe",
  selectionForeground: "#1c1917",
  black: "#a8a29e",
  red: "#dc2626",
  green: "#15803d",
  yellow: "#d97706",
  blue: "#2563eb",
  magenta: "#c026d3",
  cyan: "#0891b2",
  white: "#1c1917",
  brightBlack: "#78716c",
  brightRed: "#dc2626",
  brightGreen: "#15803d",
  brightYellow: "#d97706",
  brightBlue: "#2563eb",
  brightMagenta: "#c026d3",
  brightCyan: "#0891b2",
  brightWhite: "#57534e",
};

/** 根据应用 resolved 主题挑选 dark / light 配色。 */
export function getEffectiveScheme(
  _settings: TerminalSettings,
  resolved: "dark" | "light",
): TerminalColorScheme {
  return resolved === "dark" ? DARK_SCHEME : LIGHT_SCHEME;
}

/** 防御性深拷贝，避免 xterm 内部 mutate 配色对象。 */
export function schemeToTheme(scheme: TerminalColorScheme): Record<string, string> {
  return {
    background: scheme.background,
    foreground: scheme.foreground,
    cursor: scheme.cursor,
    cursorAccent: scheme.cursorAccent,
    selectionBackground: scheme.selectionBackground,
    selectionForeground: scheme.selectionForeground ?? scheme.foreground,
    black: scheme.black,
    red: scheme.red,
    green: scheme.green,
    yellow: scheme.yellow,
    blue: scheme.blue,
    magenta: scheme.magenta,
    cyan: scheme.cyan,
    white: scheme.white,
    brightBlack: scheme.brightBlack,
    brightRed: scheme.brightRed,
    brightGreen: scheme.brightGreen,
    brightYellow: scheme.brightYellow,
    brightBlue: scheme.brightBlue,
    brightMagenta: scheme.brightMagenta,
    brightCyan: scheme.brightCyan,
    brightWhite: scheme.brightWhite,
  };
}

/**
 * 把配色方案的颜色写入 :root CSS 变量。
 *
 * 单一写入点：配色方案切换 / 主题 resolved 切换时调用。
 * 之后 xterm 与外壳 chrome 都通过 readXtermThemeFromCSS() 读取，
 * 杜绝"xterm 用 JS 常量、chrome 用 CSS 变量"的双源割裂。
 *
 * 设计原则（impeccable / stitch-design-taste）：设计令牌单一来源。
 */
export function applySchemeToCSSVars(scheme: TerminalColorScheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const map: Record<string, string> = {
    "--term-bg": scheme.background,
    "--term-fg": scheme.foreground,
    "--term-cursor": scheme.cursor,
    "--term-cursor-accent": scheme.cursorAccent,
    "--term-selection-bg": scheme.selectionBackground,
    "--term-selection-fg": scheme.selectionForeground ?? scheme.foreground,
    "--ansi-black": scheme.black,
    "--ansi-red": scheme.red,
    "--ansi-green": scheme.green,
    "--ansi-yellow": scheme.yellow,
    "--ansi-blue": scheme.blue,
    "--ansi-magenta": scheme.magenta,
    "--ansi-cyan": scheme.cyan,
    "--ansi-white": scheme.white,
    "--ansi-bright-black": scheme.brightBlack,
    "--ansi-bright-red": scheme.brightRed,
    "--ansi-bright-green": scheme.brightGreen,
    "--ansi-bright-yellow": scheme.brightYellow,
    "--ansi-bright-blue": scheme.brightBlue,
    "--ansi-bright-magenta": scheme.brightMagenta,
    "--ansi-bright-cyan": scheme.brightCyan,
    "--ansi-bright-white": scheme.brightWhite,
  };
  for (const [k, v] of Object.entries(map)) {
    root.style.setProperty(k, v);
  }
}
