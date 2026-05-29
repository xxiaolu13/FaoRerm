mod service;
mod client;
mod enter;
mod zmodem;
mod copilot;
use std::sync::Arc;
use tokio::sync::Mutex;
use once_cell::sync::Lazy;
use crate::service::Services;
use crate::enter::crud::*;
use crate::enter::screen::*;
use crate::enter::ssh::*;
use crate::copilot::SessionRecordings;

pub static FAO_SERVICES: Lazy<Arc<Mutex<Services>>> =
    Lazy::new(|| Arc::new(Mutex::new(Services::new().unwrap())));

pub static FAO_RECORD: Lazy<Arc<SessionRecordings>> =
    Lazy::new(|| Arc::new(SessionRecordings::new()));


#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            // CRUD
            get_all_config,
            get_all_server,
            get_ai_config,
            get_blacklist_config,
            add_server_config,
            del_server_config,
            add_blacklist_config,
            add_and_edit_quick_command,
            del_quick_command,
            get_appearance_config,
            update_appearance_config,
            // Screen / Master Password
            unlock,
            clear_master_password,
            get_master_password_status,
            // SSH
            ssh_connect,
            ssh_disconnect,
            ssh_close_channel,
            ssh_open_shell,
            ssh_send_data,
            ssh_resize_pty,
            ssh_confirm_host_key,
            ssh_respond_keyboard_auth,
            // Zmodem
            zmodem_provide_files,
            zmodem_provide_save_path,
            zmodem_cancel,
            // AI Provider CRUD
            get_ai_providers,
            upsert_ai_provider,
            delete_ai_provider,
            set_default_ai_provider,
            // Copilot
            copilot_ask,
            copilot_confirm_decision,
            copilot_cancel,
            copilot_set_provider,
            copilot_clear_conversation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
