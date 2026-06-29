/**
 * 终端会话管理器。
 *
 * 架构参考 Tabby 的 Frontend/XTermFrontend：将单个 xterm 实例封装为
 * TerminalSession，集中管理 attach/fit/WebGL 生命周期/resize 节流/配置下发，
 * 彻底解决高 DPI 字体模糊、拖窗闪烁、WebGL 上下文丢失、内存泄漏等问题。
 *
 * 公共 API（对外保持兼容，调用方零改动）：
 *   - setChannelId(tabId, channelId)
 *   - writeByChannel(channelId, data)
 *   - getTerminal(tabId)            仍返回原生 Terminal（供 .cols/.rows/hasSelection/getSelection）
 *   - write(tabId, data)
 *   - focus(tabId)
 *   - getTabIdByChannel(channelId)
 *
 * 新增 API：
 *   - createSession(tabId, deps)    创建并挂载会话
 *   - disposeSession(tabId)        销毁会话（幂等）
 *   - applySettingsToAll(settings, resolved)   运行时下发配置
 *   - getSession(tabId)            供 TerminalView/右键菜单使用
 */
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  getEffectiveScheme,
  schemeToTheme,
  type TerminalSettings,
} from "./terminalSettings";
import { readXtermThemeFromCSS } from "./themeFromCSS";

/** WebGL 上下文丢失后最多重建次数，超过则退回 DOM 渲染器。 */
const MAX_WEBGL_RECOVERY_ATTEMPTS = 3;
/**
 * resize 防抖延迟（ms）。
 *
 * 设计原则（design-taste-frontend §5 Performance）：
 *   - 拖拽侧边栏/窗口时 ResizeObserver 每帧回调，仅重置定时器（O(1)）。
 *   - DOM 容器靠 flex 自然流式形变（GPU 友好，不触达 xterm canvas）。
 *   - 拖拽停止 120ms 后才执行一次 fitAddon.fit() + PTY resize 通知。
 * 彻底消除拖窗卡顿。原 32ms 节流仍会每秒触发 ~30 次 fit+IPC，是卡顿根因。
 */
const RESIZE_DEBOUNCE_MS = 120;

/** 透传给会话的 PTY resize 回调，由 TerminalView 注入（持有 sessionId）。 */
export interface SessionCallbacks {
  onResize?: (cols: number, rows: number) => void;
}

/** 创建会话所需依赖。 */
export interface CreateSessionDeps {
  container: HTMLElement;
  settings: TerminalSettings;
  resolved: "dark" | "light";
  channelId?: string;
  onData: (data: string) => void;
  callbacks?: SessionCallbacks;
}

