import { useUIStore } from "../stores/uiStore";
import { useTerminalStore } from "../stores/terminalStore";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef } from "react";
import type { ZmodemStartEvent } from "../types";

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ZmodemTransferItem({ channelId }: { channelId: string }) {
  const transfer = useUIStore((s) => s.zmodemTransfers.get(channelId));
  const removeZmodemTransfer = useUIStore((s) => s.removeZmodemTransfer);

  if (!transfer) return null;

  const pct = transfer.total > 0 ? Math.round((transfer.transferred / transfer.total) * 100) : 0;
  const isUpload = transfer.direction === "upload";
  const label = isUpload ? "Uploading" : "Downloading";

  const handleCancel = async () => {
    try {
      await invoke("zmodem_cancel", { channelId });
    } catch {}
    removeZmodemTransfer(channelId);
  };

  return (
    <div className="zmodem-bar">
      <div className="zmodem-bar-info">
        <span className="zmodem-bar-icon">
          {isUpload ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 11V3M7 3L4 6M7 3L10 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 3V11M7 11L4 8M7 11L10 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className="zmodem-bar-label">{label}</span>
        <span className="zmodem-bar-filename">{transfer.filename}</span>
        <span className="zmodem-bar-pct">{pct}%</span>
        {transfer.total > 0 && (
          <span className="zmodem-bar-size">
            {formatSize(transfer.transferred)} / {formatSize(transfer.total)}
          </span>
        )}
        <button className="zmodem-bar-cancel" onClick={handleCancel} title="Cancel transfer">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="zmodem-bar-track">
        <div
          className={`zmodem-bar-fill ${isUpload ? "zmodem-bar-fill--upload" : "zmodem-bar-fill--download"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ZmodemTransferBar() {
  const transfers = useUIStore((s) => s.zmodemTransfers);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const tabs = useTerminalStore((s) => s.tabs);

  const activeChannelId = activeTabId ? tabs.get(activeTabId)?.channelId : undefined;
  const activeTransfer = activeChannelId ? transfers.get(activeChannelId) : undefined;

  if (!activeTransfer) return null;

  return (
    <div className="zmodem-transfer-container">
      <ZmodemTransferItem key={activeChannelId} channelId={activeChannelId!} />
    </div>
  );
}

export function ZmodemEventHandler() {
  const addZmodemTransfer = useUIStore((s) => s.addZmodemTransfer);
  const updateZmodemTransfer = useUIStore((s) => s.updateZmodemTransfer);
  const removeZmodemTransfer = useUIStore((s) => s.removeZmodemTransfer);
  const pendingDialogRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const unlisteners: Array<() => void> = [];

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");

      const startUnlisten = await listen<ZmodemStartEvent>("zmodem:start", async (event) => {
        const { channel_id, direction } = event.payload;

        addZmodemTransfer({
          channelId: channel_id,
          direction: direction as "upload" | "download",
          filename: "",
          transferred: 0,
          total: 0,
          active: true,
        });

        if (pendingDialogRef.current.has(channel_id)) return;
        pendingDialogRef.current.set(channel_id, true);

        try {
          if (direction === "upload") {
            const selected = await open({
              multiple: true,
              title: "Select files to upload",
            });
            if (selected && selected.length > 0) {
              const paths = Array.isArray(selected) ? selected.map(String) : [String(selected)];
              await invoke("zmodem_provide_files", { channelId: channel_id, paths });
            } else {
              await invoke("zmodem_cancel", { channelId: channel_id });
              removeZmodemTransfer(channel_id);
            }
          } else {
            const selected = await save({
              title: "Save downloaded file",
              defaultPath: "downloaded_file",
            });
            if (selected) {
              await invoke("zmodem_provide_save_path", { channelId: channel_id, path: String(selected) });
            } else {
              await invoke("zmodem_cancel", { channelId: channel_id });
              removeZmodemTransfer(channel_id);
            }
          }
        } catch (err) {
          console.error("Zmodem dialog error:", err);
          try {
            await invoke("zmodem_cancel", { channelId: channel_id });
          } catch {}
          removeZmodemTransfer(channel_id);
        } finally {
          pendingDialogRef.current.delete(channel_id);
        }
      });

      const progressUnlisten = await listen<import("../types").ZmodemProgress>("zmodem:progress", (event) => {
        const { channel_id, direction, filename, transferred, total } = event.payload;
        updateZmodemTransfer(channel_id, {
          direction: direction as "upload" | "download",
          filename,
          transferred,
          total,
          active: true,
        });
      });

      const completeUnlisten = await listen<import("../types").ZmodemCompleteEvent>("zmodem:complete", (event) => {
        const { channel_id } = event.payload;
        updateZmodemTransfer(channel_id, { active: false });
        setTimeout(() => {
          removeZmodemTransfer(channel_id);
        }, 1500);
      });

      if (cancelled) {
        startUnlisten();
        progressUnlisten();
        completeUnlisten();
        return;
      }

      unlisteners.push(startUnlisten, progressUnlisten, completeUnlisten);
    })();

    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, [addZmodemTransfer, updateZmodemTransfer, removeZmodemTransfer]);

  return null;
}
