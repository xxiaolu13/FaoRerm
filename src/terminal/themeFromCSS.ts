/**
 * 单一主题源：从 :root CSS 变量读取 xterm ITheme。
 *
 * 设计原则（impeccable / stitch-design-taste）：
 *   - 设计令牌单一来源，禁止 JS 常量与 CSS 变量并存。
 *   - xterm 配色不再来自 terminalSettings.ts 的硬编码 scheme，
 *     而是运行时读取全局 CSS 变量，与外壳 chrome 同源。
 *
 * 当 [data-theme] 切换或用户切换配色方案（变更 CSS 变量值）时，
 * 调用 readXtermThemeFromCSS() 即可拿到最新 ITheme。
 */

/** xterm ITheme 关键字段 → CSS 变量名映射。 */
const VAR_MAP = {
  background: "--term-bg",
  foreground: "--term-fg",
  cursor: "--term-cursor",
  cursorAccent: "--term-cursor-accent",
  selectionBackground: "--term-selection-bg",
  selectionForeground: "--term-selection-fg",
  black: "--ansi-black",
  red: "--ansi-red",
  green: "--ansi-green",
  yellow: "--ansi-yellow",
  blue: "--ansi-blue",
  magenta: "--ansi-magenta",
  cyan: "--ansi-cyan",
  white: "--ansi-white",
  brightBlack: "--ansi-bright-black",
  brightRed: "--ansi-bright-red",
  brightGreen: "--ansi-bright-green",
  brightYellow: "--ansi-bright-yellow",
  brightBlue: "--ansi-bright-blue",
  brightMagenta: "--ansi-bright-magenta",
  brightCyan: "--ansi-bright-cyan",
  brightWhite: "--ansi-bright-white",
} as const;

export type XtermTheme = Record<(typeof VAR_MAP)[keyof typeof VAR_MAP] extends string ? string : never, string>;

/**
 * 运行时从 :root 读取 xterm 配色。
 *
 * SSR 安全：window/document 不存在时返回空对象（xterm 会用其默认配色）。
 */
export function readXtermThemeFromCSS(): Record<string, string> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {};
  }
  const styles = getComputedStyle(document.documentElement);
  const theme: Record<string, string> = {};
  for (const [key, varName] of Object.entries(VAR_MAP)) {
    const v = styles.getPropertyValue(varName).trim();
    if (v) theme[key] = v;
  }
  return theme;
}
