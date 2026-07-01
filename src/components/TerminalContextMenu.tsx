import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUIStore } from "../stores/uiStore";
import { terminalManager } from "../terminal/terminalManager";
import { toast } from "../stores/toastStore";
import { useT } from "../stores/i18nStore";

interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorAfter?: boolean;
}

function TerminalContextMenuImpl() {
  const menu = useUIStore((s) => s.terminalContextMenu);
  const hide = useUIStore((s) => s.hideTerminalContextMenu);
  const t = useT();

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // 视口边界矫正，避免菜单溢出屏幕。
  useLayoutEffect(() => {
    if (!menu) return;
    const el = ref.current;
    const margin = 4;
    let x = menu.x;
    let y = menu.y;
    if (el) {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (x + rect.width + margin > vw) x = Math.max(margin, vw - rect.width - margin);
      if (y + rect.height + margin > vh) y = Math.max(margin, vh - rect.height - margin);
    }
    setPos({ x, y });
  }, [menu]);

  // 关闭：点击外部 / Esc / 滚动 / 失焦。
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onScroll = () => hide();
    const onBlur = () => hide();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("wheel", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("wheel", onScroll, true);
    };
  }, [menu, hide]);

  const run = useCallback(
    (fn: () => void) => {
      hide();
      // 关闭菜单后再执行，避免与焦点抢占；执行后重新聚焦终端，确保可立即键入。
      requestAnimationFrame(() => {
        fn();
        const s = menu ? terminalManager.getSession(menu.tabId) : undefined;
        s?.focus();
      });
    },
    [hide, menu],
  );

  if (!menu) return null;
  const session = terminalManager.getSession(menu.tabId);

  const hasSelection = session?.hasSelection() ?? false;

  const items: MenuItem[] = [
    {
      key: "copy",
      label: t("contextMenu.copy"),
      disabled: !hasSelection,
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3 9.5V3a1 1 0 0 1 1-1h6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
      onClick: () =>
        run(() => {
          session?.copySelection();
        }),
    },
    {
      key: "paste",
      label: t("contextMenu.paste"),
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5 7h4M7 5v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
      onClick: () =>
        run(() => {
          session?.paste();
        }),
    },
    {
      key: "select-all",
      label: t("contextMenu.selectAll"),
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="2.5" y="2.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4.5 7h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
      onClick: () =>
        run(() => {
          session?.selectAll();
        }),
      separatorAfter: true,
    },
    {
      key: "clear",
      label: t("contextMenu.clear"),
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 4h8M5 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M4 4l1 7a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1l1-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      onClick: () =>
        run(() => {
          session?.clear();
          toast(t("contextMenu.cleared"), { variant: "default", duration: 1500 });
        }),
    },
    {
      key: "reset",
      label: t("contextMenu.reset"),
      danger: true,
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2.5 7a4.5 4.5 0 1 0 1.3-3.2M2.5 3v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      onClick: () =>
        run(() => {
          session?.reset();
          toast(t("contextMenu.resetDone"), { variant: "warning", duration: 1500 });
        }),
    },
  ];

  return (
    <div
      ref={ref}
      className="context-menu context-menu--terminal"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <div key={item.key} className="context-menu-group">
          <button
            className={`context-menu-item ${item.disabled ? "context-menu-item--disabled" : ""} ${item.danger ? "context-menu-item--danger" : ""}`}
            disabled={item.disabled}
            onClick={item.disabled ? undefined : item.onClick}
          >
            <span className="context-menu-item-icon">{item.icon}</span>
            <span className="context-menu-item-label">{item.label}</span>
          </button>
          {item.separatorAfter && <div className="context-menu-separator" />}
        </div>
      ))}
    </div>
  );
}

export const TerminalContextMenu = memo(TerminalContextMenuImpl);
