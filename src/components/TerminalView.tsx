import { memo, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { terminalManager } from "../terminal/terminalManager";
import { useUIStore } from "../stores/uiStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useThemeStore } from "../stores/themeStore";
import { useTerminalSettingsStore } from "../stores/terminalSettingsStore";
import { useShallow } from "zustand/react/shallow";
import "@xterm/xterm/css/xterm.css";

interface Props {
  tabId: string;
  sessionId: string;
  channelId: string;
  active: boolean;
}

function TerminalViewImpl({ tabId, sessionId, channelId, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const channelIdRef = useRef(channelId);
  channelIdRef.current = channelId;

  // 用 useShallow 包装，避免 selector 返回新对象导致 React 18 useSyncExternalStore 误判 store 变化。
  const settings = useTerminalSettingsStore(
    useShallow((s) => ({
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      cursorStyle: s.cursorStyle,
      cursorBlink: s.cursorBlink,
      colorSchemeId: s.colorSchemeId,
      scrollback: s.scrollback,
      copyOnSelect: s.copyOnSelect,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
    })),
  );
  const resolved = useThemeStore((s) => s.resolved);

  const hostKeyModal = useUIStore((s) => s.hostKeyModal);
  const keyboardAuthModal = useUIStore((s) => s.keyboardAuthModal);
  const hideHostKeyModal = useUIStore((s) => s.hideHostKeyModal);
  const hideKeyboardAuthModal = useUIStore((s) => s.hideKeyboardAuthModal);
  const showTerminalContextMenu = useUIStore((s) => s.showTerminalContextMenu);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const tab = useTerminalStore((s) => s.tabs.get(tabId));
  const tabStatus = tab?.status ?? "connecting";

  // 输入回调：终端 → SSH。channelId 通过 ref 取最新值。
  const onData = useCallback(
    (data: string) => {
      const chId = channelIdRef.current;
      if (!chId) return;
      const bytes = Array.from(new TextEncoder().encode(data));
      invoke("ssh_send_data", {
        sessionId,
        channelId: chId,
        data: bytes,
      }).catch(console.error);
    },
    [sessionId],
  );

  // PTY 尺寸同步回调。
  const onResize = useCallback(
    (cols: number, rows: number) => {
      const chId = channelIdRef.current;
      if (!chId) return;
      invoke("ssh_resize_pty", {
        sessionId,
        channelId: chId,
        cols,
        rows,
      }).catch(console.error);
    },
    [sessionId],
  );

  // 创建会话（仅 tabId 变化时）。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 清理容器内可能残留的 xterm DOM（StrictMode 双调用或前次 dispose 异常）。
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    try {
      terminalManager.createSession(tabId, {
        container,
        settings,
        resolved,
        channelId: channelIdRef.current || undefined,
        onData,
        callbacks: { onResize },
      });
    } catch (err) {
      console.error("[TerminalView] createSession failed:", err);
    }
    // settings/resolved 的后续变化由 store 的 applySettingsToAll 统一下发，不在此重建会话。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // channelId 变化时同步到 manager（处理 useSshEvents 后绑定 channel 的场景）。
  useEffect(() => {
    if (channelId) {
      terminalManager.setChannelId(tabId, channelId);
    }
  }, [tabId, channelId]);

  // active 切换为 true 时重新 fit 并同步 PTY（替代原 setTimeout 黑魔法）。
  useEffect(() => {
    if (!active) return;
    const session = terminalManager.getSession(tabId);
    if (!session) return;
    session.refitAndSync();
    session.focus();
  }, [active, tabId]);

  const isHostKeyTarget = hostKeyModal?.sessionId === sessionId;
  const isKeyboardAuthTarget = keyboardAuthModal?.sessionId === sessionId;

  const showStatusOverlay =
    tabStatus === "connecting" ||
    tabStatus === "disconnected" ||
    tabStatus === "error";

  // 终端容器右键：拦截默认菜单，弹出桌面级自定义菜单。
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      showTerminalContextMenu(e.clientX, e.clientY, tabId);
    },
    [showTerminalContextMenu, tabId],
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: active ? "flex" : "none",
      }}
    >
      <div
        className="terminal-container"
        ref={containerRef}
        onContextMenu={handleContextMenu}
      />

      {showStatusOverlay && !isHostKeyTarget && !isKeyboardAuthTarget && (
        <div className="terminal-status-overlay">
          <div className="terminal-status-card">
            {tabStatus === "connecting" && (
              <>
                <div className="terminal-status-spinner">
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <circle cx="14" cy="14" r="11" stroke="currentColor" strokeWidth="2" strokeDasharray="50" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="terminal-status-text">Establishing connection...</span>
                <span className="terminal-status-hint">Connecting to {tab?.host ?? sessionId}</span>
              </>
            )}
            {tabStatus === "disconnected" && (
              <>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="terminal-status-icon terminal-status-icon--muted">
                  <circle cx="14" cy="14" r="11" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 10L18 18M18 10L10 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="terminal-status-text">Session Disconnected</span>
                <span className="terminal-status-hint">The remote connection has been closed</span>
              </>
            )}
            {tabStatus === "error" && (
              <>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="terminal-status-icon terminal-status-icon--error">
                  <path d="M14 3L25 24H3L14 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M14 11V16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="14" cy="20" r="1" fill="currentColor" />
                </svg>
                <span className="terminal-status-text">Connection Error</span>
                <span className="terminal-status-hint">Failed to establish or maintain the SSH session</span>
              </>
            )}
          </div>
        </div>
      )}

      {isHostKeyTarget && hostKeyModal && (
        <div className="tab-modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-icon modal-icon--warning">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L22 20H2L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M12 9V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="12" cy="17" r="1" fill="currentColor" />
                </svg>
              </div>
              <h2 className="modal-title">Host Key Verification</h2>
              <p className="modal-desc">
                The server's host key is not recognized. Verify the fingerprint before continuing.
              </p>
            </div>
            <div className="modal-body">
              <div className="key-info">
                <div className="key-info-row">
                  <span className="key-info-label">Key Type</span>
                  <code className="key-info-value">{hostKeyModal.keyType}</code>
                </div>
                <div className="key-info-row">
                  <span className="key-info-label">Fingerprint</span>
                  <code className="key-info-value key-fingerprint">{hostKeyModal.fingerprint}</code>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn--danger" onClick={async () => {
                try {
                  await invoke("ssh_confirm_host_key", { sessionId: hostKeyModal.sessionId, accepted: false });
                  const t = useTerminalStore.getState().tabs.get(tabId);
                  if (t?.channelId) {
                    await invoke("ssh_close_channel", { sessionId: hostKeyModal.sessionId, channelId: t.channelId });
                  } else {
                    await invoke("ssh_disconnect", { sessionId: hostKeyModal.sessionId });
                  }
                } catch {}
                removeTab(tabId);
                hideHostKeyModal();
              }}>
                Deny
              </button>
              <button className="btn btn--primary" onClick={async () => {
                try {
                  await invoke("ssh_confirm_host_key", { sessionId: hostKeyModal.sessionId, accepted: true });
                } catch (err) {
                  console.error("Failed to confirm host key:", err);
                }
                hideHostKeyModal();
              }}>
                Accept &amp; Trust
              </button>
            </div>
          </div>
        </div>
      )}

      {isKeyboardAuthTarget && keyboardAuthModal && (
        <KeyboardAuthInline
          sessionId={keyboardAuthModal.sessionId}
          prompt={keyboardAuthModal.prompt}
          onCancel={() => {
            const t = useTerminalStore.getState().tabs.get(tabId);
            if (t?.channelId) {
              invoke("ssh_close_channel", { sessionId: keyboardAuthModal.sessionId, channelId: t.channelId }).catch(() => {});
            } else {
              invoke("ssh_disconnect", { sessionId: keyboardAuthModal.sessionId }).catch(() => {});
            }
            removeTab(tabId);
            hideKeyboardAuthModal();
          }}
          onSubmit={async (response) => {
            try {
              await invoke("ssh_respond_keyboard_auth", { sessionId: keyboardAuthModal.sessionId, response });
              hideKeyboardAuthModal();
            } catch (err) {
              console.error("Failed to respond to keyboard auth:", err);
            }
          }}
        />
      )}
    </div>
  );
}

function KeyboardAuthInline({
  sessionId,
  prompt,
  onCancel,
  onSubmit,
}: {
  sessionId: string;
  prompt: string;
  onCancel: () => void;
  onSubmit: (response: string) => Promise<void>;
}) {
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isPassword = /password|passwd|secret/i.test(prompt);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const handleSubmit = async () => {
    if (!response) return;
    setLoading(true);
    try {
      await onSubmit(response);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tab-modal-overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-icon modal-icon--info">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M12 16V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="8" r="1" fill="currentColor" />
            </svg>
          </div>
          <h2 className="modal-title">Authentication Required</h2>
          <p className="modal-desc modal-desc--prompt">{prompt}</p>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor={`kb-auth-${sessionId}`}>
              Response
            </label>
            <input
              id={`kb-auth-${sessionId}`}
              ref={inputRef}
              className="input"
              type={isPassword ? "password" : "text"}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && response) handleSubmit();
              }}
              autoFocus
              placeholder={isPassword ? "Enter password..." : "Enter response..."}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={handleSubmit} disabled={loading || !response}>
            {loading ? "Sending..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const TerminalView = memo(TerminalViewImpl);
