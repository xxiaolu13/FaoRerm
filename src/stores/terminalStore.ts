import { create } from "zustand";
import type { TabState, TabStatus } from "../types";
import type { Channel } from "@tauri-apps/api/core";
import type { ChannelOutput } from "../types";

export interface ActiveSession {
  sessionId: string;
  channelId: string;
}

interface TerminalStore {
  tabs: Map<string, TabState>;
  activeTabId: string | null;
  activeSession: ActiveSession | null;
  tabOrder: string[];
  channels: Map<string, Channel<ChannelOutput>>;

  addTab: (tab: TabState) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  updateTabStatus: (tabId: string, status: TabStatus) => void;
  updateTabChannelId: (tabId: string, channelId: string) => void;
  setChannel: (sessionId: string, channel: Channel<ChannelOutput>) => void;
  getTabsBySessionId: (sessionId: string) => TabState[];
  updateTabStatusByChannelId: (channelId: string, status: TabStatus) => void;
}

function computeActiveSession(tabs: Map<string, TabState>, activeTabId: string | null): ActiveSession | null {
  if (!activeTabId) return null;
  const tab = tabs.get(activeTabId);
  if (!tab || !tab.channelId) return null;
  return { sessionId: tab.sessionId, channelId: tab.channelId };
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  tabs: new Map(),
  activeTabId: null,
  activeSession: null,
  tabOrder: [],
  channels: new Map(),

  addTab: (tab) =>
    set((state) => {
      const newTabs = new Map(state.tabs);
      newTabs.set(tab.tabId, tab);
      const newOrder = [...state.tabOrder, tab.tabId];
      return {
        tabs: newTabs,
        activeTabId: tab.tabId,
        activeSession: computeActiveSession(newTabs, tab.tabId),
        tabOrder: newOrder,
      };
    }),

  removeTab: (tabId) =>
    set((state) => {
      const tab = state.tabs.get(tabId);
      const newTabs = new Map(state.tabs);
      newTabs.delete(tabId);
      const newOrder = state.tabOrder.filter((id) => id !== tabId);
      const newActive =
        state.activeTabId === tabId
          ? newOrder.length > 0
            ? newOrder[newOrder.length - 1]
            : null
          : state.activeTabId;

      const newChannels = new Map(state.channels);
      if (tab) {
        const remainingSessionTabs = [...newTabs.values()].filter(
          (t) => t.sessionId === tab.sessionId
        );
        if (remainingSessionTabs.length === 0) {
          newChannels.delete(tab.sessionId);
        }
      }

      return {
        tabs: newTabs,
        tabOrder: newOrder,
        activeTabId: newActive,
        activeSession: computeActiveSession(newTabs, newActive),
        channels: newChannels,
      };
    }),

  setActiveTab: (tabId) =>
    set((state) => ({
      activeTabId: tabId,
      activeSession: computeActiveSession(state.tabs, tabId),
    })),

  updateTabStatus: (tabId, status) =>
    set((state) => {
      const tab = state.tabs.get(tabId);
      if (!tab) return state;
      const newTabs = new Map(state.tabs);
      newTabs.set(tabId, { ...tab, status });
      return { tabs: newTabs };
    }),

  updateTabChannelId: (tabId, channelId) =>
    set((state) => {
      const tab = state.tabs.get(tabId);
      if (!tab) return state;
      const newTabs = new Map(state.tabs);
      newTabs.set(tabId, { ...tab, channelId });
      const newActiveSession = computeActiveSession(newTabs, state.activeTabId);
      return { tabs: newTabs, activeSession: newActiveSession };
    }),

  setChannel: (sessionId, channel) =>
    set((state) => {
      const newChannels = new Map(state.channels);
      newChannels.set(sessionId, channel);
      return { channels: newChannels };
    }),

  getTabsBySessionId: (sessionId) => {
    const tabs = get().tabs;
    return [...tabs.values()].filter((t) => t.sessionId === sessionId);
  },

  updateTabStatusByChannelId: (channelId, status) =>
    set((state) => {
      const newTabs = new Map(state.tabs);
      for (const [tabId, tab] of state.tabs) {
        if (tab.channelId === channelId) {
          newTabs.set(tabId, { ...tab, status });
        }
      }
      return { tabs: newTabs };
    }),
}));
