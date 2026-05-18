use crate::client::domain::*;
use crate::client::common::*;
use crate::client::key::*;
use crate::service::{ServerConfig, AuthMethod, SessionHandles, SessionAuthState};
use russh::keys::PublicKeyBase64;
use serde::Serialize;
use tauri::ipc::Channel;
use tracing::*;
use uuid::Uuid;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct ChannelOutput {
    pub channel_id: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Serialize)]
pub struct HostKeyUnknownPayload {
    pub session_id: String,
    pub key_type: String,
    pub fingerprint: String,
}

#[derive(Clone, Serialize)]
pub struct KeyBoardAuthPayload {
    pub session_id: String,
    pub prompt: String,
}

#[derive(Clone, Serialize)]
pub struct SshStatePayload {
    pub session_id: String,
    pub state: String,
}

#[derive(Clone, Serialize)]
pub struct SshErrorPayload {
    pub session_id: String,
    pub error: String,
}

#[derive(Clone, Serialize)]
pub struct SshChannelPayload {
    pub session_id: String,
    pub channel_id: String,
    pub event_type: String,
}

#[derive(Clone, Serialize)]
pub struct SshExitStatusPayload {
    pub session_id: String,
    pub channel_id: String,
    pub exit_status: u32,
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
                    let payload = HostKeyUnknownPayload {
                        session_id: sid.clone(),
                        key_type: key.algorithm().as_str().to_string(),
                        fingerprint: key.public_key_base64(),
                    };
                    let _ = app_handle.emit("ssh:host-key-received", &payload);
                }
                FRCEvent::HostKeyUnknown(key, tx) => {
                    let mut guard = auth_state.lock().await;
                    guard.pending_host_key = Some(tx);
                    let payload = HostKeyUnknownPayload {
                        session_id: sid.clone(),
                        key_type: key.algorithm().as_str().to_string(),
                        fingerprint: key.public_key_base64(),
                    };
                    let _ = app_handle.emit("ssh:host-key-unknown", &payload);
                }
                FRCEvent::KeyBoardAuth(prompt, tx) => {
                    let mut guard = auth_state.lock().await;
                    guard.pending_keyboard_auth = Some(tx);
                    let payload = KeyBoardAuthPayload {
                        session_id: sid.clone(),
                        prompt,
                    };
                    let _ = app_handle.emit("ssh:keyboard-auth", &payload);
                }
                FRCEvent::Output(channel_id, data) => {
                    let _ = output_channel.send(ChannelOutput {
                        channel_id: channel_id.to_string(),
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
                    let payload = SshStatePayload {
                        session_id: sid.clone(),
                        state: state_str.to_string(),
                    };
                    let _ = app_handle.emit("ssh:state", &payload);
                }
                FRCEvent::Error(err) => {
                    let payload = SshErrorPayload {
                        session_id: sid.clone(),
                        error: format!("{}", err),
                    };
                    let _ = app_handle.emit("ssh:error", &payload);
                }
                FRCEvent::Success(channel_id) => {
                    let payload = SshChannelPayload {
                        session_id: sid.clone(),
                        channel_id: channel_id.to_string(),
                        event_type: "Success".to_string(),
                    };
                    let _ = app_handle.emit("ssh:channel-event", &payload);
                }
                FRCEvent::Eof(channel_id) => {
                    let payload = SshChannelPayload {
                        session_id: sid.clone(),
                        channel_id: channel_id.to_string(),
                        event_type: "Eof".to_string(),
                    };
                    let _ = app_handle.emit("ssh:channel-event", &payload);
                }
                FRCEvent::Close(channel_id) => {
                    let payload = SshChannelPayload {
                        session_id: sid.clone(),
                        channel_id: channel_id.to_string(),
                        event_type: "Close".to_string(),
                    };
                    let _ = app_handle.emit("ssh:channel-event", &payload);
                }
                FRCEvent::ExitStatus(channel_id, exit_status) => {
                    let payload = SshExitStatusPayload {
                        session_id: sid.clone(),
                        channel_id: channel_id.to_string(),
                        exit_status,
                    };
                    let _ = app_handle.emit("ssh:exit-status", &payload);
                }
                FRCEvent::ExitSignal { channel, signal_name, core_dumped, error_message, lang_tag } => {
                    let payload = SshChannelPayload {
                        session_id: sid.clone(),
                        channel_id: channel.to_string(),
                        event_type: format!("ExitSignal({:?},{},{},{})", signal_name, core_dumped, error_message, lang_tag),
                    };
                    let _ = app_handle.emit("ssh:channel-event", &payload);
                }
                FRCEvent::ChannelFailure(channel_id) => {
                    let payload = SshChannelPayload {
                        session_id: sid.clone(),
                        channel_id: channel_id.to_string(),
                        event_type: "ChannelFailure".to_string(),
                    };
                    let _ = app_handle.emit("ssh:channel-event", &payload);
                }
                FRCEvent::ExtendedData { channel, data, ext: _ } => {
                    let _ = output_channel.send(ChannelOutput {
                        channel_id: channel.to_string(),
                        data: data.to_vec(),
                    });
                }
                FRCEvent::ConnectionError(err) => {
                    let payload = SshErrorPayload {
                        session_id: sid.clone(),
                        error: format!("{}", err),
                    };
                    let _ = app_handle.emit("ssh:error", &payload);
                }
                FRCEvent::Done => {
                    info!(session_id = %sid, "Session done, cleaning up");
                    break;
                }
                _ => {}
            }
        }

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
