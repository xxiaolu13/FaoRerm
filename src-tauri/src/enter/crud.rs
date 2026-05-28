
use crate::client::key::*;

use crate::service::FaoConfig;
use crate::service::{ ServerConfig, AIConfig, ProviderConfig, BlacklistConfig, AppearanceConfig, AuthMethod};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use bytes::Bytes;
use russh::keys::PublicKeyBase64;
use tracing::*;
use uuid::Uuid;
use std::sync::Arc;
use tokio::sync::{Mutex,oneshot};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use std::collections::{HashMap, BTreeMap};
use once_cell::sync::Lazy;
use tauri::AppHandle;
use crate::FAO_SERVICES;


// ========================= CRUD ===================================
#[tauri::command]
pub async fn get_all_config() -> Result<FaoConfig, String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .get_snapshot();

    Ok(info)
}

#[tauri::command]
pub async fn get_all_server() -> Result<BTreeMap<String, ServerConfig>, String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .get_snapshot();
    let server = info.server;
    Ok(server)
}

#[tauri::command]
pub async fn get_ai_config() -> Result<AIConfig, String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .get_snapshot();
    let config = info.ai;
    Ok(config)
}

#[tauri::command]
pub async fn get_blacklist_config() -> Result<BlacklistConfig, String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .get_snapshot();
    let config = info.blacklist;
    Ok(config)
}


#[tauri::command]// tauri 入口专用的add server，输入的password 自动转化为secret
pub async fn add_server_config(server_key: String, mut server: ServerConfig) -> Result<(), String> {

    let user_password = {
        let services = FAO_SERVICES.lock().await;
        let pw = services.master_password.lock().await.clone();
        pw.ok_or("Master password not available, please unlock")?
    };

    let secret = match server.auth{
        AuthMethod::Key => { server.secret.take() }
        AuthMethod::Password => {
            match server.secret{
                Some(e) => {
                    Some(server_password_into_secret(&user_password, &e).map_err(|s|{format!("server password -> secret Error: {}",s)})?)
                }
                _ => None
            }
        }
    };

    server.secret = secret;


    let info = FAO_SERVICES
        .lock()
        .await
        .config.clone();
    info.upsert_server(&server_key, server)
    .map_err(|e| format!("add server error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn del_server_config(server_id: String) -> Result<(), String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config.clone();
    info.delete_server(&server_id)
    .map_err(|e| format!("delete server error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn add_blacklist_config(contain: String) -> Result<(), String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .clone();
    info.insert_black_list(&contain)
    .map_err(|e| format!("add blacklist error: {}", e))?;
    Ok(())
}


#[tauri::command]
pub async fn add_and_edit_quick_command(description: String,command: String) -> Result<(), String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .clone();
    info.upsert_quick_command(&description,&command)
    .map_err(|e| format!("add quick command error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn del_quick_command(description: String) -> Result<(), String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .clone();
    info.delete_quick_command(&description)
    .map_err(|e| format!("delete quick command error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_appearance_config() -> Result<AppearanceConfig, String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .get_snapshot();
    Ok(info.appearance)
}

#[tauri::command]
pub async fn update_appearance_config(theme: String) -> Result<(), String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .clone();
    info.update_appearance(&theme)
    .map_err(|e| format!("update appearance error: {}", e))?;
    Ok(())
}

// ========================= AI Provider CRUD =========================

#[tauri::command]
pub async fn get_ai_providers() -> Result<BTreeMap<String, ProviderConfig>, String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .get_ai_providers();
    Ok(info)
}

#[tauri::command]
pub async fn upsert_ai_provider(name: String, config: ProviderConfig) -> Result<(), String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .clone();
    info.upsert_ai_provider(&name, config)
    .map_err(|e| format!("upsert ai provider error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_ai_provider(name: String) -> Result<(), String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .clone();
    info.delete_ai_provider(&name)
    .map_err(|e| format!("delete ai provider error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn set_default_ai_provider(name: String) -> Result<(), String> {
    let info = FAO_SERVICES
        .lock()
        .await
        .config
        .clone();
    info.set_default_provider(&name)
    .map_err(|e| format!("set default ai provider error: {}", e))?;
    Ok(())
}

// ========================= Copilot Commands =========================

#[tauri::command]
pub async fn copilot_ask(
    app_handle: AppHandle,
    session_id: String,
    channel_id: String,
    question: String,
) -> Result<(), String> {
    let services = FAO_SERVICES.lock().await;
    let cancel_map = services.copilot_cancel.clone();
    drop(services);

    if cancel_map.contains_key(&channel_id) {
        return Err("AI is already processing a request for this channel".to_string());
    }

    let ch_id_for_emit = channel_id.clone();
    let ai = crate::copilot::TerminalAi::new(
        FAO_SERVICES.clone(),
        session_id,
        channel_id,
        app_handle,
    );

    let emit_handle = ai.app_handle.clone();
    tokio::spawn(async move {
        if let Err(e) = ai.ask_stream(&question).await {
            let _ = tauri::Emitter::emit(
                &emit_handle,
                &format!("copilot:event:{}", ch_id_for_emit),
                serde_json::json!({
                    "type": "error",
                    "message": e.to_string(),
                }),
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn copilot_cancel(
    channel_id: String,
) -> Result<(), String> {
    let services = FAO_SERVICES.lock().await;
    if let Some((_, token)) = services.copilot_cancel.remove(&channel_id) {
        token.cancel();
    }
    drop(services);
    Ok(())
}

#[tauri::command]
pub async fn copilot_confirm_decision(
    request_id: String,
    approved: bool,
) -> Result<(), String> {
    let rid = Uuid::parse_str(&request_id)
        .map_err(|e| format!("Invalid request_id: {}", e))?;

    let pending_confirms = {
        let services = FAO_SERVICES.lock().await;
        services.pending_confirms.clone()
    };

    if let Some((_, tx)) = pending_confirms.remove(&rid) {
        let decision = if approved {
            cersei_tools::permissions::PermissionDecision::Allow
        } else {
            cersei_tools::permissions::PermissionDecision::Deny("User denied".into())
        };
        let _ = tx.send(decision);
        Ok(())
    } else {
        Err("No pending confirm for this request_id".to_string())
    }
}

#[tauri::command]
pub async fn copilot_set_provider(
    channel_id: String,
    provider_name: String,
) -> Result<(), String> {
    let services = FAO_SERVICES.lock().await;

    let provider_exists = services.config.get_ai_providers().contains_key(&provider_name);
    if !provider_exists {
        return Err(format!("Provider '{}' not found", provider_name));
    }

    let mut copilots = services.copilots.lock().await;
    if let Some(copilot) = copilots.get_mut(&channel_id) {
        copilot.active_provider = provider_name;
        copilot.conversation.clear();
    } else {
        copilots.insert(channel_id, crate::service::ChannelCopilot {
            active_provider: provider_name,
            conversation: Vec::new(),
            model: String::new(),
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn copilot_clear_conversation(channel_id: String) -> Result<(), String> {
    let services = FAO_SERVICES.lock().await;
    let mut copilots = services.copilots.lock().await;
    if let Some(copilot) = copilots.get_mut(&channel_id) {
        copilot.conversation.clear();
    }
    Ok(())
}
