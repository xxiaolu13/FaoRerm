import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ProviderConfig, CopilotConfirmEvent } from "../types";

export interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "error";
  result?: string;
  durationMs?: number;
}

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking: string;
  toolCalls: ToolCallInfo[];
  status: "streaming" | "done" | "error";
  error?: string;
}

interface ChannelConversation {
  messages: CopilotMessage[];
  loading: boolean;
}

interface ConfirmRequest {
  requestId: string;
  tool: string;
  input: unknown;
  description: string;
  permissionLevel: string;
}

interface ConfirmQueueItem {
  requestId: string;
  tool: string;
  input: unknown;
  description: string;
  permissionLevel: string;
}

interface AIStore {
  providers: Record<string, ProviderConfig>;
  defaultProvider: string;
  conversations: Record<string, ChannelConversation>;
  confirmRequest: ConfirmRequest | null;
  confirmQueue: ConfirmQueueItem[];
  _listeners: Record<string, UnlistenFn>;
  _lastAskChannelId: string | null;
  processConfirmQueue: () => void;

  getChannelConv: (channelId: string) => ChannelConversation;
  loadProviders: () => Promise<void>;
  upsertProvider: (name: string, config: ProviderConfig) => Promise<void>;
  deleteProvider: (name: string) => Promise<void>;
  setDefaultProvider: (name: string) => Promise<void>;
  ask: (sessionId: string, channelId: string, question: string) => Promise<void>;
  cancelAsk: (channelId: string) => Promise<void>;
  confirmDecision: (requestId: string, approved: boolean) => void;
  dismissConfirm: () => void;
  clearMessages: (channelId: string) => void;
  initChannelListener: (channelId: string) => Promise<void>;
  removeChannelListener: (channelId: string) => void;
  initConfirmListener: () => Promise<UnlistenFn>;
}

let msgCounter = 0;

function emptyConv(): ChannelConversation {
  return {
    messages: [],
    loading: false,
  };
}

