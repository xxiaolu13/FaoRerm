import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTerminalStore } from "../stores/terminalStore";
import { useUIStore } from "../stores/uiStore";
import { toast } from "../stores/toastStore";
import { terminalManager } from "../terminal/terminalManager";
import type {
  HostKeyUnknownEvent,
  KeyBoardAuthEvent,
  SshStateEvent,
  SshErrorEvent,
  SshChannelEvent,
  SshExitStatusEvent,
  TabStatus,
} from "../types";

export function useSshEvents() {
  const updateTabStatus = useTerminalStore((s) => s.updateTabStatus);
  const updateTabChannelId = useTerminalStore((s) => s.updateTabChannelId);
  const updateTabStatusByChannelId = useTerminalStore((s) => s.updateTabStatusByChannelId);
  const showHostKeyModal = useUIStore((s) => s.showHostKeyModal);
  const showKeyboardAuthModal = useUIStore((s) => s.showKeyboardAuthModal);

  const callbacksRef = useRef({
    updateTabStatus,
    updateTabChannelId,
    updateTabStatusByChannelId,
    showHostKeyModal,
    showKeyboardAuthModal,
  });
  callbacksRef.current = {
    updateTabStatus,
    updateTabChannelId,
    updateTabStatusByChannelId,
    showHostKeyModal,
    showKeyboardAuthModal,
  };

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    (async () => {
      const fn2 = await listen<HostKeyUnknownEvent>("ssh:host-key-unknown", (event) => {
        const { session_id, key_type, fingerprint } = event.payload;
        callbacksRef.current.showHostKeyModal(session_id, key_type, fingerprint);
      });
      if (cancelled) { fn2(); return; }
      unlisteners.push(fn2);

      const fn3 = await listen<HostKeyUnknownEvent>("ssh:host-key-received", (event) => {
        console.log("Host key received:", event.payload.fingerprint);
      });
      if (cancelled) { fn3(); return; }
      unlisteners.push(fn3);

      const fn4 = await listen<KeyBoardAuthEvent>("ssh:keyboard-auth", (event) => {
        const { session_id, prompt } = event.payload;
        callbacksRef.current.showKeyboardAuthModal(session_id, prompt);
      });
      if (cancelled) { fn4(); return; }
      unlisteners.push(fn4);

      const fn5 = await listen<SshStateEvent>("ssh:state", (event) => {
        const { session_id, state } = event.payload;

        if (state === "Connected") {
          const store = useTerminalStore.getState();
          const sessionTabs = store.getTabsBySessionId(session_id);
          const connectingTab = sessionTabs.find((t) => t.status === "connecting");

          if (connectingTab) {
            const channelId = crypto.randomUUID();
            callbacksRef.current.updateTabChannelId(connectingTab.tabId, channelId);
            callbacksRef.current.updateTabStatus(connectingTab.tabId, "connected" as TabStatus);
            terminalManager.setChannelId(connectingTab.tabId, channelId);

            invoke("ssh_open_shell", {
              sessionId: session_id,
              channelId,
              cols: 80,
              rows: 24,
            }).catch((err) => {
              console.error("Failed to open shell:", err);
              callbacksRef.current.updateTabStatus(connectingTab.tabId, "error");
              toast("Shell open failed", { description: String(err), variant: "error" });
            });

            toast("Connected", { description: `Session established`, variant: "success" });
          }
        } else if (state === "Disconnected") {
          const store = useTerminalStore.getState();
          const sessionTabs = store.getTabsBySessionId(session_id);
          for (const tab of sessionTabs) {
            callbacksRef.current.updateTabStatus(tab.tabId, "disconnected");
          }
          toast("Disconnected", { description: `Session closed`, variant: "warning" });
        } else if (state === "Connecting") {
          const store = useTerminalStore.getState();
          const sessionTabs = store.getTabsBySessionId(session_id);
          for (const tab of sessionTabs) {
            if (tab.status === "connecting") {
              callbacksRef.current.updateTabStatus(tab.tabId, "connecting");
            }
          }
        }
      });
      if (cancelled) { fn5(); return; }
      unlisteners.push(fn5);

      const fn6 = await listen<SshErrorEvent>("ssh:error", (event) => {
        const { session_id, error } = event.payload;
        console.error(`SSH error [${session_id}]:`, error);

        const store = useTerminalStore.getState();
        const sessionTabs = store.getTabsBySessionId(session_id);
        for (const tab of sessionTabs) {
          callbacksRef.current.updateTabStatus(tab.tabId, "error");
        }
        toast("SSH Error", { description: error, variant: "error" });
      });
      if (cancelled) { fn6(); return; }
      unlisteners.push(fn6);

      const fn7 = await listen<SshChannelEvent>("ssh:channel-event", (event) => {
        const { channel_id, event_type } = event.payload;

        if (event_type === "Success") {
          const store = useTerminalStore.getState();
          const tab = [...store.tabs.values()].find(
            (t) => t.channelId === channel_id && t.status === "connecting"
          );
          if (tab) {
            callbacksRef.current.updateTabStatus(tab.tabId, "connected");
          }
        } else if (event_type === "Close") {
          callbacksRef.current.updateTabStatusByChannelId(channel_id, "disconnected");
          toast("Shell closed", { description: `Channel ${channel_id.slice(0, 8)}...`, variant: "warning" });
        } else if (event_type === "Eof") {
          callbacksRef.current.updateTabStatusByChannelId(channel_id, "disconnected");
        } else if (event_type === "ChannelFailure") {
          callbacksRef.current.updateTabStatusByChannelId(channel_id, "error");
          toast("Channel failed", { description: `Channel ${channel_id.slice(0, 8)}...`, variant: "error" });
        }
      });
      if (cancelled) { fn7(); return; }
      unlisteners.push(fn7);

      const fn8 = await listen<SshExitStatusEvent>("ssh:exit-status", (event) => {
        const { channel_id, exit_status } = event.payload;
        callbacksRef.current.updateTabStatusByChannelId(channel_id, "disconnected");
        toast("Process exited", { description: `Exit code: ${exit_status}`, variant: "default" });
      });
      if (cancelled) { fn8(); return; }
      unlisteners.push(fn8);
    })();

    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, []);
}
