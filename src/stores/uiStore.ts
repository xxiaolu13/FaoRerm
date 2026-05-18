import { create } from "zustand";
import type { ServerConfig } from "../types";

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
  toggleRightDrawer: () =>
    set((state) => ({ rightDrawerOpen: !state.rightDrawerOpen })),
  setRightDrawerOpen: (open) => set({ rightDrawerOpen: open }),
  activateLockScreen: () => set({ lockScreenActive: true }),
  deactivateLockScreen: () => set({ lockScreenActive: false }),
  setActiveSection: (section) =>
    set((state) => {
      const isSameSection = state.activeSection === section;
      if (section === "servers") {
        return {
          activeSection: section,
          sidebarCollapsed: isSameSection ? !state.sidebarCollapsed : false,
        };
      }
      return { activeSection: section };
    }),
  setManagementTab: (tab) => set({ managementTab: tab }),
  setSelectedServerId: (id) => set({ selectedServerId: id }),
  showContextMenu: (x, y, tabId, sessionId, serverId) =>
    set({ contextMenu: { x, y, tabId, sessionId, serverId } }),
  hideContextMenu: () => set({ contextMenu: null }),
}));
