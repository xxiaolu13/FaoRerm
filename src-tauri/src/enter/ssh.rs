use crate::client::domain::*;
use crate::client::common::*;
use crate::client::key::*;
use crate::service::{ServerConfig, AuthMethod, SessionHandles, SessionAuthState};
use crate::zmodem::{self, ZmodemSession, ZmodemStartEvent};
use russh::keys::PublicKeyBase64;
use serde::Serialize;
use std::path::PathBuf;
use tauri::ipc::Channel;
use tracing::*;
use uuid::Uuid;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct ChannelOutput {
    pub channel_id: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Serialize)]
pub struct SshEvent {
    pub session_id: String,
    pub channel_id: Option<String>,
    pub kind: SshEventKind,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type")]
pub enum SshEventKind {
    #[serde(rename = "state")]
    State { state: String },
    #[serde(rename = "error")]
    Error { error: String },
    #[serde(rename = "session_dropped")]
    SessionDropped,
    #[serde(rename = "host_key_unknown")]
    HostKeyUnknown { key_type: String, fingerprint: String },
    #[serde(rename = "host_key_received")]
    HostKeyReceived { key_type: String, fingerprint: String },
    #[serde(rename = "keyboard_auth")]
    KeyboardAuth { prompt: String },
    #[serde(rename = "channel_success")]
    ChannelSuccess,
    #[serde(rename = "channel_close")]
    ChannelClose,
    #[serde(rename = "channel_eof")]
    ChannelEof,
    #[serde(rename = "channel_failure")]
    ChannelFailure,
    #[serde(rename = "exit_status")]
    ExitStatus { exit_status: u32 },
    #[serde(rename = "exit_signal")]
    ExitSignal { signal_name: String, core_dumped: bool, error_message: String, lang_tag: String },
}

fn emit(app: &AppHandle, session_id: &str, channel_id: Option<&str>, kind: SshEventKind) {
    let _ = app.emit("ssh:event", &SshEvent {
        session_id: session_id.to_string(),
        channel_id: channel_id.map(|s| s.to_string()),
        kind,
    });
}

fn spawn_event_forwarder(
    app_handle: AppHandle,
    session_id: Uuid,
    mut event_rx: tokio::sync::mpsc::UnboundedReceiver<FRCEvent>,
    auth_state: Arc<Mutex<SessionAuthState>>,
    output_channel: Channel<ChannelOutput>,
) {
    let sid = session_id.to_string();
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            match event {
                FRCEvent::HostKeyReceived(key) => {
                    emit(&app_handle, &sid, None, SshEventKind::HostKeyReceived {
                        key_type: key.algorithm().as_str().to_string(),
                        fingerprint: key.public_key_base64(),
                    });
                }
                FRCEvent::HostKeyUnknown(key, tx) => {
                    let mut guard = auth_state.lock().await;
                    guard.pending_host_key = Some(tx);
                    emit(&app_handle, &sid, None, SshEventKind::HostKeyUnknown {
                        key_type: key.algorithm().as_str().to_string(),
                        fingerprint: key.public_key_base64(),
                    });
                }
                FRCEvent::KeyBoardAuth(prompt, tx) => {
                    let mut guard = auth_state.lock().await;
                    guard.pending_keyboard_auth = Some(tx);
                    emit(&app_handle, &sid, None, SshEventKind::KeyboardAuth { prompt });
                }
                FRCEvent::Output(channel_id, data) => {
                    let ch_str = channel_id.to_string();
                    let services = crate::FAO_SERVICES.lock().await;
                    let zmodem_guard = services.zmodem_sessions.lock().await;
                    if let Some(zsession) = zmodem_guard.get(&ch_str) {
                        info!(channel = %ch_str, data_len = data.len(), "ZMODEM ROUTE: sending data to existing zmodem session");
                        let _ = zsession.send_data(data.to_vec());
                        continue;
                    }
                    drop(zmodem_guard);
                    drop(services);

                    if let Some(direction) = zmodem::detect_zmodem(&data) {
                        info!(channel = %ch_str, direction = %direction, data_len = data.len(), "Zmodem detected, creating session");
                        let services = crate::FAO_SERVICES.lock().await;
                        let handles_guard = services.handles.lock().await;
                        if let Some(session_handles) = handles_guard.get(&sid) {
                            let command_tx = session_handles.command_tx.clone();
                            let ch_id = channel_id;
                            let zsession = if direction == "upload" {
                                zmodem::spawn_upload_session(
                                    app_handle.clone(),
                                    ch_id,
                                    command_tx,
                                    data.to_vec(),
                                )
                            } else {
                                zmodem::spawn_download_session(
                                    app_handle.clone(),
                                    ch_id,
                                    command_tx,
                                    data.to_vec(),
                                )
                            };

                            services.zmodem_sessions.lock().await.insert(ch_str.clone(), zsession);
                            let _ = app_handle.emit("zmodem:start", ZmodemStartEvent {
                                channel_id: ch_str.clone(),
                                direction: direction.to_string(),
                            });
                        }
                        continue;
                    }

                    let _ = output_channel.send(ChannelOutput {
                        channel_id: ch_str,
                        data: data.to_vec(),
                    });
                }
                FRCEvent::State(state) => {
                    let state_str = match state {
                        FRCState::NotInitialized => "NotInitialized",
                        FRCState::Connecting => "Connecting",
                        FRCState::Connected => "Connected",
                        FRCState::Disconnected => "Disconnected",
                    };
                    emit(&app_handle, &sid, None, SshEventKind::State {
                        state: state_str.to_string(),
                    });
                }
                FRCEvent::Error(err) => {
                    emit(&app_handle, &sid, None, SshEventKind::Error {
                        error: format!("{}", err),
                    });
                }
                FRCEvent::Success(channel_id) => {
                    let ch_str = channel_id.to_string();
                    {
                        let services = crate::FAO_SERVICES.lock().await;
                        let handles_guard = services.handles.lock().await;
                        if let Some(h) = handles_guard.get(&sid) {
                            h.channels.lock().await.insert(ch_str.clone());
                        };
                    }
                    emit(&app_handle, &sid, Some(&ch_str), SshEventKind::ChannelSuccess);
                }
                FRCEvent::Eof(channel_id) => {
                    emit(&app_handle, &sid, Some(&channel_id.to_string()), SshEventKind::ChannelEof);
                }
                FRCEvent::Close(channel_id) => {
                    let ch_str = channel_id.to_string();
                    {
                        let services = crate::FAO_SERVICES.lock().await;
                        let handles_guard = services.handles.lock().await;
                        if let Some(h) = handles_guard.get(&sid) {
                            h.channels.lock().await.remove(&ch_str);
                        };
                    }
                    emit(&app_handle, &sid, Some(&ch_str), SshEventKind::ChannelClose);
                }
                FRCEvent::ExitStatus(channel_id, exit_status) => {
                    emit(&app_handle, &sid, Some(&channel_id.to_string()), SshEventKind::ExitStatus { exit_status });
                }
                FRCEvent::ExitSignal { channel, signal_name, core_dumped, error_message, lang_tag } => {
                    emit(&app_handle, &sid, Some(&channel.to_string()), SshEventKind::ExitSignal {
                        signal_name: format!("{:?}", signal_name),
                        core_dumped,
                        error_message,
                        lang_tag,
                    });
                }
                FRCEvent::ChannelFailure(channel_id) => {
                    emit(&app_handle, &sid, Some(&channel_id.to_string()), SshEventKind::ChannelFailure);
                }
                FRCEvent::ExtendedData { channel, data, ext: _ } => {
                    let _ = output_channel.send(ChannelOutput {
                        channel_id: channel.to_string(),
                        data: data.to_vec(),
                    });
                }
                FRCEvent::ConnectionError(err) => {
                    emit(&app_handle, &sid, None, SshEventKind::Error {
                        error: format!("{}", err),
                    });
                }
                FRCEvent::Done => {
                    info!(session_id = %sid, "Session done, cleaning up");
                    break;
                }
                _ => {}
            }
        }

