use crate::client::domain::*;
use crate::client::common::*;
use crate::client::key::*;
use russh::Pty;
use crate::service::FaoConfig;
use crate::service::{Services, ServerConfig, AIConfig, BlacklistConfig, AuthMethod};
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

// ========================= Master Password ===================================
#[tauri::command]
pub async fn unlock(password: String) -> Result<(), String> {
    let services = FAO_SERVICES.lock().await;
    *services.master_password.lock().await = Some(password);
    Ok(())
}

#[tauri::command]
pub async fn clear_master_password() -> Result<(), String> {
    let services = FAO_SERVICES.lock().await;
    *services.master_password.lock().await = None;
    Ok(())
}

#[tauri::command]
pub async fn get_master_password_status() -> Result<bool, String> {
    let services = FAO_SERVICES.lock().await;
    let status = services.master_password.lock().await.is_some();
    Ok(status)
}
