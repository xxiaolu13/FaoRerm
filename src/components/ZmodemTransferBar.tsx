import { useUIStore } from "../stores/uiStore";
import { useTerminalStore } from "../stores/terminalStore";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { toast } from "../stores/toastStore";
import { useT, t as _t } from "../stores/i18nStore";
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
  const t = useT();

  if (!transfer) return null;

  const pct = transfer.total > 0 ? Math.round((transfer.transferred / transfer.total) * 100) : 0;
  const isUpload = transfer.direction === "upload";
  const label = isUpload ? t("zmodem.uploading") : t("zmodem.downloading");

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
        <button className="zmodem-bar-cancel" onClick={handleCancel} title={t("zmodem.cancelTransfer")}>
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
  const downloadPendingRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const unlisteners: Array<() => void> = [];

    (async () => {
      const startUnlisten = await listen<ZmodemStartEvent>("zmodem:start", async (event) => {
        const { channel_id, direction } = event.payload;

        if (direction === "upload") {
          addZmodemTransfer({
            channelId: channel_id,
            direction: "upload",
            filename: "",
            transferred: 0,
            total: 0,
            active: true,
          });

          if (pendingDialogRef.current.has(channel_id)) return;
          pendingDialogRef.current.set(channel_id, true);

          try {
            const selected = await open({
              multiple: true,
              title: _t("zmodem.selectFiles"),
            });
            if (selected && selected.length > 0) {
              const paths = Array.isArray(selected) ? selected.map(String) : [String(selected)];
              await invoke("zmodem_provide_files", { channelId: channel_id, paths });
            } else {
              await invoke("zmodem_cancel", { channelId: channel_id });
              removeZmodemTransfer(channel_id);
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
        } else {
          downloadPendingRef.current.set(channel_id, "");
        }
      });

      const progressUnlisten = await listen<import("../types").ZmodemProgress>("zmodem:progress", async (event) => {
        const { channel_id, direction, filename, transferred, total } = event.payload;
        updateZmodemTransfer(channel_id, {
          direction: direction as "upload" | "download",
          filename,
          transferred,
          total,
          active: true,
        });

        if (direction === "download" && filename && downloadPendingRef.current.has(channel_id) && !pendingDialogRef.current.has(channel_id)) {
          downloadPendingRef.current.delete(channel_id);
          pendingDialogRef.current.set(channel_id, true);

          try {
            const selected = await save({
              title: _t("zmodem.saveFile"),
              defaultPath: filename,
            });
            if (selected) {
              addZmodemTransfer({
                channelId: channel_id,
                direction: "download",
                filename,
                transferred: 0,
                total: 0,
                active: true,
              });
              await invoke("zmodem_provide_save_path", { channelId: channel_id, path: String(selected) });
            } else {
              await invoke("zmodem_cancel", { channelId: channel_id });
            }
          } catch (err) {
            console.error("Zmodem dialog error:", err);
            try {
              await invoke("zmodem_cancel", { channelId: channel_id });
            } catch {}
          } finally {
            pendingDialogRef.current.delete(channel_id);
          }
        }
      });

      const completeUnlisten = await listen<import("../types").ZmodemCompleteEvent>("zmodem:complete", async (event) => {
        const { channel_id, direction, success } = event.payload;
        const transfer = useUIStore.getState().zmodemTransfers.get(channel_id);
        const filename = transfer?.filename || "";
        const isUpload = direction === "upload";

        updateZmodemTransfer(channel_id, { active: false });
        setTimeout(() => {
          removeZmodemTransfer(channel_id);
        }, 1500);

        downloadPendingRef.current.delete(channel_id);

        if (success) {
          if (isUpload) {
            toast(_t("zmodem.uploadComplete"), {
              description: filename ? _t("zmodem.fileUploadSuccess", { filename }) : _t("zmodem.uploadComplete"),
              variant: "success",
            });
          } else {
            toast(_t("zmodem.downloadComplete"), {
              description: filename ? _t("zmodem.fileDownloadSuccess", { filename }) : _t("zmodem.downloadComplete"),
              variant: "success",
            });
          }
        } else {
          if (isUpload) {
            toast(_t("zmodem.uploadFailed"), {
              description: filename ? _t("zmodem.fileUploadFailed", { filename }) : _t("zmodem.uploadFailed"),
              variant: "error",
            });
          } else {
            toast(_t("zmodem.downloadFailed"), {
              description: filename ? _t("zmodem.fileDownloadFailed", { filename }) : _t("zmodem.downloadFailed"),
              variant: "error",
            });
          }
        }
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
