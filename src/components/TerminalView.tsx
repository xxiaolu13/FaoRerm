import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { terminalManager } from "../terminal/terminalManager";
import { useUIStore } from "../stores/uiStore";
import { useTerminalStore } from "../stores/terminalStore";
import "xterm/css/xterm.css";

interface Props {
  tabId: string;
  sessionId: string;
  channelId: string;
  active: boolean;
}

export function TerminalView({ tabId, sessionId, channelId, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const channelIdRef = useRef(channelId);
  const hostKeyModal = useUIStore((s) => s.hostKeyModal);
  const keyboardAuthModal = useUIStore((s) => s.keyboardAuthModal);
  const hideHostKeyModal = useUIStore((s) => s.hideHostKeyModal);
  const hideKeyboardAuthModal = useUIStore((s) => s.hideKeyboardAuthModal);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const tab = useTerminalStore((s) => s.tabs.get(tabId));
  const tabStatus = tab?.status ?? "connecting";

  channelIdRef.current = channelId;

  useEffect(() => {
    if (termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, monospace',
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#f5e0dc",
        cursorAccent: "#1e1e1e",
        selectionBackground: "#3a3a3a",
        selectionForeground: "#d4d4d4",
        black: "#3a3a3a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#d4d4d4",
        brightBlack: "#4a4a4a",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a0a0a0",
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    try {
      term.loadAddon(new WebglAddon());
    } catch {
      console.warn("WebGL not available, falling back to canvas renderer");
    }

    if (containerRef.current) {
      term.open(containerRef.current);
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    }

    terminalManager.register(tabId, term);

    if (channelId) {
      terminalManager.setChannelId(tabId, channelId);
    }

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    let lastData = "";
    let lastTime = 0;
    const DEDUP_WINDOW_MS = 25;

    term.onData((data) => {
      const chId = channelIdRef.current;
      if (!chId) return;

      const now = Date.now();
      if (data === lastData && now - lastTime < DEDUP_WINDOW_MS) {
        return;
      }
      lastData = data;
      lastTime = now;

      const encoder = new TextEncoder();
      const bytes = Array.from(encoder.encode(data));
      invoke("ssh_send_data", {
        sessionId,
        channelId: chId,
        data: bytes,
      }).catch(console.error);
    });

    const observer = new ResizeObserver(() => {
      if (!containerRef.current || !fitAddonRef.current) return;
      if (containerRef.current.offsetParent === null) return;
      try {
        fitAddonRef.current.fit();
      } catch {}
      const chId = channelIdRef.current;
      if (termRef.current && chId) {
        invoke("ssh_resize_pty", {
          sessionId,
          channelId: chId,
          cols: termRef.current.cols,
          rows: termRef.current.rows,
        }).catch(console.error);
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
      terminalManager.unregister(tabId);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [tabId]);

  useEffect(() => {
    if (channelId && termRef.current) {
      terminalManager.setChannelId(tabId, channelId);
    }
  }, [tabId, channelId]);

  useEffect(() => {
    if (!active) return;

    const timers = [
      setTimeout(() => {
        if (!fitAddonRef.current || !containerRef.current) return;
        if (containerRef.current.offsetParent === null) return;
        try {
          fitAddonRef.current.fit();
        } catch {}
        if (termRef.current && channelIdRef.current) {
          invoke("ssh_resize_pty", {
            sessionId,
            channelId: channelIdRef.current,
            cols: termRef.current.cols,
            rows: termRef.current.rows,
          }).catch(console.error);
        }
      }, 30),
      setTimeout(() => {
        if (!fitAddonRef.current || !containerRef.current) return;
        if (containerRef.current.offsetParent === null) return;
        try {
          fitAddonRef.current.fit();
        } catch {}
        if (termRef.current && channelIdRef.current) {
          invoke("ssh_resize_pty", {
            sessionId,
            channelId: channelIdRef.current,
            cols: termRef.current.cols,
            rows: termRef.current.rows,
          }).catch(console.error);
        }
      }, 150),
    ];

    return () => timers.forEach(clearTimeout);
  }, [active, sessionId]);

  const isHostKeyTarget = hostKeyModal?.sessionId === sessionId;
  const isKeyboardAuthTarget = keyboardAuthModal?.sessionId === sessionId;

  const showStatusOverlay = tabStatus === "connecting" || tabStatus === "disconnected" || tabStatus === "error";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: active ? "flex" : "none",
      }}
    >
      <div className="terminal-container" ref={containerRef} />

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
