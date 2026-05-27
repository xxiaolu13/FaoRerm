use std::io::Read as StdRead;
use std::io::Write as StdWrite;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::mpsc;
use tracing::*;
use uuid::Uuid;

use crate::client::common::ChannelOperation;
use crate::client::domain::{FRCCommand, FRCCommandReply};

const ZMODEM_PAD: u8 = 0x2A;
const ZMODEM_DLE: u8 = 0x18;
const ZMODEM_HEX: u8 = 0x42;

const ZRQINIT_PATTERN: &[u8] = &[ZMODEM_PAD, ZMODEM_PAD, ZMODEM_DLE, ZMODEM_HEX, b'0', b'0'];
const ZRINIT_PATTERN: &[u8] = &[ZMODEM_PAD, ZMODEM_PAD, ZMODEM_DLE, ZMODEM_HEX, b'0', b'1'];
const ZSKIP_PATTERN: &[u8] = &[ZMODEM_PAD, ZMODEM_PAD, ZMODEM_DLE, ZMODEM_HEX, b'0', b'5'];

fn contains_zskip(data: &[u8]) -> bool {
    if data.len() < 6 {
        return false;
    }
    for i in 0..=data.len() - 6 {
        if data[i..].starts_with(ZSKIP_PATTERN) {
            return true;
        }
    }
    false
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct ZmodemProgress {
    pub channel_id: String,
    pub direction: String,
    pub filename: String,
    pub transferred: u64,
    pub total: u64,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct ZmodemStartEvent {
    pub channel_id: String,
    pub direction: String,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct ZmodemCompleteEvent {
    pub channel_id: String,
    pub direction: String,
    pub success: bool,
}

enum ZmodemInput {
    Data(Vec<u8>),
    FilesSelected(Vec<PathBuf>),
    SavePathSelected(PathBuf),
    Cancel,
}

pub struct ZmodemSession {
    input_tx: mpsc::UnboundedSender<ZmodemInput>,
}

impl ZmodemSession {
    pub fn send_data(&self, data: Vec<u8>) -> Result<(), String> {
        self.input_tx.send(ZmodemInput::Data(data)).map_err(|e| e.to_string())
    }

    pub fn provide_files(&self, paths: Vec<PathBuf>) -> Result<(), String> {
        self.input_tx.send(ZmodemInput::FilesSelected(paths)).map_err(|e| e.to_string())
    }

    pub fn provide_save_path(&self, path: PathBuf) -> Result<(), String> {
        self.input_tx.send(ZmodemInput::SavePathSelected(path)).map_err(|e| e.to_string())
    }

    pub fn cancel(&self) -> Result<(), String> {
        self.input_tx.send(ZmodemInput::Cancel).map_err(|e| e.to_string())
    }
}

pub fn detect_zmodem(data: &[u8]) -> Option<&'static str> {
    if data.len() < 6 {
        return None;
    }
    for i in 0..=data.len() - 6 {
        if data[i..].starts_with(ZRINIT_PATTERN) {
            return Some("upload");
        }
        if data[i..].starts_with(ZRQINIT_PATTERN) {
            return Some("download");
        }
    }
    None
}

fn send_to_channel(
    command_tx: &mpsc::UnboundedSender<(FRCCommand, Option<FRCCommandReply>)>,
    channel_id: Uuid,
    data: &[u8],
) {
    debug!(channel_id = %channel_id, data_len = data.len(), "ZMODEM TX: sending data to SSH channel");
    let _ = command_tx.send((
        FRCCommand::Channel(channel_id, ChannelOperation::Data(data.to_vec().into())),
        None,
    ));
}

fn emit_progress(app: &AppHandle, channel_id: &str, direction: &str, filename: &str, transferred: u64, total: u64) {
    debug!(channel_id = %channel_id, direction = %direction, filename = %filename, transferred, total, "ZMODEM PROGRESS");
    let _ = app.emit("zmodem:progress", ZmodemProgress {
        channel_id: channel_id.to_string(),
        direction: direction.to_string(),
        filename: filename.to_string(),
        transferred,
        total,
    });
}

fn emit_complete(app: &AppHandle, channel_id: &str, direction: &str, success: bool) {
    debug!(channel_id = %channel_id, direction = %direction, success, "ZMODEM COMPLETE");
    let _ = app.emit("zmodem:complete", ZmodemCompleteEvent {
        channel_id: channel_id.to_string(),
        direction: direction.to_string(),
        success,
    });
    let ch = channel_id.to_string();
    tokio::spawn(async move {
        let services = crate::FAO_SERVICES.lock().await;
        services.zmodem_sessions.lock().await.remove(&ch);
        debug!(channel_id = %ch, "Zmodem session removed from registry");
    });
}

pub fn spawn_upload_session(
    app_handle: AppHandle,
    channel_id: Uuid,
    command_tx: mpsc::UnboundedSender<(FRCCommand, Option<FRCCommandReply>)>,
    initial_data: Vec<u8>,
) -> ZmodemSession {
    let (input_tx, mut input_rx) = mpsc::unbounded_channel();

    let ch_str = channel_id.to_string();
    let _handle = tokio::spawn(async move {
        debug!(channel = %ch_str, initial_data_len = initial_data.len(), "ZMODEM UPLOAD: session spawned");

        let mut files_to_send: Vec<PathBuf> = Vec::new();
        let mut waiting_for_files = true;
        let mut buffered_data: Vec<u8> = Vec::new();

        while waiting_for_files {
            match input_rx.recv().await {
                Some(ZmodemInput::FilesSelected(paths)) => {
                    debug!(channel = %ch_str, count = paths.len(), "ZMODEM UPLOAD: files selected");
                    files_to_send = paths;
                    waiting_for_files = false;
                }
                Some(ZmodemInput::Cancel) | None => {
                    debug!(channel = %ch_str, "Zmodem upload cancelled before file selection");
                    let cancel_bytes = b"\x18\x18\x18\x18\x08\x08\x08\x08";
                    send_to_channel(&command_tx, channel_id, cancel_bytes);
                    emit_complete(&app_handle, &ch_str, "upload", false);
                    return;
                }
                Some(ZmodemInput::Data(d)) => {
                    debug!(channel = %ch_str, data_len = d.len(), "ZMODEM UPLOAD: buffering data while waiting for files");
                    buffered_data.extend_from_slice(&d);
                }
                Some(ZmodemInput::SavePathSelected(_)) => {}
            }
        }

        if files_to_send.is_empty() {
            let cancel_bytes = b"\x18\x18\x18\x18\x08\x08\x08\x08";
            send_to_channel(&command_tx, channel_id, cancel_bytes);
            emit_complete(&app_handle, &ch_str, "upload", false);
            return;
        }

        let mut sender = match zmodem2::Sender::new() {
            Ok(s) => {
                debug!(channel = %ch_str, "ZMODEM UPLOAD: Sender created");
                s
            }
            Err(e) => {
                error!(channel = %ch_str, error = ?e, "Failed to create zmodem sender");
                emit_complete(&app_handle, &ch_str, "upload", false);
                return;
            }
        };

        let out = sender.drain_outgoing();
        if !out.is_empty() {
            debug!(channel = %ch_str, out_len = out.len(), "ZMODEM UPLOAD: sending ZRQINIT");
            let out_len = out.len();
            send_to_channel(&command_tx, channel_id, out);
            sender.advance_outgoing(out_len);
        } else {
            warn!(channel = %ch_str, "ZMODEM UPLOAD: Sender::new() produced no outgoing data!");
        }

        if !initial_data.is_empty() {
            debug!(channel = %ch_str, data_len = initial_data.len(), "ZMODEM UPLOAD: feeding initial_data to sender");
            let hex_dump: String = initial_data.iter().take(60).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
            debug!(channel = %ch_str, hex = %hex_dump, "ZMODEM UPLOAD: initial_data hex dump");
            let mut remaining = initial_data.as_slice();
            while !remaining.is_empty() {
                let consumed = match sender.feed_incoming(remaining) {
                    Ok(n) => n,
                    Err(e) => {
                        error!(channel = %ch_str, error = ?e, remaining_len = remaining.len(), "Failed to feed initial data to sender");
                        emit_complete(&app_handle, &ch_str, "upload", false);
                        return;
                    }
                };
                debug!(channel = %ch_str, consumed, remaining_len = remaining.len(), "ZMODEM UPLOAD: feed_incoming consumed from initial_data");
                if consumed == 0 {
                    break;
                }
                remaining = &remaining[consumed..];

                let out = sender.drain_outgoing();
                if !out.is_empty() {
                    debug!(channel = %ch_str, out_len = out.len(), "ZMODEM UPLOAD: sending outgoing after feed_incoming(initial_data)");
                    send_to_channel(&command_tx, channel_id, out);
                    sender.advance_outgoing(out.len());
                }
            }
        }

        if !buffered_data.is_empty() {
            debug!(channel = %ch_str, data_len = buffered_data.len(), "ZMODEM UPLOAD: feeding buffered_data to sender");
            let mut remaining = buffered_data.as_slice();
            while !remaining.is_empty() {
                let consumed = match sender.feed_incoming(remaining) {
                    Ok(n) => n,
                    Err(e) => {
                        error!(channel = %ch_str, error = ?e, "Failed to feed buffered data to sender");
                        break;
                    }
                };
                debug!(channel = %ch_str, consumed, "ZMODEM UPLOAD: feed_incoming consumed from buffered_data");
                if consumed == 0 {
                    break;
                }
                remaining = &remaining[consumed..];

                let out = sender.drain_outgoing();
                if !out.is_empty() {
                    debug!(channel = %ch_str, out_len = out.len(), "ZMODEM UPLOAD: sending outgoing after feed_incoming(buffered_data)");
                    send_to_channel(&command_tx, channel_id, out);
                    sender.advance_outgoing(out.len());
                }
            }
        }

        let out = sender.drain_outgoing();
        if !out.is_empty() {
            debug!(channel = %ch_str, out_len = out.len(), "ZMODEM UPLOAD: sending remaining outgoing before file loop");
            send_to_channel(&command_tx, channel_id, out);
            sender.advance_outgoing(out.len());
        }

        for file_path in &files_to_send {
            let file_name = match file_path.file_name() {
                Some(n) => n.to_string_lossy().to_string(),
                None => continue,
            };
            let file_size = match std::fs::metadata(file_path) {
                Ok(m) => m.len() as u32,
                Err(e) => {
                    error!(path = %file_path.display(), error = ?e, "Cannot read file metadata");
                    continue;
                }
            };

            debug!(channel = %ch_str, file = %file_name, size = file_size, "ZMODEM UPLOAD: starting file");

            let file_name_bytes = file_name.as_bytes();
            if let Err(e) = sender.start_file(file_name_bytes, file_size) {
                error!(channel = %ch_str, error = ?e, "Failed to start file transfer");
                continue;
            }

            let mut zfile_frame: Vec<u8>;
            let out = sender.drain_outgoing();
            if !out.is_empty() {
                debug!(channel = %ch_str, out_len = out.len(), "ZMODEM UPLOAD: sending ZFILE header");
                zfile_frame = out.to_vec();
                let hex_dump: String = zfile_frame.iter().take(80).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                debug!(channel = %ch_str, hex = %hex_dump, "ZMODEM UPLOAD: ZFILE frame hex dump (first 80 bytes)");
                send_to_channel(&command_tx, channel_id, out);
                sender.advance_outgoing(zfile_frame.len());
            } else {
                warn!(channel = %ch_str, "ZMODEM UPLOAD: start_file produced no outgoing data!");
                zfile_frame = Vec::new();
            }

            let mut file = match std::fs::File::open(file_path) {
                Ok(f) => f,
                Err(e) => {
                    error!(path = %file_path.display(), error = ?e, "Cannot open file");
                    continue;
                }
            };

            let mut transferred: u64 = 0;
            let total = file_size as u64;
            let mut file_done = false;
            let mut loop_count: u64 = 0;
            let mut stuck_count: u32 = 0;
            const MAX_STUCK_BEFORE_RESEND: u32 = 2;
            const MAX_ZFILE_RESENDS: u32 = 5;
            let mut zfile_resend_count: u32 = 0;

            emit_progress(&app_handle, &ch_str, "upload", &file_name, 0, total);

            while !file_done {
                loop_count += 1;
                if loop_count % 100 == 1 {
                    debug!(channel = %ch_str, loop_count, "ZMODEM UPLOAD: main loop iteration");
                }

                while let Some(req) = sender.poll_file() {
                    stuck_count = 0;
                    debug!(channel = %ch_str, offset = req.offset, len = req.len, "ZMODEM UPLOAD: poll_file returned request");
                    let mut buf = vec![0u8; req.len];
                    let n = match file.read(&mut buf) {
                        Ok(0) => 0,
                        Ok(n) => n,
                        Err(e) => {
                            error!(channel = %ch_str, error = ?e, "File read error");
                            break;
                        }
                    };
                    if n > 0 {
                        if let Err(e) = sender.feed_file(&buf[..n]) {
                            error!(channel = %ch_str, error = ?e, "Feed file error");
                            break;
                        }
                        transferred = (req.offset as u64) + n as u64;
                        emit_progress(&app_handle, &ch_str, "upload", &file_name, transferred, total);
                    }

                    let out = sender.drain_outgoing();
                    if !out.is_empty() {
                        send_to_channel(&command_tx, channel_id, out);
                        sender.advance_outgoing(out.len());
                    }
                }

                let out = sender.drain_outgoing();
                if !out.is_empty() {
                    stuck_count = 0;
                    if transferred == 0 {
                        zfile_frame = out.to_vec();
                    }
                    send_to_channel(&command_tx, channel_id, out);
                    sender.advance_outgoing(out.len());
                }

                while let Some(event) = sender.poll_event() {
                    stuck_count = 0;
                    match event {
                        zmodem2::SenderEvent::FileComplete => {
                            debug!(channel = %ch_str, file = %file_name, "File upload complete");
                            emit_progress(&app_handle, &ch_str, "upload", &file_name, total, total);
                            file_done = true;
                        }
                        zmodem2::SenderEvent::SessionComplete => {
                            debug!(channel = %ch_str, "Zmodem upload session complete");
                            file_done = true;
                        }
                    }
                }

                if file_done {
                    break;
                }

                if sender.poll_file().is_some() {
                    continue;
                }

                debug!(channel = %ch_str, "ZMODEM UPLOAD: waiting for server input...");
                if stuck_count >= MAX_STUCK_BEFORE_RESEND {
                    if zfile_resend_count < MAX_ZFILE_RESENDS && !zfile_frame.is_empty() {
                        zfile_resend_count += 1;
                        debug!(channel = %ch_str, resend = zfile_resend_count, "ZMODEM UPLOAD: re-sending ZFILE frame due to stuck state (server sending ZRINIT but not ZRPOS)");
                        send_to_channel(&command_tx, channel_id, &zfile_frame);
                        stuck_count = 0;
                    } else if zfile_resend_count >= MAX_ZFILE_RESENDS {
                        debug!(channel = %ch_str, "ZMODEM UPLOAD: ZFILE re-send limit reached, re-creating sender to reset ZMODEM session");
                        match zmodem2::Sender::new() {
                            Ok(mut new_sender) => {
                                if let Err(e) = new_sender.start_file(file_name_bytes, file_size) {
                                    error!(channel = %ch_str, error = ?e, "Failed to start file on new sender");
                                    emit_complete(&app_handle, &ch_str, "upload", false);
                                    return;
                                }
                                let out = new_sender.drain_outgoing();
                                if !out.is_empty() {
                                    let out_len = out.len();
                                    debug!(channel = %ch_str, out_len, "ZMODEM UPLOAD: sending ZRQINIT from new sender");
                                    send_to_channel(&command_tx, channel_id, out);
                                    new_sender.advance_outgoing(out_len);
                                }
                                sender = new_sender;
                                stuck_count = 0;
                                zfile_resend_count = 0;
                                debug!(channel = %ch_str, "ZMODEM UPLOAD: sender re-created, waiting for ZRINIT from server");
                            }
                            Err(e) => {
                                error!(channel = %ch_str, error = ?e, "Failed to create new sender");
                                emit_complete(&app_handle, &ch_str, "upload", false);
                                return;
                            }
                        }
                    }
                }
                match input_rx.recv().await {
                    Some(ZmodemInput::Data(data)) => {
                        debug!(channel = %ch_str, data_len = data.len(), "ZMODEM UPLOAD: received data from server");
                        let hex_dump: String = data.iter().take(40).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                        debug!(channel = %ch_str, hex = %hex_dump, "ZMODEM UPLOAD: received data hex dump");

                        if contains_zskip(&data) {
                            warn!(channel = %ch_str, file = %file_name, "ZMODEM UPLOAD: server sent ZSKIP (file already exists), skipping file");
                            emit_progress(&app_handle, &ch_str, "upload", &file_name, total, total);
                            file_done = true;
                            if let Ok(mut new_sender) = zmodem2::Sender::new() {
                                let out = new_sender.drain_outgoing();
                                if !out.is_empty() {
                                    let out_len = out.len();
                                    send_to_channel(&command_tx, channel_id, out);
                                    new_sender.advance_outgoing(out_len);
                                }
                                if let Some(zrinit_pos) = data.windows(6).position(|w| w == ZRINIT_PATTERN) {
                                    let zrinit_data = &data[zrinit_pos..];
                                    let mut remaining: &[u8] = zrinit_data;
                                    while !remaining.is_empty() {
                                        let consumed = match new_sender.feed_incoming(remaining) {
                                            Ok(n) => n,
                                            Err(_) => break,
                                        };
                                        if consumed == 0 { break; }
                                        remaining = &remaining[consumed..];
                                        let out = new_sender.drain_outgoing();
                                        if !out.is_empty() {
                                            send_to_channel(&command_tx, channel_id, out);
                                            new_sender.advance_outgoing(out.len());
                                        }
                                    }
                                }
                                sender = new_sender;
                            }
                            break;
                        }
                        let mut remaining = data.as_slice();
                        while !remaining.is_empty() {
                            let consumed = match sender.feed_incoming(remaining) {
                                Ok(n) => n,
                                Err(e) => {
                                    error!(channel = %ch_str, error = ?e, "Feed incoming error");
                                    break;
                                }
                            };
                            if consumed == 0 {
                                while let Some(req) = sender.poll_file() {
                                    stuck_count = 0;
                                    debug!(channel = %ch_str, offset = req.offset, len = req.len, "ZMODEM UPLOAD: poll_file in feed_incoming loop");
                                    let mut buf = vec![0u8; req.len];
                                    let n = match file.read(&mut buf) {
                                        Ok(0) => 0,
                                        Ok(n) => n,
                                        Err(e) => {
                                            error!(channel = %ch_str, error = ?e, "File read error in feed_incoming loop");
                                            break;
                                        }
                                    };
                                    if n > 0 {
                                        if let Err(e) = sender.feed_file(&buf[..n]) {
                                            error!(channel = %ch_str, error = ?e, "Feed file error in feed_incoming loop");
                                            break;
                                        }
                                        transferred = (req.offset as u64) + n as u64;
                                        emit_progress(&app_handle, &ch_str, "upload", &file_name, transferred, total);
                                    }
                                    let out = sender.drain_outgoing();
                                    if !out.is_empty() {
                                        send_to_channel(&command_tx, channel_id, out);
                                        sender.advance_outgoing(out.len());
                                    }
                                }
                                while let Some(event) = sender.poll_event() {
                                    stuck_count = 0;
                                    match event {
                                        zmodem2::SenderEvent::FileComplete => {
                                            debug!(channel = %ch_str, file = %file_name, "File upload complete (in feed_incoming loop)");
                                            emit_progress(&app_handle, &ch_str, "upload", &file_name, total, total);
                                            file_done = true;
                                        }
                                        zmodem2::SenderEvent::SessionComplete => {
                                            debug!(channel = %ch_str, "Zmodem upload session complete (in feed_incoming loop)");
                                            file_done = true;
                                        }
                                    }
                                }
                                if file_done {
                                    break;
                                }
                                let out = sender.drain_outgoing();
                                if !out.is_empty() {
                                    stuck_count = 0;
                                    if transferred == 0 {
                                        zfile_frame = out.to_vec();
                                    }
                                    send_to_channel(&command_tx, channel_id, out);
                                    sender.advance_outgoing(out.len());
                                    continue;
                                }
                                if sender.poll_file().is_none() {
                                    debug!(channel = %ch_str, remaining_len = remaining.len(), "ZMODEM UPLOAD: feed_incoming consumed 0, no pending request, breaking");
                                    break;
                                }
                                continue;
                            }
                            debug!(channel = %ch_str, consumed, "ZMODEM UPLOAD: feed_incoming consumed");
                            remaining = &remaining[consumed..];

                            let out = sender.drain_outgoing();
                            if !out.is_empty() {
                                stuck_count = 0;
                                if transferred == 0 {
                                    zfile_frame = out.to_vec();
                                    let hex_dump: String = zfile_frame.iter().take(80).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                                    debug!(channel = %ch_str, hex = %hex_dump, "ZMODEM UPLOAD: updated ZFILE frame hex dump");
                                }
                                debug!(channel = %ch_str, out_len = out.len(), "ZMODEM UPLOAD: sending outgoing after feed_incoming");
                                send_to_channel(&command_tx, channel_id, out);
                                sender.advance_outgoing(out.len());
                            } else {
                                stuck_count += 1;
                                debug!(channel = %ch_str, stuck_count, "ZMODEM UPLOAD: feed_incoming consumed data but no outgoing (server may be sending ZRINIT in WaitFilePos)");
                            }
                        }
                        if sender.poll_file().is_some() {
                            stuck_count = 0;
                        }
                    }
                    Some(ZmodemInput::Cancel) | None => {
                        debug!(channel = %ch_str, "Zmodem upload cancelled");
                        let cancel_bytes = b"\x18\x18\x18\x18\x08\x08\x08\x08";
                        send_to_channel(&command_tx, channel_id, cancel_bytes);
                        emit_complete(&app_handle, &ch_str, "upload", false);
                        return;
                    }
                    _ => {}
                }
            }
        }

        debug!(channel = %ch_str, "ZMODEM UPLOAD: finishing session");
        if let Err(e) = sender.finish_session() {
            error!(channel = %ch_str, error = ?e, "Finish session error");
        }

        let out = sender.drain_outgoing();
        if !out.is_empty() {
            send_to_channel(&command_tx, channel_id, out);
            sender.advance_outgoing(out.len());
        }

        let mut session_done = false;
        while !session_done {
            let out = sender.drain_outgoing();
            if !out.is_empty() {
                send_to_channel(&command_tx, channel_id, out);
                sender.advance_outgoing(out.len());
            }

            match input_rx.recv().await {
                Some(ZmodemInput::Data(data)) => {
                    let mut remaining = data.as_slice();
                    while !remaining.is_empty() {
                        let consumed = match sender.feed_incoming(remaining) {
                            Ok(n) => n,
                            Err(e) => {
                                error!(channel = %ch_str, error = ?e, "Feed incoming error during finish");
                                break;
                            }
                        };
                        if consumed == 0 {
                            break;
                        }
                        remaining = &remaining[consumed..];

                        let out = sender.drain_outgoing();
                        if !out.is_empty() {
                            send_to_channel(&command_tx, channel_id, out);
                            sender.advance_outgoing(out.len());
                        }
                    }
                }
                Some(ZmodemInput::Cancel) | None => {
                    break;
                }
                _ => {}
            }

            while let Some(event) = sender.poll_event() {
                if event == zmodem2::SenderEvent::SessionComplete {
                    session_done = true;
                }
            }
        }

        emit_complete(&app_handle, &ch_str, "upload", true);
        debug!(channel = %ch_str, "Zmodem upload session finished");
    });

    ZmodemSession { input_tx }
}

pub fn spawn_download_session(
    app_handle: AppHandle,
    channel_id: Uuid,
    command_tx: mpsc::UnboundedSender<(FRCCommand, Option<FRCCommandReply>)>,
    initial_data: Vec<u8>,
) -> ZmodemSession {
    let (input_tx, mut input_rx) = mpsc::unbounded_channel();

    let ch_str = channel_id.to_string();
    let _handle = tokio::spawn(async move {
        debug!(channel = %ch_str, initial_data_len = initial_data.len(), "ZMODEM DOWNLOAD: session spawned");

        let mut receiver = match zmodem2::Receiver::new() {
            Ok(r) => {
                debug!(channel = %ch_str, "ZMODEM DOWNLOAD: Receiver created");
                r
            }
            Err(e) => {
                error!(channel = %ch_str, error = ?e, "Failed to create zmodem receiver");
                emit_complete(&app_handle, &ch_str, "download", false);
                return;
            }
        };

        {
            let out = receiver.drain_outgoing();
            if !out.is_empty() {
                debug!(channel = %ch_str, out_len = out.len(), "ZMODEM DOWNLOAD: sending initial outgoing (ZRINIT)");
                send_to_channel(&command_tx, channel_id, out);
                receiver.advance_outgoing(out.len());
            }
        }

        if !initial_data.is_empty() {
            debug!(channel = %ch_str, data_len = initial_data.len(), "ZMODEM DOWNLOAD: feeding initial_data to receiver");
            let mut remaining = initial_data.as_slice();
            while !remaining.is_empty() {
                let consumed = match receiver.feed_incoming(remaining) {
                    Ok(n) => n,
                    Err(e) => {
                        error!(channel = %ch_str, error = ?e, "Failed to feed initial data to receiver");
                        break;
                    }
                };
                debug!(channel = %ch_str, consumed, "ZMODEM DOWNLOAD: feed_incoming consumed from initial_data");
                if consumed == 0 {
                    break;
                }
                remaining = &remaining[consumed..];

                let out = receiver.drain_outgoing();
                if !out.is_empty() {
                    debug!(channel = %ch_str, out_len = out.len(), "ZMODEM DOWNLOAD: sending outgoing after feed_incoming");
                    send_to_channel(&command_tx, channel_id, out);
                    receiver.advance_outgoing(out.len());
                }
            }
        }

        let out = receiver.drain_outgoing();
        if !out.is_empty() {
            send_to_channel(&command_tx, channel_id, out);
            receiver.advance_outgoing(out.len());
        }

        let mut save_path: Option<PathBuf> = None;
        let mut current_file: Option<std::fs::File> = None;
        let mut current_filename = String::new();
        let mut current_filesize: u64 = 0;
        let mut transferred: u64 = 0;
        let mut session_done = false;
        let mut pending_file_start = false;
        let mut buffered_file_data: Vec<Vec<u8>> = Vec::new();
        let mut file_complete_pending = false;
        let mut session_complete_pending = false;

        let mut process_file_data = |receiver: &mut zmodem2::Receiver,
                                     pending_file_start: &mut bool,
                                     current_file: &mut Option<std::fs::File>,
                                     buffered_file_data: &mut Vec<Vec<u8>>,
                                     transferred: &mut u64,
                                     current_filename: &str,
                                     current_filesize: u64| {
            let file_data = receiver.drain_file();
            if !file_data.is_empty() {
                if *pending_file_start {
                    buffered_file_data.push(file_data.to_vec());
                } else if let Some(ref mut file) = current_file {
                    if let Err(e) = file.write_all(file_data) {
                        error!(channel = %ch_str, error = ?e, "File write error");
                    }
                    *transferred += file_data.len() as u64;
                    emit_progress(&app_handle, &ch_str, "download", current_filename, *transferred, current_filesize);
                }
                receiver.advance_file(file_data.len()).ok();
            }
        };

        let mut process_events = |receiver: &mut zmodem2::Receiver,
                                   pending_file_start: &mut bool,
                                   file_complete_pending: &mut bool,
                                   session_complete_pending: &mut bool,
                                   session_done: &mut bool,
                                   current_file: &mut Option<std::fs::File>,
                                   buffered_file_data: &mut Vec<Vec<u8>>,
                                   transferred: &mut u64,
                                   current_filename: &mut String,
                                   current_filesize: &mut u64,
                                   save_path: &Option<PathBuf>| {
            while let Some(event) = receiver.poll_event() {
                match event {
                    zmodem2::ReceiverEvent::FileStart => {
                        let fname_bytes = receiver.file_name();
                        let fname_str = String::from_utf8_lossy(fname_bytes).to_string();
                        *current_filename = fname_str;
                        *current_filesize = receiver.file_size() as u64;
                        *transferred = 0;

                        debug!(channel = %ch_str, filename = %*current_filename, filesize = *current_filesize, "ZMODEM DOWNLOAD: FileStart event");

                        if let Some(ref sp) = save_path {
                            let file_path = if sp.is_dir() || sp.extension().is_none() {
                                sp.join(&*current_filename)
                            } else {
                                sp.clone()
                            };

                            if let Some(parent) = file_path.parent() {
                                let _ = std::fs::create_dir_all(parent);
                            }

                            match std::fs::File::create(&file_path) {
                                Ok(f) => {
                                    *current_file = Some(f);
                                    *pending_file_start = false;
                                    for data in buffered_file_data.drain(..) {
                                        if let Some(ref mut file) = current_file {
                                            if let Err(e) = file.write_all(&data) {
                                                error!(channel = %ch_str, error = ?e, "Buffered data write error");
                                            }
                                            *transferred += data.len() as u64;
                                        }
                                    }
                                    emit_progress(&app_handle, &ch_str, "download", current_filename, *transferred, *current_filesize);
                                }
                                Err(e) => {
                                    error!(channel = %ch_str, path = %file_path.display(), error = ?e, "Cannot create file");
                                }
                            }
                        } else {
                            *pending_file_start = true;
                            emit_progress(&app_handle, &ch_str, "download", &*current_filename, 0, *current_filesize);
                            debug!(channel = %ch_str, "ZMODEM DOWNLOAD: no save_path yet, buffering file data");
                        }
                    }
                    zmodem2::ReceiverEvent::FileComplete => {
                        debug!(channel = %ch_str, filename = %*current_filename, "ZMODEM DOWNLOAD: FileComplete event");
                        *file_complete_pending = true;
                    }
                    zmodem2::ReceiverEvent::SessionComplete => {
                        debug!(channel = %ch_str, "ZMODEM DOWNLOAD: SessionComplete event");
                        *session_complete_pending = true;
                    }
                }
            }
        };

        while !session_done {
            process_file_data(
                &mut receiver,
                &mut pending_file_start,
                &mut current_file,
                &mut buffered_file_data,
                &mut transferred,
                &current_filename,
                current_filesize,
            );

            process_events(
                &mut receiver,
                &mut pending_file_start,
                &mut file_complete_pending,
                &mut session_complete_pending,
                &mut session_done,
                &mut current_file,
                &mut buffered_file_data,
                &mut transferred,
                &mut current_filename,
                &mut current_filesize,
                &save_path,
            );

            if file_complete_pending && !pending_file_start {
                if let Some(ref mut file) = current_file {
                    let _ = file.flush();
                }
                current_file = None;
                file_complete_pending = false;
            }

            if session_complete_pending && !pending_file_start {
                if let Some(ref mut file) = current_file {
                    let _ = file.flush();
                }
                current_file = None;
                session_done = true;
                break;
            }

            let out = receiver.drain_outgoing();
            if !out.is_empty() {
                send_to_channel(&command_tx, channel_id, out);
                receiver.advance_outgoing(out.len());
            }

            match input_rx.recv().await {
                Some(ZmodemInput::Data(data)) => {
                    debug!(channel = %ch_str, data_len = data.len(), "ZMODEM DOWNLOAD: received data from server");
                    let mut remaining = data.as_slice();
                    while !remaining.is_empty() {
                        let consumed = match receiver.feed_incoming(remaining) {
                            Ok(n) => n,
                            Err(e) => {
                                error!(channel = %ch_str, error = ?e, "Feed incoming error in download");
                                break;
                            }
                        };
                        if consumed == 0 {
                            break;
                        }
                        remaining = &remaining[consumed..];

                        process_file_data(
                            &mut receiver,
                            &mut pending_file_start,
                            &mut current_file,
                            &mut buffered_file_data,
                            &mut transferred,
                            &current_filename,
                            current_filesize,
                        );

                        process_events(
                            &mut receiver,
                            &mut pending_file_start,
                            &mut file_complete_pending,
                            &mut session_complete_pending,
                            &mut session_done,
                            &mut current_file,
                            &mut buffered_file_data,
                            &mut transferred,
                            &mut current_filename,
                            &mut current_filesize,
                            &save_path,
                        );

                        let out = receiver.drain_outgoing();
                        if !out.is_empty() {
                            send_to_channel(&command_tx, channel_id, out);
                            receiver.advance_outgoing(out.len());
                        }

                        if session_done {
                            break;
                        }
                    }
                }
                Some(ZmodemInput::SavePathSelected(path)) => {
                    debug!(channel = %ch_str, path = %path.display(), "ZMODEM DOWNLOAD: save path selected");
                    save_path = Some(path);
                    pending_file_start = false;

                    if !current_filename.is_empty() {
                        let sp = save_path.as_ref().unwrap();
                        let file_path = if sp.is_dir() || sp.extension().is_none() {
                            sp.join(&current_filename)
                        } else {
                            sp.clone()
                        };

                        if let Some(parent) = file_path.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }

                        match std::fs::File::create(&file_path) {
                            Ok(f) => {
                                current_file = Some(f);
                                for data in buffered_file_data.drain(..) {
                                    if let Some(ref mut file) = current_file {
                                        if let Err(e) = file.write_all(&data) {
                                            error!(channel = %ch_str, error = ?e, "Buffered data write error");
                                        }
                                        transferred += data.len() as u64;
                                    }
                                }
                                emit_progress(&app_handle, &ch_str, "download", &current_filename, transferred, current_filesize);
                            }
                            Err(e) => {
                                error!(channel = %ch_str, path = %file_path.display(), error = ?e, "Cannot create file");
                            }
                        }
                    }

                    if file_complete_pending {
                        if let Some(ref mut file) = current_file {
                            let _ = file.flush();
                        }
                        current_file = None;
                        file_complete_pending = false;
                    }

                    if session_complete_pending {
                        if let Some(ref mut file) = current_file {
                            let _ = file.flush();
                        }
                        current_file = None;
                        session_done = true;
                    }
                }
                Some(ZmodemInput::Cancel) | None => {
                    debug!(channel = %ch_str, "Zmodem download cancelled");
                    let cancel_bytes = b"\x18\x18\x18\x18\x08\x08\x08\x08";
                    send_to_channel(&command_tx, channel_id, cancel_bytes);
                    emit_complete(&app_handle, &ch_str, "download", false);
                    return;
                }
                _ => {}
            }
        }

        emit_complete(&app_handle, &ch_str, "download", true);
        debug!(channel = %ch_str, "Zmodem download session finished");
    });

    ZmodemSession { input_tx }
}
