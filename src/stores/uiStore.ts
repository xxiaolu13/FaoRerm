import { create } from "zustand";
import { useTerminalStore } from "./terminalStore";
import type { ServerConfig, ZmodemTransferState } from "../types";

interface UIStore {
  hostKeyModal: {
    sessionId: string;
    keyType: string;
    fingerprint: string;
  } | null;

  keyboardAuthModal: {
    sessionId: string;
    prompt: string;
  } | null;

  serverModal: {
    mode: "add" | "edit";
    server?: ServerConfig;
  } | null;

  blacklistModal: boolean;

  masterPasswordModal: boolean;

  sidebarCollapsed: boolean;

  rightDrawerOpen: boolean;

  lockScreenActive: boolean;

  activeSection: "servers" | "management";

  managementTab: "commands" | "blacklist" | "settings";

  selectedServerId: string | null;

  contextMenu: {
    x: number;
    y: number;
    tabId: string;
    sessionId: string;
    serverId: string;
  } | null;

  /** 终端内容区右键菜单（与 Tab 右键菜单区分）。 */
  terminalContextMenu: {
    x: number;
    y: number;
    tabId: string;
  } | null;

  zmodemTransfers: Map<string, ZmodemTransferState>;

  showHostKeyModal: (
    sessionId: string,
    keyType: string,
    fingerprint: string,
  ) => void;
  hideHostKeyModal: () => void;
  showKeyboardAuthModal: (sessionId: string, prompt: string) => void;
  hideKeyboardAuthModal: () => void;
  showServerModal: (mode: "add" | "edit", server?: ServerConfig) => void;
  hideServerModal: () => void;
  showBlacklistModal: () => void;
  hideBlacklistModal: () => void;
  showMasterPasswordModal: () => void;
  hideMasterPasswordModal: () => void;
  toggleSidebar: () => void;
  toggleRightDrawer: () => void;
  setRightDrawerOpen: (open: boolean) => void;
  activateLockScreen: () => void;
  deactivateLockScreen: () => void;
  setActiveSection: (section: "servers" | "management") => void;
  setManagementTab: (tab: "commands" | "blacklist" | "settings") => void;
  setSelectedServerId: (id: string | null) => void;
  showContextMenu: (
    x: number,
    y: number,
    tabId: string,
    sessionId: string,
    serverId: string,
  ) => void;
  hideContextMenu: () => void;
  /** 弹出终端内容右键菜单。 */
  showTerminalContextMenu: (x: number, y: number, tabId: string) => void;
  hideTerminalContextMenu: () => void;
  /** 显式设置侧边栏折叠态（与 section 切换解耦）。 */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** 切换到 servers 段但不触发侧边栏 toggle（专供 Tab 点击使用，避免穿透）。 */
  enterServers: () => void;
  addZmodemTransfer: (transfer: ZmodemTransferState) => void;
  updateZmodemTransfer: (channelId: string, update: Partial<ZmodemTransferState>) => void;
  removeZmodemTransfer: (channelId: string) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  hostKeyModal: null,
  keyboardAuthModal: null,
  serverModal: null,
  blacklistModal: false,
  masterPasswordModal: true,
  sidebarCollapsed: false,
  rightDrawerOpen: false,
  lockScreenActive: false,
  activeSection: "servers",
  managementTab: "commands",
  selectedServerId: null,
  contextMenu: null,
  terminalContextMenu: null,
  zmodemTransfers: new Map(),

  showHostKeyModal: (sessionId, keyType, fingerprint) =>
    set({ hostKeyModal: { sessionId, keyType, fingerprint } }),
  hideHostKeyModal: () => set({ hostKeyModal: null }),

  showKeyboardAuthModal: (sessionId, prompt) =>
    set({ keyboardAuthModal: { sessionId, prompt } }),
  hideKeyboardAuthModal: () => set({ keyboardAuthModal: null }),

  showServerModal: (mode, server) => set({ serverModal: { mode, server } }),
  hideServerModal: () => set({ serverModal: null }),

  showBlacklistModal: () => set({ blacklistModal: true }),
  hideBlacklistModal: () => set({ blacklistModal: false }),

  showMasterPasswordModal: () => set({ masterPasswordModal: true }),
  hideMasterPasswordModal: () => set({ masterPasswordModal: false }),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleRightDrawer: () =>
    set((state) => ({ rightDrawerOpen: !state.rightDrawerOpen })),
  setRightDrawerOpen: (open) => set({ rightDrawerOpen: open }),
  activateLockScreen: () => set({ lockScreenActive: true }),
  deactivateLockScreen: () => set({ lockScreenActive: false }),
  setActiveSection: (section) =>
    set((state) => {
      const isSameSection = state.activeSection === section;
      if (section === "servers") {
        // Activity Bar 入口：已是 servers 段时 toggle 侧边栏；从 management 切回时展开。
        return {
          activeSection: section,
          sidebarCollapsed: isSameSection ? !state.sidebarCollapsed : false,
        };
      }
      useTerminalStore.getState().setActiveTab(null);
      return { activeSection: section };
    }),
  // Tab 点击专用：切到 servers 段但绝不 toggle 侧边栏，杜绝穿透。
  enterServers: () => set({ activeSection: "servers" }),
  setManagementTab: (tab) => set({ managementTab: tab }),
  setSelectedServerId: (id) => set({ selectedServerId: id }),
  showContextMenu: (x, y, tabId, sessionId, serverId) =>
    set({ contextMenu: { x, y, tabId, sessionId, serverId } }),
  hideContextMenu: () => set({ contextMenu: null }),
  showTerminalContextMenu: (x, y, tabId) =>
    set({ terminalContextMenu: { x, y, tabId } }),
  hideTerminalContextMenu: () => set({ terminalContextMenu: null }),

  addZmodemTransfer: (transfer) =>
    set((state) => {
      const newMap = new Map(state.zmodemTransfers);
      newMap.set(transfer.channelId, transfer);
      return { zmodemTransfers: newMap };
    }),
  updateZmodemTransfer: (channelId, update) =>
    set((state) => {
      const newMap = new Map(state.zmodemTransfers);
      const existing = newMap.get(channelId);
      if (existing) {
        newMap.set(channelId, { ...existing, ...update });
      }
      return { zmodemTransfers: newMap };
    }),
  removeZmodemTransfer: (channelId) =>
    set((state) => {
      const newMap = new Map(state.zmodemTransfers);
      newMap.delete(channelId);
      return { zmodemTransfers: newMap };
    }),
}));
