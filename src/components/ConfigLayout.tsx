import { type ReactNode } from "react";

interface ConfigLayoutProps {
  /** 可选页面标题，渲染在内容上方。 */
  title?: string;
  /** 附加 className（与 config-layout 合并）。 */
  className?: string;
  children: ReactNode;
}

/**
 * 配置页面统一布局容器。
 *
 * 设计原则（minimalist-ui / redesign-existing-projects）：
 * - 居中对齐（max-w-4xl mx-auto），避免宽屏拉伸导致阅读困难
 * - 统一 padding、section 间距、滚动行为
 * - 消除内联 style，统一配置页命名空间
 *
 * 所有 Settings / Management 子页面应通过 ConfigLayout 包裹，
 * 保证视觉一致，杜绝"settings-* 与 mgmt-* 各自为政"的割裂。
 */
export function ConfigLayout({ title, className, children }: ConfigLayoutProps) {
  return (
    <div className={`config-layout${className ? ` ${className}` : ""}`}>
      {title && <h2 className="config-layout-title">{title}</h2>}
      {children}
    </div>
  );
}
