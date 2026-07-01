import { create } from "zustand";
import { en, type Dict } from "../i18n/en";
import { zh } from "../i18n/zh";

export type Lang = "en" | "zh";

const dicts: Record<Lang, Dict> = { en, zh };

/** 从 localStorage 读取初始语言，默认英文。 */
function getInitialLang(): Lang {
  const stored = localStorage.getItem("faorerm-lang");
  return stored === "zh" || stored === "en" ? stored : "en";
}

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  lang: getInitialLang(),
  setLang: (lang) => {
    localStorage.setItem("faorerm-lang", lang);
    set({ lang });
  },
  toggleLang: () => {
    set((s) => {
      const next = s.lang === "en" ? "zh" : "en";
      localStorage.setItem("faorerm-lang", next);
      return { lang: next };
    });
  },
}));

/** 按点分路径取嵌套值。 */
function lookup(dict: Dict, key: string): string {
  const parts = key.split(".");
  let val: unknown = dict;
  for (const p of parts) {
    if (val && typeof val === "object" && p in (val as object)) {
      val = (val as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof val === "string" ? val : key;
}

/**
 * 翻译函数（非响应式）。适用于回调、store、工具函数中不需要触发重渲染的场景。
 * 支持 {placeholder} 插值：t("terminal.connectingTo", { host: "1.2.3.4" })
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = useI18nStore.getState().lang;
  const raw = lookup(dicts[lang], key);
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`
  );
}

/**
 * 响应式翻译 hook。语言切换时自动触发组件重渲染。
 * 返回与 t 相同签名的翻译函数。
 */
export function useT() {
  const lang = useI18nStore((s) => s.lang);
  return (key: string, vars?: Record<string, string | number>): string => {
    const raw = lookup(dicts[lang], key);
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, k: string) =>
      k in vars ? String(vars[k]) : `{${k}}`
    );
  };
}
