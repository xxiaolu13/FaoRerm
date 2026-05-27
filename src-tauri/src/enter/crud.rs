
use crate::client::key::*;

use crate::service::FaoConfig;
use crate::service::{ ServerConfig, AIConfig, BlacklistConfig, AppearanceConfig, AuthMethod};
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