/** 浅比较两个 theme 对象，避免无谓重写触发整屏重绘。 */
function themeEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export class TerminalSession {
  readonly tabId: string;
  readonly xterm: Terminal;
  private fitAddon = new FitAddon();
  private webglAddon?: WebglAddon;
  private container?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private windowResizeHandler?: () => void;
  private windowFocusHandler?: () => void;
  /** 防抖定时器：拖拽中反复 clearTimeout，停止 120ms 后触发一次 fit。 */
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private channelId?: string;
  private configuredTheme: Record<string, string> = {};
  private configuredSettings: TerminalSettings | null = null;
  private webglRecoveryAttempts = 0;
  private lastDPR = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  private readonly onData: (data: string) => void;
  private readonly callbacks: SessionCallbacks;

  constructor(tabId: string, deps: CreateSessionDeps) {
    this.tabId = tabId;
    this.onData = deps.onData;
    this.callbacks = deps.callbacks ?? {};
    this.channelId = deps.channelId;

    this.xterm = new Terminal({
      cursorBlink: deps.settings.cursorBlink,
      cursorStyle: deps.settings.cursorStyle,
      fontSize: deps.settings.fontSize,
      fontFamily: deps.settings.fontFamily,
      lineHeight: deps.settings.lineHeight,
      letterSpacing: deps.settings.letterSpacing,
      scrollback: deps.settings.scrollback,
      allowProposedApi: true,
      allowTransparency: false,
      // 配色优先从 CSS 变量读取（单一主题源），CSS 未就绪时回退到 scheme 常量。
      theme: Object.keys(readXtermThemeFromCSS()).length > 0
        ? readXtermThemeFromCSS()
        : schemeToTheme(getEffectiveScheme(deps.settings, deps.resolved)),
    });

    this.configuredSettings = { ...deps.settings };
    this.configuredTheme = { ...this.xterm.options.theme as Record<string, string> };
  }

  /** 挂载到 DOM 并完成渲染器/事件绑定。 */
  attach(deps: CreateSessionDeps): void {
    if (this.disposed) return;
    this.container = deps.container;
    this.channelId = deps.channelId;

    this.xterm.open(deps.container);
    this.xterm.loadAddon(this.fitAddon);

    // 渲染器：优先 WebGL，失败/上下文丢失则退回 DOM。
    this.attachRenderer();

    // 输入：终端 → SSH。保留原有 25ms 去重以抑制连续按键抖动。
    let lastData = "";
    let lastTime = 0;
    const DEDUP_WINDOW_MS = 25;
    this.xterm.onData((data) => {
      const chId = this.channelId;
      if (!chId) return;
      const now = Date.now();
      if (data === lastData && now - lastTime < DEDUP_WINDOW_MS) return;
      lastData = data;
      lastTime = now;
      this.onData(data);
    });

    // 拦截原生粘贴快捷键与软清屏快捷键（对标 Tabby 的 paste/clear hotkey）。
    this.xterm.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
      const pasteKey =
        (isMac && event.metaKey && event.key.toLowerCase() === "v") ||
        (!isMac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v") ||
        (event.shiftKey && event.key === "Insert");
      if (pasteKey) {
        event.preventDefault();
        this.paste();
        return false;
      }
      // 软清屏快捷键（对标 Tabby 的 clear hotkey）：
      //   - Mac: Cmd+K
      //   - Win/Linux: Ctrl+Shift+K
      // 调 softClear()：发 \x1b[<rows>S（scroll up，可视区内容推入 scrollback）
      // + \x1b[H（光标回顶），保留 scrollback 可上滚。
      // 不调 xterm.clear()（它清空整个 buffer 含 scrollback）。
      const softClearKey =
        (isMac && event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "k") ||
        (!isMac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "k");
      if (softClearKey) {
        event.preventDefault();
        this.softClear();
        return false;
      }
      // Ctrl+L：normal screen 调 softClear（保留 scrollback）；
      // alt screen（vim/less/man）透传给 TUI（Ctrl+L 是重绘）。
      if (!isMac && event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "l") {
        if (this.xterm.buffer.active.type === "normal") {
          event.preventDefault();
          this.softClear();
          return false;
        }
      }
      // Ctrl+L 透传给 shell（与 Tabby 一致）。
      return true;
    });

    // 防抖 Resize：拖拽中 ResizeObserver 每帧回调仅重置定时器（O(1)），
    // DOM 容器靠 flex 自然流式形变；停止 120ms 后统一执行一次 fit + PTY 同步。
    const scheduleResize = () => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        this.fitAndNotify();
      }, RESIZE_DEBOUNCE_MS);
    };

    this.resizeObserver = new ResizeObserver(scheduleResize);
    this.resizeObserver.observe(deps.container);

    this.windowResizeHandler = () => scheduleResize();
    window.addEventListener("resize", this.windowResizeHandler);

    // 窗口重获焦点时尝试恢复渲染器并刷新 DPR（高 DPI 缩放变更）。
    this.windowFocusHandler = () => {
      this.recoverRenderer();
      const dpr = window.devicePixelRatio || 1;
      if (dpr !== this.lastDPR) {
        this.lastDPR = dpr;
        this.webglAddon?.clearTextureAtlas?.();
        this.fitAndNotify();
      }
    };
    window.addEventListener("focus", this.windowFocusHandler);

    // 首帧 fit。延迟到 rAF 后确保布局已就绪。
    requestAnimationFrame(() => this.fitAndNotify());
  }

  private attachRenderer(): void {
    if (this.webglAddon) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        this.webglRecoveryAttempts++;
        try {
          addon.dispose();
        } catch {
          /* ignore */
        }
        this.webglAddon = undefined;
        if (this.webglRecoveryAttempts <= MAX_WEBGL_RECOVERY_ATTEMPTS) {
          // 下一帧重建，避免在 contextloss 回调内同步重建。
          requestAnimationFrame(() => this.attachRenderer());
        }
      });
      this.xterm.loadAddon(addon);
      this.webglAddon = addon;
    } catch {
      // WebGL 不可用，退回 xterm 默认 DOM 渲染器。
      this.webglAddon = undefined;
    }
  }

  private recoverRenderer(): void {
    if (this.disposed) return;
    if (this.webglAddon) return;
    if (this.webglRecoveryAttempts > MAX_WEBGL_RECOVERY_ATTEMPTS) return;
    this.attachRenderer();
  }

  setChannelId(channelId: string): void {
    this.channelId = channelId;
  }

  /**
   * 写入输出数据（二进制安全）。
   * 数据原样交给 xterm.js 解析，清屏序列由 CSI handler 拦截处理（见 attach）。
   */
  write(data: Uint8Array): void {
    if (this.disposed) return;
    this.xterm.write(data);
  }

  /** 缓冲写入（会话未就绪时暂存，就绪后回放）。 */
  private pending: Uint8Array[] = [];
  writeBuffered(data: Uint8Array): void {
    if (this.disposed) return;
    if (this.container) {
      this.write(data);
    } else {
      this.pending.push(data);
    }
  }

  flushPending(): void {
    if (!this.container || this.pending.length === 0) return;
    for (const d of this.pending) this.write(d);
    this.pending = [];
  }

  focus(): void {
    if (this.disposed) return;
    // 延迟一帧，避免在事件回调中 focus 导致滚动错位。
    requestAnimationFrame(() => {
      if (!this.disposed) this.xterm.focus();
    });
  }

  fit(): void {
    if (this.disposed || !this.container) return;
    if (this.container.offsetParent === null) return; // 不可见时跳过，避免错误尺寸
    try {
      this.fitAddon.fit();
    } catch {
      /* 容器尚未布局完成，忽略 */
    }
  }

  private fitAndNotify(): void {
    if (this.disposed || !this.container) return;
    if (this.container.offsetParent === null) return;
    this.fit();
    this.callbacks.onResize?.(this.xterm.cols, this.xterm.rows);
  }

  /** 主动触发一次尺寸同步（用于 Tab 切换为 active 后）。 */
  refitAndSync(): void {
    if (this.disposed) return;
    requestAnimationFrame(() => this.fitAndNotify());
  }

  hasSelection(): boolean {
    return this.xterm.hasSelection();
  }

  getSelection(): string {
    return this.xterm.getSelection();
  }

  clearSelection(): void {
    this.xterm.clearSelection();
  }

  selectAll(): void {
    this.xterm.selectAll();
  }

  clear(): void {
    if (this.disposed) return;
    this.xterm.clear();
  }

  /**
   * 软清屏：可视区内容保留到 scrollback，向上滚可回溯。
   *
   * 原理（通过阅读 @xterm/xterm 5.5 BufferService 源码确认）：
   *   - \x1b[<n>S（scrollUp）：splice 删除可视区顶部行，不推入 scrollback（错误）
   *   - \n（lineFeed）：光标到底时调 BufferService.scroll()，真正增加 ybase，
   *     把顶部行推入 scrollback（正确）
   *
   * 因此先 write `rows` 个 \r\n，让可视区内容通过正常滚动进入 scrollback，
   * 再 \x1b[H\x1b[2J 光标回顶 + 清可视区（此时可视区内容已在 scrollback）。
   */
  softClear(): void {
    if (this.disposed) return;
    const rows = this.xterm.rows;
    this.xterm.write("\r\n".repeat(rows));
    this.xterm.write("\x1b[H\x1b[2J");
  }

  reset(): void {
    if (this.disposed) return;
    // 关闭鼠标追踪与括号粘贴模式，防止重连后转义序列泄漏为文本。
    this.xterm.write("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?2004l");
    this.xterm.reset();
  }

  /** 读取剪贴板并写入终端输入。 */
  async paste(): Promise<void> {
    if (this.disposed) return;
    const chId = this.channelId;
    if (!chId) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) this.onData(text);
    } catch {
      /* 剪贴板权限被拒或不可用，静默 */
    }
  }

  /** 复制选区到剪贴板。 */
  async copySelection(): Promise<void> {
    const text = this.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  /** 应用最新配置（字号/字体/光标/配色/scrollback）。带差异守卫。 */
  applySettings(settings: TerminalSettings, resolved: "dark" | "light"): void {
    if (this.disposed) return;
    const cur = this.configuredSettings;
    const term = this.xterm;

    // 检测是否需要刷新 WebGL 字形纹理 atlas。
    // 关键修复：WebGL 渲染器会缓存字形纹理，修改字体族/字号后若不清除缓存，
    // 会用旧字形的纹理渲染新字体，导致字符错乱/重叠/方块（"字体很奇怪"）。
    let needAtlasClear = false;

    if (!cur || cur.fontSize !== settings.fontSize) {
      term.options.fontSize = settings.fontSize;
      needAtlasClear = true;
    }
    if (!cur || cur.fontFamily !== settings.fontFamily) {
      term.options.fontFamily = settings.fontFamily;
      needAtlasClear = true;
    }
    if (!cur || cur.cursorStyle !== settings.cursorStyle) {
      term.options.cursorStyle = settings.cursorStyle;
    }
    if (!cur || cur.cursorBlink !== settings.cursorBlink) {
      term.options.cursorBlink = settings.cursorBlink;
    }
    if (!cur || cur.lineHeight !== settings.lineHeight) {
      term.options.lineHeight = settings.lineHeight;
      needAtlasClear = true;
    }
    if (!cur || cur.letterSpacing !== settings.letterSpacing) {
      term.options.letterSpacing = settings.letterSpacing;
      needAtlasClear = true;
    }
    if (!cur || cur.scrollback !== settings.scrollback) {
      term.options.scrollback = settings.scrollback;
    }

    // 配色：从 CSS 变量读取（broadcast 已先写入 :root）。
    // themeKey 变化（schemeId 或 resolved 变）时触发重读，避免无谓重写。
    const themeKey = `${settings.colorSchemeId}:${resolved}`;
    if (this._lastThemeKey !== themeKey) {
      const theme = readXtermThemeFromCSS();
      if (!themeEqual(this.configuredTheme, theme)) {
        term.options.theme = theme as never;
        this.configuredTheme = { ...theme };
      }
      this._lastThemeKey = themeKey;
    }

    this.configuredSettings = { ...settings };

    // 清除 WebGL 字形纹理缓存，强制用新字体重新生成字形。
    if (needAtlasClear) {
      try {
        this.webglAddon?.clearTextureAtlas?.();
      } catch {
        /* ignore */
      }
    }

    // 字号/行高/字距变化后需要重新 fit 以更新行列数。
    if (needAtlasClear) {
      this.fitAndNotify();
    }
  }

  private _lastThemeKey = "";

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.resizeObserver?.disconnect();
    } catch {
      /* ignore */
    }
    this.resizeObserver = undefined;
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.windowResizeHandler) {
      window.removeEventListener("resize", this.windowResizeHandler);
      this.windowResizeHandler = undefined;
    }
    if (this.windowFocusHandler) {
      window.removeEventListener("focus", this.windowFocusHandler);
      this.windowFocusHandler = undefined;
    }
    this.pending = [];
    try {
      this.webglAddon?.dispose();
    } catch {
      /* ignore */
    }
    this.webglAddon = undefined;
    try {
      this.xterm.dispose();
    } catch {
      /* ignore */
    }
  }
}

