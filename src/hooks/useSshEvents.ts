import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTerminalStore } from "../stores/terminalStore";
import { useUIStore } from "../stores/uiStore";
import type {
  HostKeyUnknownEvent,
  KeyBoardAuthEvent,
  SshStateEvent,
  SshErrorEvent,
  SshChannelEvent,
  TabStatus,
} from "../types";

export function useSshEvents() {
  const updateTabStatus = useTerminalStore((s) => s.updateTabStatus);
  const updateTabChannelId = useTerminalStore((s) => s.updateTabChannelId);
  const showHostKeyModal = useUIStore((s) => s.showHostKeyModal);
  const showKeyboardAuthModal = useUIStore((s) => s.showKeyboardAuthModal);

  const callbacksRef = useRef({ updateTabStatus, updateTabChannelId, showHostKeyModal, showKeyboardAuthModal });
  callbacksRef.current = { updateTabStatus, updateTabChannelId, showHostKeyModal, showKeyboardAuthModal };

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
        const tabStatus = state.toLowerCase() as TabStatus;
        callbacksRef.current.updateTabStatus(session_id, tabStatus);

        if (state === "Connected") {
          const channelId = crypto.randomUUID();
          callbacksRef.current.updateTabChannelId(session_id, channelId);
          invoke("ssh_open_shell", {
            sessionId: session_id,
            channelId,
            cols: 80,
            rows: 24,
          }).catch(console.error);
        }
      });
      if (cancelled) { fn5(); return; }
      unlisteners.push(fn5);

      const fn6 = await listen<SshErrorEvent>("ssh:error", (event) => {
        const { session_id, error } = event.payload;
        console.error(`SSH error [${session_id}]:`, error);
        callbacksRef.current.updateTabStatus(session_id, "error");
      });
      if (cancelled) { fn6(); return; }
      unlisteners.push(fn6);

      const fn7 = await listen<SshChannelEvent>("ssh:channel-event", (event) => {
        const { session_id, event_type } = event.payload;
        if (event_type === "Close") {
          callbacksRef.current.updateTabStatus(session_id, "disconnected");
        }
      });
      if (cancelled) { fn7(); return; }
      unlisteners.push(fn7);
    })();

    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, []);
}
