mod service;
mod client;
mod enter;
mod zmodem;
mod copilot;
use std::sync::Arc;
use tokio::sync::Mutex;
use once_cell::sync::Lazy;
use tauri::{Manager, PhysicalPosition, PhysicalSize};
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

/// 启动时根据主显示器可用尺寸自适应调整窗口大小并居中，
/// 避免在小屏幕（笔记本）上超出可视区域。
/// 比例 0.9，最大 1600x1000，最小 800x500（由 tauri.conf.json 约束）。
fn fit_window_to_screen(window: &tauri::WebviewWindow) {
    let monitor = match window.current_monitor() {
        Ok(Some(m)) => m,
        _ => match window.primary_monitor() {
            Ok(Some(m)) => m,
            _ => return,
        },
    };

    let screen = monitor.size();
    let avail_w = screen.width as f64;
    let avail_h = screen.height as f64;

    let target_w = (avail_w * 0.9).min(1600.0).max(800.0);
    let target_h = (avail_h * 0.9).min(1000.0).max(500.0);

    let _ = window.set_size(PhysicalSize::new(target_w as u32, target_h as u32));

    let x = ((avail_w - target_w) / 2.0) as i32;
    let y = ((avail_h - target_h) / 2.0) as i32;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                fit_window_to_screen(&window);
            }
            Ok(())
        })
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
            get_terminal_config,
            update_terminal_config,
            // Config File
            get_config_file_path,
            open_config_file,
            reload_config,
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
