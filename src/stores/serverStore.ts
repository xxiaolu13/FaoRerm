import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  ServerConfig,
  BlacklistConfig,
  FaoConfig,
} from "../types";

interface ServerStore {
  servers: Record<string, ServerConfig>;
  quickCommands: Record<string, string>;
  blacklist: BlacklistConfig | null;
  masterPasswordSet: boolean;
  loading: boolean;

  loadServers: () => Promise<void>;
  loadAllConfig: () => Promise<void>;
  loadBlacklist: () => Promise<void>;
  checkMasterPassword: () => Promise<void>;
  addServer: (key: string, server: ServerConfig) => Promise<void>;
  deleteServer: (id: string) => Promise<void>;
  addBlacklistItem: (contain: string) => Promise<void>;
  addQuickCommand: (description: string, command: string) => Promise<void>;
  deleteQuickCommand: (description: string) => Promise<void>;
  unlockMasterPassword: (password: string) => Promise<void>;
  clearMasterPassword: () => Promise<void>;
}

export const useServerStore = create<ServerStore>((set) => ({
  servers: {},
  quickCommands: {},
  blacklist: null,
  masterPasswordSet: false,
  loading: false,

  loadServers: async () => {
    try {
      const servers = await invoke<Record<string, ServerConfig>>(
        "get_all_server",
      );
      set({ servers });
    } catch (err) {
      console.error("Failed to load servers:", err);
    }
  },

  loadAllConfig: async () => {
    try {
      const config = await invoke<FaoConfig>("get_all_config");
      set({
        servers: config.server,
        quickCommands: config.quick_command,
        blacklist: config.global_blacklist,
      });
    } catch (err) {
      console.error("Failed to load config:", err);
    }
  },

  loadBlacklist: async () => {
    try {
      const blacklist = await invoke<BlacklistConfig>("get_blacklist_config");
      set({ blacklist });
    } catch (err) {
      console.error("Failed to load blacklist:", err);
    }
  },

  checkMasterPassword: async () => {
    try {
      const status = await invoke<boolean>("get_master_password_status");
      set({ masterPasswordSet: status });
    } catch (err) {
      console.error("Failed to check master password:", err);
    }
  },

  addServer: async (key, server) => {
    try {
      await invoke("add_server_config", { serverKey: key, server });
      // Reload servers after adding
      const servers = await invoke<Record<string, ServerConfig>>(
        "get_all_server",
      );
      set({ servers });
    } catch (err) {
      console.error("Failed to add server:", err);
      throw err;
    }
  },

  deleteServer: async (id) => {
    try {
      await invoke("del_server_config", { serverId: id });
      set((state) => {
        const newServers = { ...state.servers };
        delete newServers[id];
        return { servers: newServers };
      });
    } catch (err) {
      console.error("Failed to delete server:", err);
      throw err;
    }
  },

  addBlacklistItem: async (contain) => {
    try {
      await invoke("add_blacklist_config", { contain });
      const blacklist = await invoke<BlacklistConfig>("get_blacklist_config");
      set({ blacklist });
    } catch (err) {
      console.error("Failed to add blacklist item:", err);
      throw err;
    }
  },

  addQuickCommand: async (description, command) => {
    try {
      await invoke("add_and_edit_quick_command", { description, command });
      set((state) => ({
        quickCommands: { ...state.quickCommands, [description]: command },
      }));
    } catch (err) {
      console.error("Failed to add quick command:", err);
      throw err;
    }
  },

  deleteQuickCommand: async (description) => {
    try {
      await invoke("del_quick_command", { description });
      set((state) => {
        const newCommands = { ...state.quickCommands };
        delete newCommands[description];
        return { quickCommands: newCommands };
      });
    } catch (err) {
      console.error("Failed to delete quick command:", err);
      throw err;
    }
  },

  unlockMasterPassword: async (password) => {
    try {
      await invoke("unlock", { password });
      set({ masterPasswordSet: true });
    } catch (err) {
      console.error("Failed to unlock:", err);
      throw err;
    }
  },

  clearMasterPassword: async () => {
    try {
      await invoke("clear_master_password");
      set({ masterPasswordSet: false });
    } catch (err) {
      console.error("Failed to clear master password:", err);
    }
  },
}));