export const useAIStore = create<AIStore>((set, get) => ({
  providers: {},
  defaultProvider: "",
  conversations: {},
  confirmRequest: null,
  confirmQueue: [],
  _listeners: {},
  _lastAskChannelId: null,

  processConfirmQueue: () => {
    set((s) => {
      if (s.confirmRequest !== null) return s;
      if (s.confirmQueue.length === 0) return s;
      const [next, ...rest] = s.confirmQueue;
      return {
        confirmRequest: {
          requestId: next.requestId,
          tool: next.tool,
          input: next.input,
          description: next.description,
          permissionLevel: next.permissionLevel,
        },
        confirmQueue: rest,
      };
    });
  },

  getChannelConv: (channelId) => {
    return get().conversations[channelId] || emptyConv();
  },

  loadProviders: async () => {
    try {
      const config = await invoke<{ ai: { providers: Record<string, ProviderConfig>; default_provider: string } }>("get_all_config");
      set({ providers: config.ai.providers, defaultProvider: config.ai.default_provider });
    } catch (err) {
      console.error("Failed to load AI providers:", err);
    }
  },

  upsertProvider: async (name, config) => {
    try {
      await invoke("upsert_ai_provider", { name, config });
      await get().loadProviders();
    } catch (err) {
      console.error("Failed to upsert AI provider:", err);
      throw err;
    }
  },

  deleteProvider: async (name) => {
    try {
      await invoke("delete_ai_provider", { name });
      await get().loadProviders();
    } catch (err) {
      console.error("Failed to delete AI provider:", err);
      throw err;
    }
  },

  setDefaultProvider: async (name) => {
    try {
      await invoke("set_default_ai_provider", { name });
      set({ defaultProvider: name });
    } catch (err) {
      console.error("Failed to set default AI provider:", err);
      throw err;
    }
  },

  ask: async (sessionId, channelId, question) => {
    const conv = get().conversations[channelId] || emptyConv();
    if (conv.loading) return;
    set({ _lastAskChannelId: channelId });

    const userMsg: CopilotMessage = {
      id: `msg-${++msgCounter}`,
      role: "user",
      content: question,
      thinking: "",
      toolCalls: [],
      status: "done",
    };

    const assistantMsg: CopilotMessage = {
      id: `msg-${++msgCounter}`,
      role: "assistant",
      content: "",
      thinking: "",
      toolCalls: [],
      status: "streaming",
    };

    const newMessages = [...conv.messages, userMsg, assistantMsg];

    set((s) => ({
      conversations: {
        ...s.conversations,
        [channelId]: { messages: newMessages, loading: true },
      },
    }));

    await get().initChannelListener(channelId);

    try {
      await invoke("copilot_ask", { sessionId, channelId, question });
    } catch (err) {
      const errMsg = String(err);
      set((s) => {
        const c = s.conversations[channelId];
        if (!c) return s;
        const msgs = [...c.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === "assistant") {
          msgs[msgs.length - 1] = { ...last, status: "error", error: errMsg };
        }
        return {
          conversations: {
            ...s.conversations,
            [channelId]: { ...c, messages: msgs, loading: false },
          },
        };
      });
    }
  },

  cancelAsk: async (channelId) => {
    try {
      await invoke("copilot_cancel", { channelId });
    } catch (err) {
      console.error("Failed to cancel:", err);
    }
    set((s) => {
      const c = s.conversations[channelId];
      if (!c) return s;
      const msgs = [...c.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant" && last.status === "streaming") {
        msgs[msgs.length - 1] = { ...last, status: "done" };
      }
      return {
        conversations: {
          ...s.conversations,
          [channelId]: { ...c, messages: msgs, loading: false },
        },
        confirmRequest: null,
        confirmQueue: [],
      };
    });
    get().removeChannelListener(channelId);
  },

  confirmDecision: (requestId, approved) => {
    const req = get().confirmRequest;
    // 先立即切换 UI（不等后端返回），避免点 Allow 后确认框卡住
    set({ confirmRequest: null });
    get().processConfirmQueue();

    // 点 Allow 后命令已发送到终端，立即把对应的 running tool_call 标记为 done，
    // 不等 ToolEnd 事件（cersei 可能因 wait_for_output 延迟很久才 emit ToolEnd）
    if (approved && req) {
      const channelId = get()._lastAskChannelId;
      if (channelId) {
        set((s) => {
          const c = s.conversations[channelId];
          if (!c) return s;
          const msgs = [...c.messages];
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== "assistant") return s;
          const toolCalls = [...last.toolCalls];
          let changed = false;
          for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            if (tc.status === "running" && tc.name === req.tool) {
              toolCalls[i] = { ...tc, status: "done" as const };
              changed = true;
              break; // 只标记第一个匹配的（cersei 串行/并发都适用）
            }
          }
          if (!changed) return s;
          msgs[msgs.length - 1] = { ...last, toolCalls };
          return {
            conversations: {
              ...s.conversations,
              [channelId]: { ...c, messages: msgs },
            },
          };
        });
      }
    }

    // fire-and-forget 发送决策到后端
    invoke("copilot_confirm_decision", { requestId, approved }).catch((err) => {
      console.error("Failed to send confirm decision:", err);
    });
  },

  dismissConfirm: () => {
    set({ confirmRequest: null });
  },

  clearMessages: (channelId) => {
    set((s) => ({
      conversations: {
        ...s.conversations,
        [channelId]: emptyConv(),
      },
    }));
  },

  initChannelListener: async (channelId) => {
    if (get()._listeners[channelId]) return;

    const unlisten = await listen(`copilot:event:${channelId}`, (event) => {
      const payload = event.payload as { type: string; [key: string]: unknown };

      set((s) => {
        const c = s.conversations[channelId];
        if (!c) return s;

        const msgs = [...c.messages];
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== "assistant") return s;

        const updated = { ...last };
        const toolCalls = [...updated.toolCalls];

        switch (payload.type) {
          case "text_delta":
            updated.content += (payload.text as string) || "";
            break;
          case "thinking_delta":
            updated.thinking += (payload.text as string) || "";
            break;
          case "tool_start": {
            const tc: ToolCallInfo = {
              id: payload.id as string,
              name: payload.name as string,
              input: payload.input,
              status: "running",
            };
            toolCalls.push(tc);
            updated.toolCalls = toolCalls;
            break;
          }
          case "tool_end": {
            const idx = toolCalls.findIndex((t) => t.id === (payload.id as string));
            if (idx >= 0) {
              toolCalls[idx] = {
                ...toolCalls[idx],
                status: (payload.is_error as boolean) ? "error" : "done",
                result: payload.result as string,
                durationMs: payload.duration_ms as number,
              };
            }
            updated.toolCalls = toolCalls;
            break;
          }
          case "status":
            break;
          case "error":
            updated.status = "error";
            updated.error = payload.message as string;
            break;
          case "complete":
            updated.status = "done";
            if (payload.text && !updated.content) {
              updated.content = payload.text as string;
            }
            break;
        }

        msgs[msgs.length - 1] = updated;
        const loading = updated.status === "streaming";
        return {
          conversations: {
            ...s.conversations,
            [channelId]: { ...c, messages: msgs, loading },
          },
        };
      });

      if (payload.type === "complete" || payload.type === "error") {
        get().removeChannelListener(channelId);
        set({ confirmRequest: null, confirmQueue: [] });
      }
    });

    set((s) => ({
      _listeners: { ...s._listeners, [channelId]: unlisten },
    }));
  },

  removeChannelListener: (channelId) => {
    const unlisten = get()._listeners[channelId];
    if (unlisten) {
      unlisten();
      set((s) => {
        const next = { ...s._listeners };
        delete next[channelId];
        return { _listeners: next };
      });
    }
  },

  initConfirmListener: async () => {
    const unlisten = await listen<CopilotConfirmEvent>("copilot:confirm", (event) => {
      const item: ConfirmQueueItem = {
        requestId: event.payload.request_id,
        tool: event.payload.tool,
        input: event.payload.input,
        description: (event.payload as unknown as { description?: string }).description || "",
        permissionLevel: (event.payload as unknown as { permission_level?: string }).permission_level || "",
      };
      set((s) => ({ confirmQueue: [...s.confirmQueue, item] }));
      get().processConfirmQueue();
    });
    return unlisten;
  },
}));