        emit(&app_handle, &sid, None, SshEventKind::SessionDropped);

        let services = crate::FAO_SERVICES.lock().await;
        services.handles.lock().await.remove(&sid);
        services.auth_states.lock().await.remove(&sid);
        info!(session_id = %sid, "Session cleaned up");
    });
}

fn build_ssh_options(
    server: &ServerConfig,
    user_password: &str,
) -> Result<TargetSSHOptions, String> {
    let auth = match &server.auth {
        AuthMethod::Password => {
            let secret = server.secret.as_ref()
                .ok_or("Password auth but no secret stored")?;
            let encrypted = EncryptedPassword::new(secret)
                .map_err(|e| format!("Failed to parse secret: {}", e))?;
            TargetSSHAuth::PassWord(encrypted)
        }
        AuthMethod::Key => {
            let path = server.secret.clone()
                .ok_or("Key auth but no key path stored")?;
            TargetSSHAuth::PrivateKeyPath(path)
        }
    };

    Ok(TargetSSHOptions {
        name: server.id.clone(),
        host_id: Uuid::new_v4(),
        host: server.host.clone(),
        port: server.port,
        username: server.user.clone(),
        allow_insecure_algos: Some(server.allow_insecure_algos),
        auth,
    })
}

#[tauri::command]
pub async fn ssh_connect(
    app_handle: AppHandle,
    server_id: String,
    output_channel: Channel<ChannelOutput>,
) -> Result<String, String> {
    let services = crate::FAO_SERVICES.lock().await.clone();

    let user_password = {
        services.master_password.lock().await.clone()
            .ok_or("Master password not set. Please unlock first.")?
    };

    let server = services.config.get_server(&server_id)
        .ok_or(format!("Server '{}' not found", server_id))?;

    let ssh_options = build_ssh_options(&server, &user_password)?;

    let session_id = Uuid::new_v4();
    let sid_str = session_id.to_string();

    let auth_state = Arc::new(Mutex::new(SessionAuthState {
        pending_host_key: None,
        pending_keyboard_auth: None,
    }));

    let handles = FaoRemoteClient::new(session_id, services)
        .map_err(|e| format!("Failed to create SSH client: {}", e))?;

    let FaoRemoteClientHandles { event_rx, command_tx, abort_tx } = handles;

    {
        let services = crate::FAO_SERVICES.lock().await;
        let mut handles_guard = services.handles.lock().await;
        handles_guard.insert(sid_str.clone(), SessionHandles {
            command_tx: command_tx.clone(),
            abort_tx: abort_tx.clone(),
            channels: Arc::new(Mutex::new(HashSet::new())),
        });
    }
    {
        let services = crate::FAO_SERVICES.lock().await;
        let mut auth_guard = services.auth_states.lock().await;
        auth_guard.insert(sid_str.clone(), auth_state.clone());
    }

    spawn_event_forwarder(app_handle.clone(), session_id, event_rx, auth_state, output_channel);

    command_tx.send((FRCCommand::Connect(ssh_options), None))
        .map_err(|_| "Failed to send connect command")?;

    info!(session_id = %sid_str, server = %server_id, "SSH connect command sent");
    Ok(sid_str)
}

