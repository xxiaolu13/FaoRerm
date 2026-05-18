import { create } from "zustand";
import type { TabState, TabStatus } from "../types";
import type { Channel } from "@tauri-apps/api/core";

interface TerminalStore {
  tabs: Map<string, TabState>;
  activeTabId: string | null;
  tabOrder: string[];
  channels: Map<string, Channel<number[]>>;

  addTab: (tab: TabState) => void;
  removeTab: (sessionId: string) => void;
  setActiveTab: (sessionId: string) => void;
  updateTabStatus: (sessionId: string, status: TabStatus) => void;
  updateTabChannelId: (sessionId: string, channelId: string) => void;
  setChannel: (sessionId: string, channel: Channel<number[]>) => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  tabs: new Map(),
  activeTabId: null,
  tabOrder: [],
  channels: new Map(),

  addTab: (tab) =>
    set((state) => {
      const newTabs = new Map(state.tabs);
      newTabs.set(tab.sessionId, tab);
      const newOrder = [...state.tabOrder, tab.sessionId];
      return {
        tabs: newTabs,
        activeTabId: tab.sessionId,
        tabOrder: newOrder,
      };
    }),

  removeTab: (sessionId) =>
    set((state) => {
      const newTabs = new Map(state.tabs);
      newTabs.delete(sessionId);
      const newChannels = new Map(state.channels);
      newChannels.delete(sessionId);
      const newOrder = state.tabOrder.filter((id) => id !== sessionId);
      const newActive =
        state.activeTabId === sessionId
          ? newOrder.length > 0
            ? newOrder[newOrder.length - 1]
            : null
          : state.activeTabId;
      return { tabs: newTabs, tabOrder: newOrder, activeTabId: newActive, channels: newChannels };
    }),

  setActiveTab: (sessionId) =>
    set({ activeTabId: sessionId }),

  updateTabStatus: (sessionId, status) =>
    set((state) => {
      const tab = state.tabs.get(sessionId);
      if (!tab) return state;
      const newTabs = new Map(state.tabs);
      newTabs.set(sessionId, { ...tab, status });
      return { tabs: newTabs };
    }),

  updateTabChannelId: (sessionId, channelId) =>
    set((state) => {
      const tab = state.tabs.get(sessionId);
      if (!tab) return state;
      const newTabs = new Map(state.tabs);
      newTabs.set(sessionId, { ...tab, channelId });
      return { tabs: newTabs };
    }),

  setChannel: (sessionId, channel) =>
    set((state) => {
      const newChannels = new Map(state.channels);
      newChannels.set(sessionId, channel);
      return { channels: newChannels };
    }),
}));
