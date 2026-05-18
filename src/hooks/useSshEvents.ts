import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTerminalStore } from "../stores/terminalStore";
import { useUIStore } from "../stores/uiStore";
import { toast } from "../stores/toastStore";
import { terminalManager } from "../terminal/terminalManager";
import type { SshEvent, TabStatus } from "../types";

export function useSshEvents() {
  const updateTabStatus = useTerminalStore((s) => s.updateTabStatus);
  const updateTabChannelId = useTerminalStore((s) => s.updateTabChannelId);
  const updateTabStatusByChannelId = useTerminalStore((s) => s.updateTabStatusByChannelId);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const showHostKeyModal = useUIStore((s) => s.showHostKeyModal);
  const showKeyboardAuthModal = useUIStore((s) => s.showKeyboardAuthModal);

  const callbacksRef = useRef({
    updateTabStatus,
    updateTabChannelId,
    updateTabStatusByChannelId,
    removeTab,
    showHostKeyModal,
    showKeyboardAuthModal,
  });
  callbacksRef.current = {
    updateTabStatus,
    updateTabChannelId,
    updateTabStatusByChannelId,
    removeTab,
    showHostKeyModal,
    showKeyboardAuthModal,
  };

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    (async () => {
      const fn = await listen<SshEvent>("ssh:event", (event) => {
        const { session_id, channel_id, kind } = event.payload;
        const cb = callbacksRef.current;

        switch (kind.type) {
          case "state": {
            if (kind.state === "Connected") {
              const store = useTerminalStore.getState();
              const sessionTabs = store.getTabsBySessionId(session_id);
              const connectingTab = sessionTabs.find((t) => t.status === "connecting");

              if (connectingTab) {
                const chId = crypto.randomUUID();
                cb.updateTabChannelId(connectingTab.tabId, chId);
                cb.updateTabStatus(connectingTab.tabId, "connected" as TabStatus);
                terminalManager.setChannelId(connectingTab.tabId, chId);

                const term = terminalManager.getTerminal(connectingTab.tabId);
                const cols = term?.cols ?? 80;
                const rows = term?.rows ?? 24;

                invoke("ssh_open_shell", {
                  sessionId: session_id,
                  channelId: chId,
                  cols,
                  rows,
                }).catch((err) => {
                  console.error("Failed to open shell:", err);
                  cb.updateTabStatus(connectingTab.tabId, "error");
                  toast("Shell open failed", { description: String(err), variant: "error" });
                });

                toast("Connected", { description: "Session established", variant: "success" });
              }
            } else if (kind.state === "Disconnected") {
              const store = useTerminalStore.getState();
              const sessionTabs = store.getTabsBySessionId(session_id);
              for (const tab of sessionTabs) {
                cb.updateTabStatus(tab.tabId, "disconnected");
              }
              toast("Disconnected", { description: "Session closed", variant: "warning" });
            } else if (kind.state === "Connecting") {
              const store = useTerminalStore.getState();
              const sessionTabs = store.getTabsBySessionId(session_id);
              for (const tab of sessionTabs) {
                if (tab.status === "connecting") {
                  cb.updateTabStatus(tab.tabId, "connecting");
                }
              }
            }
            break;
          }

          case "error": {
            const store = useTerminalStore.getState();
            const sessionTabs = store.getTabsBySessionId(session_id);
            for (const tab of sessionTabs) {
              cb.updateTabStatus(tab.tabId, "error");
            }
            toast("SSH Error", { description: kind.error, variant: "error" });
            break;
          }

          case "session_dropped": {
            const store = useTerminalStore.getState();
            const sessionTabs = store.getTabsBySessionId(session_id);
            for (const tab of sessionTabs) {
              cb.removeTab(tab.tabId);
            }
            toast("Session dropped", { description: "Backend session cleaned up", variant: "warning" });
            break;
          }

          case "host_key_unknown": {
            cb.showHostKeyModal(session_id, kind.key_type, kind.fingerprint);
            break;
          }

          case "host_key_received": {
            console.log("Host key received:", kind.fingerprint);
            break;
          }

          case "keyboard_auth": {
            cb.showKeyboardAuthModal(session_id, kind.prompt);
            break;
          }

          case "channel_success": {
            if (channel_id) {
              const store = useTerminalStore.getState();
              const tab = [...store.tabs.values()].find(
                (t) => t.channelId === channel_id && t.status === "connecting"
              );
              if (tab) {
                cb.updateTabStatus(tab.tabId, "connected");
              }
            }
            break;
          }

          case "channel_close": {
            if (channel_id) {
              cb.updateTabStatusByChannelId(channel_id, "disconnected");
              toast("Shell closed", { description: `Channel ${channel_id.slice(0, 8)}...`, variant: "warning" });
            }
            break;
          }

          case "channel_eof": {
            if (channel_id) {
              cb.updateTabStatusByChannelId(channel_id, "disconnected");
            }
            break;
          }

          case "channel_failure": {
            if (channel_id) {
              cb.updateTabStatusByChannelId(channel_id, "error");
              toast("Channel failed", { description: `Channel ${channel_id.slice(0, 8)}...`, variant: "error" });
            }
            break;
          }

          case "exit_status": {
            if (channel_id) {
              cb.updateTabStatusByChannelId(channel_id, "disconnected");
              toast("Process exited", { description: `Exit code: ${kind.exit_status}`, variant: "default" });
            }
            break;
          }

          case "exit_signal": {
            if (channel_id) {
              cb.updateTabStatusByChannelId(channel_id, "disconnected");
              toast("Process killed", { description: `Signal: ${kind.signal_name}`, variant: "error" });
            }
            break;
          }
        }
      });
      if (cancelled) { fn(); return; }
      unlisteners.push(fn);
    })();

    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, []);
}