#[tauri::command]
pub async fn ssh_disconnect(session_id: String) -> Result<(), String> {
    let services = crate::FAO_SERVICES.lock().await;
    let handles_guard = services.handles.clone();
    let guard = handles_guard.lock().await;

    if let Some(session) = guard.get(&session_id) {
        let _ = session.command_tx.send((FRCCommand::Disconnect, None));
        info!(session_id = %session_id, "Disconnect command sent");
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_close_channel(
    session_id: String,
    channel_id: String,
) -> Result<(), String> {
    let services = crate::FAO_SERVICES.lock().await;
    let handles_guard = services.handles.clone();
    let guard = handles_guard.lock().await;

    let session = guard.get(&session_id)
        .ok_or(format!("Session '{}' not found", session_id))?;

    let ch_id = Uuid::parse_str(&channel_id)
        .map_err(|e| format!("Invalid channel_id: {}", e))?;

    session.command_tx.send((FRCCommand::Channel(ch_id, ChannelOperation::Close), None))
        .map_err(|_| "Failed to send close channel command")?;

    session.channels.lock().await.remove(&channel_id);

    let remaining = session.channels.lock().await.len();
    if remaining == 0 {
        session.command_tx.send((FRCCommand::Disconnect, None))
            .map_err(|_| "Failed to send disconnect command")?;
        info!(session_id = %session_id, "Last channel closed, disconnecting session");
    } else {
        info!(session_id = %session_id, channel_id = %channel_id, remaining, "Channel closed");
    }

    Ok(())
}

#[tauri::command]
pub async fn ssh_open_shell(
    session_id: String,
    channel_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let services = crate::FAO_SERVICES.lock().await;
    let handles_guard = services.handles.clone();
    let guard = handles_guard.lock().await;

    let session = guard.get(&session_id)
        .ok_or(format!("Session '{}' not found", session_id))?;

    let ch_id = Uuid::parse_str(&channel_id)
        .map_err(|e| format!("Invalid channel_id: {}", e))?;

    session.command_tx.send((FRCCommand::Channel(ch_id, ChannelOperation::OpenShell), None))
        .map_err(|_| "Failed to send open shell command")?;

    session.command_tx.send((FRCCommand::Channel(ch_id, ChannelOperation::RequestPty(PtyRequest {
        term: "xterm-256color".to_string(),
        col_width: cols,
        row_height: rows,
        pix_width: 0,
        pix_height: 0,
        modes: vec![],
    })), None)).map_err(|_| "Failed to send pty request")?;

    session.command_tx.send((FRCCommand::Channel(ch_id, ChannelOperation::RequestShell), None))
        .map_err(|_| "Failed to send shell request")?;

    info!(session_id = %session_id, channel_id = %channel_id, "Shell open commands sent");
    Ok(())
}

#[tauri::command]
pub async fn ssh_send_data(
    session_id: String,
    channel_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let services = crate::FAO_SERVICES.lock().await;
    let zmodem_guard = services.zmodem_sessions.lock().await;
    if zmodem_guard.contains_key(&channel_id) {
        return Ok(());
    }
    drop(zmodem_guard);
    drop(services);

    let services = crate::FAO_SERVICES.lock().await;
    let handles_guard = services.handles.clone();
    let guard = handles_guard.lock().await;

    let session = guard.get(&session_id)
        .ok_or(format!("Session '{}' not found", session_id))?;

    let ch_id = Uuid::parse_str(&channel_id)
        .map_err(|e| format!("Invalid channel_id: {}", e))?;

    session.command_tx.send((FRCCommand::Channel(ch_id, ChannelOperation::Data(data.into())), None))
        .map_err(|_| "Failed to send data")?;

    Ok(())
}

#[tauri::command]
pub async fn ssh_resize_pty(
    session_id: String,
    channel_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let services = crate::FAO_SERVICES.lock().await;
    let handles_guard = services.handles.clone();
    let guard = handles_guard.lock().await;

    let session = guard.get(&session_id)
        .ok_or(format!("Session '{}' not found", session_id))?;

    let ch_id = Uuid::parse_str(&channel_id)
        .map_err(|e| format!("Invalid channel_id: {}", e))?;

    session.command_tx.send((FRCCommand::Channel(ch_id, ChannelOperation::ResizePty(PtyRequest {
        term: "xterm-256color".to_string(),
        col_width: cols,
        row_height: rows,
        pix_width: 0,
        pix_height: 0,
        modes: vec![],
    })), None)).map_err(|_| "Failed to send resize command")?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_confirm_host_key(
    session_id: String,
    accepted: bool,
) -> Result<(), String> {
    let services = crate::FAO_SERVICES.lock().await;
    let auth_guard = services.auth_states.clone();
    let guard = auth_guard.lock().await;

    let auth_state = guard.get(&session_id)
        .ok_or(format!("No pending auth for session '{}'", session_id))?;

    let mut state = auth_state.lock().await;
    if let Some(tx) = state.pending_host_key.take() {
        let _ = tx.send(accepted);
        info!(session_id = %session_id, accepted = accepted, "Host key confirmation sent");
    } else {
        return Err("No pending host key verification".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn ssh_respond_keyboard_auth(
    session_id: String,
    response: String,
) -> Result<(), String> {
    let services = crate::FAO_SERVICES.lock().await;
    let auth_guard = services.auth_states.clone();
    let guard = auth_guard.lock().await;

    let auth_state: &Arc<Mutex<SessionAuthState>> = guard.get(&session_id)
        .ok_or(format!("No pending auth for session '{}'", session_id))?;

    let mut state = auth_state.lock().await;
    if let Some(tx) = state.pending_keyboard_auth.take() {
        let _ = tx.send(response);
        info!(session_id = %session_id, "Keyboard auth response sent");
    } else {
        return Err("No pending keyboard-interactive auth".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn zmodem_provide_files(
    channel_id: String,
    paths: Vec<String>,
) -> Result<(), String> {
    let file_paths: Vec<PathBuf> = paths.iter().map(|p| PathBuf::from(p)).collect();
    let services = crate::FAO_SERVICES.lock().await;
    let zmodem_guard = services.zmodem_sessions.lock().await;
    let zsession = zmodem_guard.get(&channel_id)
        .ok_or(format!("No zmodem session for channel '{}'", channel_id))?;
    zsession.provide_files(file_paths)
}

#[tauri::command]
pub async fn zmodem_provide_save_path(
    channel_id: String,
    path: String,
) -> Result<(), String> {
    let save_path = PathBuf::from(&path);
    let services = crate::FAO_SERVICES.lock().await;
    let zmodem_guard = services.zmodem_sessions.lock().await;
    let zsession = zmodem_guard.get(&channel_id)
        .ok_or(format!("No zmodem session for channel '{}'", channel_id))?;
    zsession.provide_save_path(save_path)
}

#[tauri::command]
pub async fn zmodem_cancel(
    channel_id: String,
) -> Result<(), String> {
    let services = crate::FAO_SERVICES.lock().await;
    let mut zmodem_guard = services.zmodem_sessions.lock().await;
    if let Some(zsession) = zmodem_guard.remove(&channel_id) {
        let _ = zsession.cancel();
    }
    Ok(())
}