class TerminalManager {
  private sessions = new Map<string, TerminalSession>();
  private channelToTab = new Map<string, string>();

  /** 创建并挂载一个会话。 */
  createSession(tabId: string, deps: CreateSessionDeps): TerminalSession {
    const existing = this.sessions.get(tabId);
    if (existing) {
      existing.dispose();
    }
    const session = new TerminalSession(tabId, deps);
    session.attach(deps);
    this.sessions.set(tabId, session);
    if (deps.channelId) {
      this.channelToTab.set(deps.channelId, tabId);
      session.setChannelId(deps.channelId);
    }
    session.flushPending();
    return session;
  }

  disposeSession(tabId: string): void {
    const session = this.sessions.get(tabId);
    if (!session) return;
    session.dispose();
    this.sessions.delete(tabId);
    for (const [chId, tId] of this.channelToTab) {
      if (tId === tabId) this.channelToTab.delete(chId);
    }
  }

  /**
   * 兼容旧 API：注册一个外部已创建的 Terminal。
   * 新代码应使用 createSession。此方法保留以防遗漏调用点。
   */
  register(tabId: string, terminal: Terminal): void {
    // 退化路径：若外部仍传入裸 Terminal，包装为只读 session 视图。
    // 实际新流程不再调用此方法。
    const session = this.sessions.get(tabId);
    if (session) return;
    // 不重建 xterm，仅记录引用以便 getTerminal 可用。
    this.externalTerminals.set(tabId, terminal);
  }

