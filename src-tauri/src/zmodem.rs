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
    let _ = command_tx.send((
        FRCCommand::Channel(channel_id, ChannelOperation::Data(data.to_vec().into())),
        None,
    ));
}

fn emit_progress(app: &AppHandle, channel_id: &str, direction: &str, filename: &str, transferred: u64, total: u64) {
    let _ = app.emit("zmodem:progress", ZmodemProgress {
        channel_id: channel_id.to_string(),
        direction: direction.to_string(),
        filename: filename.to_string(),
        transferred,
        total,
    });
}

fn emit_complete(app: &AppHandle, channel_id: &str, direction: &str, success: bool) {
    let _ = app.emit("zmodem:complete", ZmodemCompleteEvent {
        channel_id: channel_id.to_string(),
        direction: direction.to_string(),
        success,
    });
    let ch = channel_id.to_string();
    tokio::spawn(async move {
        let services = crate::FAO_SERVICES.lock().await;
        services.zmodem_sessions.lock().await.remove(&ch);
        info!(channel_id = %ch, "Zmodem session removed from registry");
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
        let mut files_to_send: Vec<PathBuf> = Vec::new();
        let mut waiting_for_files = true;

        while waiting_for_files {
            match input_rx.recv().await {
                Some(ZmodemInput::FilesSelected(paths)) => {
                    files_to_send = paths;
                    waiting_for_files = false;
                }
                Some(ZmodemInput::Cancel) | None => {
                    info!(channel = %ch_str, "Zmodem upload cancelled before file selection");
                    let cancel_bytes = b"\x18\x18\x18\x18\x08\x08\x08\x08";
                    send_to_channel(&command_tx, channel_id, cancel_bytes);
                    emit_complete(&app_handle, &ch_str, "upload", false);
                    return;
                }
                Some(ZmodemInput::Data(d)) => {
                    let _ = d;
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
            Ok(s) => s,
            Err(e) => {
                error!(channel = %ch_str, error = ?e, "Failed to create zmodem sender");
                emit_complete(&app_handle, &ch_str, "upload", false);
                return;
            }
        };

        let out = sender.drain_outgoing();
        sender.advance_outgoing(out.len());

        if !initial_data.is_empty() {
            if let Err(e) = sender.feed_incoming(&initial_data) {
                error!(channel = %ch_str, error = ?e, "Failed to feed initial data to sender");
                emit_complete(&app_handle, &ch_str, "upload", false);
                return;
            }
        }

        let out = sender.drain_outgoing();
        if !out.is_empty() {
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

            let file_name_bytes = file_name.as_bytes();
            if let Err(e) = sender.start_file(file_name_bytes, file_size) {
                error!(channel = %ch_str, error = ?e, "Failed to start file transfer");
                continue;
            }

            let out = sender.drain_outgoing();
            if !out.is_empty() {
                send_to_channel(&command_tx, channel_id, out);
                sender.advance_outgoing(out.len());
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

            emit_progress(&app_handle, &ch_str, "upload", &file_name, 0, total);

            while !file_done {
                while let Some(req) = sender.poll_file() {
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
                    send_to_channel(&command_tx, channel_id, out);
                    sender.advance_outgoing(out.len());
                }

                while let Some(event) = sender.poll_event() {
                    match event {
                        zmodem2::SenderEvent::FileComplete => {
                            info!(channel = %ch_str, file = %file_name, "File upload complete");
                            emit_progress(&app_handle, &ch_str, "upload", &file_name, total, total);
                            file_done = true;
                        }
                        zmodem2::SenderEvent::SessionComplete => {
                            info!(channel = %ch_str, "Zmodem upload session complete");
                            file_done = true;
                        }
                    }
                }

                if file_done {
                    break;
                }

                if sender.poll_file().is_none() && !sender.drain_outgoing().is_empty() {
                    continue;
                }

                if sender.poll_file().is_none() && sender.drain_outgoing().is_empty() {
                    tokio::select! {
                        input = input_rx.recv() => {
                            match input {
                                Some(ZmodemInput::Data(data)) => {
                                    if let Err(e) = sender.feed_incoming(&data) {
                                        error!(channel = %ch_str, error = ?e, "Feed incoming error");
                                        break;
                                    }
                                }
                                Some(ZmodemInput::Cancel) | None => {
                                    info!(channel = %ch_str, "Zmodem upload cancelled");
                                    let cancel_bytes = b"\x18\x18\x18\x18\x08\x08\x08\x08";
                                    send_to_channel(&command_tx, channel_id, cancel_bytes);
                                    emit_complete(&app_handle, &ch_str, "upload", false);
                                    return;
                                }
                                _ => {}
                            }
                        }
                    }

                    let out = sender.drain_outgoing();
                    if !out.is_empty() {
                        send_to_channel(&command_tx, channel_id, out);
                        sender.advance_outgoing(out.len());
                    }

                    while let Some(event) = sender.poll_event() {
                        match event {
                            zmodem2::SenderEvent::FileComplete => {
                                file_done = true;
                            }
                            zmodem2::SenderEvent::SessionComplete => {
                                file_done = true;
                            }
                        }
                    }
                }
            }
        }

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
                    if let Err(e) = sender.feed_incoming(&data) {
                        error!(channel = %ch_str, error = ?e, "Feed incoming error during finish");
                        break;
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
        info!(channel = %ch_str, "Zmodem upload session finished");
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
        let mut save_path: Option<PathBuf> = None;
        let mut waiting_for_path = true;
        let mut buffered_data: Vec<Vec<u8>> = Vec::new();

        while waiting_for_path {
            match input_rx.recv().await {
                Some(ZmodemInput::SavePathSelected(path)) => {
                    save_path = Some(path);
                    waiting_for_path = false;
                }
                Some(ZmodemInput::Cancel) | None => {
                    info!(channel = %ch_str, "Zmodem download cancelled before path selection");
                    let cancel_bytes = b"\x18\x18\x18\x18\x08\x08\x08\x08";
                    send_to_channel(&command_tx, channel_id, cancel_bytes);
                    emit_complete(&app_handle, &ch_str, "download", false);
                    return;
                }
                Some(ZmodemInput::Data(d)) => {
                    buffered_data.push(d);
                }
                Some(ZmodemInput::FilesSelected(_)) => {}
            }
        }

        let save_path = match save_path {
            Some(p) => p,
            None => {
                emit_complete(&app_handle, &ch_str, "download", false);
                return;
            }
        };

        let mut receiver = match zmodem2::Receiver::new() {
            Ok(r) => r,
            Err(e) => {
                error!(channel = %ch_str, error = ?e, "Failed to create zmodem receiver");
                emit_complete(&app_handle, &ch_str, "download", false);
                return;
            }
        };

        if !initial_data.is_empty() {
            if let Err(e) = receiver.feed_incoming(&initial_data) {
                error!(channel = %ch_str, error = ?e, "Failed to feed initial data to receiver");
            }
        }

        for data in &buffered_data {
            if let Err(e) = receiver.feed_incoming(data) {
                error!(channel = %ch_str, error = ?e, "Failed to feed buffered data to receiver");
            }
        }
        buffered_data.clear();

        let out = receiver.drain_outgoing();
        if !out.is_empty() {
            send_to_channel(&command_tx, channel_id, out);
            receiver.advance_outgoing(out.len());
        }

        let mut current_file: Option<std::fs::File> = None;
        let mut current_filename = String::new();
        let mut current_filesize: u64 = 0;
        let mut transferred: u64 = 0;
        let mut session_done = false;

        while !session_done {
            let out = receiver.drain_outgoing();
            if !out.is_empty() {
                send_to_channel(&command_tx, channel_id, out);
                receiver.advance_outgoing(out.len());
            }

            let file_data = receiver.drain_file();
            if !file_data.is_empty() {
                if let Some(ref mut file) = current_file {
                    if let Err(e) = file.write_all(file_data) {
                        error!(channel = %ch_str, error = ?e, "File write error");
                    }
                    transferred += file_data.len() as u64;
                    emit_progress(&app_handle, &ch_str, "download", &current_filename, transferred, current_filesize);
                }
                receiver.advance_file(file_data.len()).ok();
            }

            while let Some(event) = receiver.poll_event() {
                match event {
                    zmodem2::ReceiverEvent::FileStart => {
                        let fname_bytes = receiver.file_name();
                        let fname_str = String::from_utf8_lossy(fname_bytes).to_string();
                        current_filename = fname_str;
                        current_filesize = receiver.file_size() as u64;
                        transferred = 0;

                        let file_path = if save_path.is_dir() || save_path.extension().is_none() {
                            save_path.join(&current_filename)
                        } else {
                            save_path.clone()
                        };

                        if let Some(parent) = file_path.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }

                        match std::fs::File::create(&file_path) {
                            Ok(f) => {
                                current_file = Some(f);
                                info!(channel = %ch_str, file = %current_filename, size = current_filesize, "Starting download");
                                emit_progress(&app_handle, &ch_str, "download", &current_filename, 0, current_filesize);
                            }
                            Err(e) => {
                                error!(path = %file_path.display(), error = ?e, "Cannot create file");
                            }
                        }
                    }
                    zmodem2::ReceiverEvent::FileComplete => {
                        if let Some(file) = current_file.take() {
                            drop(file);
                        }
                        info!(channel = %ch_str, file = %current_filename, "File download complete");
                        if current_filesize > 0 {
                            emit_progress(&app_handle, &ch_str, "download", &current_filename, current_filesize, current_filesize);
                        } else {
                            emit_progress(&app_handle, &ch_str, "download", &current_filename, transferred, transferred);
                        }
                        current_filename.clear();
                    }
                    zmodem2::ReceiverEvent::SessionComplete => {
                        info!(channel = %ch_str, "Zmodem download session complete");
                        session_done = true;
                    }
                }
            }

            if session_done {
                break;
            }

            let out = receiver.drain_outgoing();
            if !out.is_empty() {
                send_to_channel(&command_tx, channel_id, out);
                receiver.advance_outgoing(out.len());
                continue;
            }

            tokio::select! {
                input = input_rx.recv() => {
                    match input {
                        Some(ZmodemInput::Data(data)) => {
                            if let Err(e) = receiver.feed_incoming(&data) {
                                error!(channel = %ch_str, error = ?e, "Feed incoming error");
                                break;
                            }
                        }
                        Some(ZmodemInput::Cancel) | None => {
                            info!(channel = %ch_str, "Zmodem download cancelled");
                            let cancel_bytes = b"\x18\x18\x18\x18\x08\x08\x08\x08";
                            send_to_channel(&command_tx, channel_id, cancel_bytes);
                            emit_complete(&app_handle, &ch_str, "download", false);
                            return;
                        }
                        _ => {}
                    }
                }
            }
        }

        let out = receiver.drain_outgoing();
        if !out.is_empty() {
            send_to_channel(&command_tx, channel_id, out);
            receiver.advance_outgoing(out.len());
        }

        emit_complete(&app_handle, &ch_str, "download", true);
        info!(channel = %ch_str, "Zmodem download session finished");
    });

    ZmodemSession { input_tx }
}
