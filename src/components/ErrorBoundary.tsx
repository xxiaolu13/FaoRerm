import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * 全局错误边界：捕获任何子树渲染期/ effect 期的未处理错误，
 * 避免整屏白屏，并显示可复制的错误信息便于定位。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: undefined });
    // 强制刷新以确保状态一致
    if (typeof window !== "undefined") window.location.reload();
  };

  handleCopy = async () => {
    const { error } = this.state;
    if (!error) return;
    const text = `${error.name}: ${error.message}\n${error.stack ?? ""}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const { error } = this.state;
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1e1e1e",
          color: "#d4d4d4",
          fontFamily: "monospace",
          padding: 24,
          zIndex: 9999,
        }}
      >
        <div style={{ maxWidth: 640, width: "100%" }}>
          <h2 style={{ marginTop: 0, color: "#f38ba8" }}>
            应用渲染时发生致命错误
          </h2>
          <p style={{ color: "#a0a0a0", fontSize: 13 }}>
            已被 ErrorBoundary 捕获，避免整屏白屏。请将下方错误信息反馈给开发者后重载。
          </p>
          <pre
            style={{
              background: "#0d0d0d",
              border: "1px solid #3a3a3a",
              borderRadius: 6,
              padding: 12,
              fontSize: 12,
              lineHeight: 1.5,
              overflow: "auto",
              maxHeight: 320,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {error?.name}: {error?.message}
            {"\n\n"}
            {error?.stack}
          </pre>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button
              onClick={this.handleCopy}
              style={{
                padding: "6px 14px",
                background: "#3a3a3a",
                color: "#d4d4d4",
                border: "1px solid #4a4a4a",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              复制错误信息
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: "6px 14px",
                background: "#89b4fa",
                color: "#1e1e1e",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              重载应用
            </button>
          </div>
        </div>
      </div>
    );
  }
}