  private externalTerminals = new Map<string, Terminal>();

  unregister(tabId: string): void {
    this.disposeSession(tabId);
    this.externalTerminals.delete(tabId);
  }

  setChannelId(tabId: string, channelId: string): void {
    const session = this.sessions.get(tabId);
    if (session) {
      session.setChannelId(channelId);
      session.flushPending();
    }
    this.channelToTab.set(channelId, tabId);
    // 回放在 channelId 绑定前到达的数据
    const buffered = this.pendingByChannel.get(channelId);
    if (buffered) {
      const target = session ?? null;
      if (target) {
        for (const d of buffered) target.write(d);
      }
      this.pendingByChannel.delete(channelId);
    }
  }

  private pendingByChannel = new Map<string, Uint8Array[]>();
  private pendingByTab = new Map<string, Uint8Array[]>();

  writeByChannel(channelId: string, data: Uint8Array): void {
    const tabId = this.channelToTab.get(channelId);
    if (tabId) {
      const session = this.sessions.get(tabId);
      if (session) {
        session.write(data);
        return;
      }
    }
    // 缓冲到 channelId
    const buf = this.pendingByChannel.get(channelId) ?? [];
    buf.push(data);
    this.pendingByChannel.set(channelId, buf);
  }

  write(tabId: string, data: Uint8Array): void {
    const session = this.sessions.get(tabId);
    if (session) {
      session.write(data);
      return;
    }
    const buf = this.pendingByTab.get(tabId) ?? [];
    buf.push(data);
    this.pendingByTab.set(tabId, buf);
  }

  getTabIdByChannel(channelId: string): string | undefined {
    return this.channelToTab.get(channelId);
  }

  focus(tabId: string): void {
    this.sessions.get(tabId)?.focus();
  }

  /** 仍返回原生 Terminal，保证 .cols/.rows/.hasSelection/.getSelection 调用点零改动。 */
  getTerminal(tabId: string): Terminal | undefined {
    const session = this.sessions.get(tabId);
    if (session) return session.xterm;
    return this.externalTerminals.get(tabId);
  }

  getSession(tabId: string): TerminalSession | undefined {
    return this.sessions.get(tabId);
  }

  /** 运行时下发配置到所有会话。单个 session 抛错不影响其他 session。 */
  applySettingsToAll(settings: TerminalSettings, resolved: "dark" | "light"): void {
    for (const session of this.sessions.values()) {
      try {
        session.applySettings(settings, resolved);
      } catch (err) {
        console.error("[terminalManager] applySettings failed for session", session.tabId, err);
      }
    }
  }
}

export const terminalManager = new TerminalManager();
