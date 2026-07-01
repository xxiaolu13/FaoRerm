use std::sync::Arc;
use anyhow::Result;
use tokio::sync::Mutex;
use serde::{Deserialize,Serialize};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::oneshot;
use uuid::Uuid;
use std::collections::{HashMap,BTreeMap,HashSet};
use bytes::Bytes;
use crate::client::domain::{FRCEvent, FaoRemoteClientHandles, FRCCommand, FRCCommandReply};

use std::fs::{self, File};

use std::path::{Path, PathBuf};
use directories::ProjectDirs;
use parking_lot::RwLock;


#[derive(thiserror::Error, Debug)]
pub enum ConfigError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("TOML 解析错误: {0}")]
    Parse(#[from] toml::de::Error),
    #[error("TOML 序列化错误: {0}")]
    Serialize(#[from] toml::ser::Error),
    #[error("服务器 '{0}' 未找到")]
    ServerNotFound(String),
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct FaoConfig {
    #[serde(default)]
    pub ai: AIConfig,

    #[serde(rename = "global_blacklist")]
    pub blacklist: BlacklistConfig,
    #[serde(default)]
    pub server: BTreeMap<String, ServerConfig>,
    #[serde(default)]
    pub quick_command: BTreeMap<String, String>,
    #[serde(default)]
    pub appearance: AppearanceConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalConfig {
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,
    #[serde(default = "default_cursor_blink")]
    pub cursor_blink: bool,
    #[serde(default = "default_scrollback")]
    pub scrollback: u32,
    #[serde(default = "default_copy_on_select")]
    pub copy_on_select: bool,
    #[serde(default = "default_line_height")]
    pub line_height: f64,
    #[serde(default = "default_letter_spacing")]
    pub letter_spacing: f64,
}

fn default_font_size() -> u32 { 14 }
fn default_font_family() -> String {
    "\"Cascadia Code\", \"JetBrains Mono\", \"Fira Code\", \"SF Mono\", Consolas, monospace".to_string()
}
fn default_cursor_style() -> String { "bar".to_string() }
fn default_cursor_blink() -> bool { true }
fn default_scrollback() -> u32 { 10000 }
fn default_copy_on_select() -> bool { false }
fn default_line_height() -> f64 { 1.1 }
fn default_letter_spacing() -> f64 { 0.0 }

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            font_size: default_font_size(),
            font_family: default_font_family(),
            cursor_style: default_cursor_style(),
            cursor_blink: default_cursor_blink(),
            scrollback: default_scrollback(),
            copy_on_select: default_copy_on_select(),
            line_height: default_line_height(),
            letter_spacing: default_letter_spacing(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppearanceConfig {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub terminal: TerminalConfig,
}

fn default_theme() -> String {
    "system".to_string()
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            terminal: TerminalConfig::default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AIConfig {
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderConfig>,
    #[serde(default)]
    pub default_provider: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderConfig {
    pub provider_type: String,
    pub url: String,
    pub token: String,
    pub model: String,
    #[serde(default = "default_max_turns")]
    pub max_turns: u32,
    #[serde(default)]
    pub thinking_budget: Option<u32>,
    #[serde(default)]
    pub extra_system_prompt: Option<String>,
}

fn default_max_turns() -> u32 {
    10
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            provider_type: "openai".to_string(),
            url: String::new(),
            token: String::new(),
            model: "gpt-4o".to_string(),
            max_turns: 10,
            thinking_budget: None,
            extra_system_prompt: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct BlacklistConfig {
    pub enabled: bool,
    #[serde(default)]
    pub contains: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "method", rename_all = "lowercase")]
pub enum AuthMethod {
    Password,
    Key,
}
impl Default for AuthMethod {
    fn default() -> Self {
        AuthMethod::Password
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ServerConfig {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default, rename = "black_list_switch")]
    pub enabled: bool,
    #[serde(default)]
    pub contains: Vec<String>,
    #[serde(flatten)]
    pub auth: AuthMethod,
    // #[serde(default)]
    // pub combined_hex: String,
    #[serde(rename = "password")]
    pub secret: Option<String>, // 加密后的密码
    #[serde(default)]
    pub allow_insecure_algos: bool,
    pub inactivity_timeout: Option<u64>,
    pub keepalive_interval: Option<u64>,
    pub server_public_key: Option<String>, // server的公钥 需要chacha加密，用于非对称攻击 盐+密文
}

// CRUD
#[derive(Debug, Clone)]
pub struct ConfigManager {
    pub data: Arc<RwLock<FaoConfig>>,
    pub path: PathBuf,
}

impl ConfigManager {
    pub fn load_or_default<P: AsRef<Path>>(path: P) -> Result<Self, ConfigError> {
        let path = path.as_ref().to_path_buf();
        
        let config = if path.exists() {
            let content = fs::read_to_string(&path)?;
            toml::from_str(&content)?
        } else {
            let default_config = FaoConfig::default();
            // 第一次生成默认配置需要保存到磁盘
            Self::save_to_path(&path, &default_config)?;
            default_config
        };

        Ok(Self {
            data: Arc::new(RwLock::new(config)),
            path,
        })
    }


    fn save_to_path(path: &Path, config: &FaoConfig) -> Result<(), ConfigError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        
        let content = toml::to_string_pretty(config)?;
        
        let tmp_path = path.with_extension("toml.tmp");
        
        fs::write(&tmp_path, content)?;
        fs::rename(tmp_path, path)?;
        
        Ok(())
    }

    /// 手动将当前内存状态刷入磁盘
    pub fn save(&self) -> Result<(), ConfigError> {
        let config_guard = self.data.read();
        Self::save_to_path(&self.path, &*config_guard)
    }

    /// 从磁盘重新加载配置到内存（用户外部编辑配置文件后调用）
    pub fn reload(&self) -> Result<(), ConfigError> {
        let config = if self.path.exists() {
            let content = fs::read_to_string(&self.path)?;
            toml::from_str(&content)?
        } else {
            FaoConfig::default()
        };
        *self.data.write() = config;
        Ok(())
    }


    pub fn get_snapshot(&self) -> FaoConfig {
        self.data.read().clone()
    }

    pub fn update_ai(&self, ai_config: AIConfig) -> Result<(), ConfigError> {
        self.data.write().ai = ai_config;
        self.save()
    }

    pub fn get_ai_providers(&self) -> BTreeMap<String, ProviderConfig> {
        self.data.read().ai.providers.clone()
    }

    pub fn upsert_ai_provider(&self, name: &str, config: ProviderConfig) -> Result<(), ConfigError> {
        self.data.write().ai.providers.insert(name.to_string(), config);
        self.save()
    }

    pub fn delete_ai_provider(&self, name: &str) -> Result<(), ConfigError> {
        let mut guard = self.data.write();
        if guard.ai.providers.remove(name).is_none() {
            drop(guard);
            return Err(ConfigError::ServerNotFound(name.to_string()));
        }
        if guard.ai.default_provider == name {
            guard.ai.default_provider = String::new();
        }
        drop(guard);
        self.save()
    }

    pub fn set_default_provider(&self, name: &str) -> Result<(), ConfigError> {
        let guard = self.data.read();
        if !guard.ai.providers.contains_key(name) {
            drop(guard);
            return Err(ConfigError::ServerNotFound(name.to_string()));
        }
        drop(guard);
        self.data.write().ai.default_provider = name.to_string();
        self.save()
    }

    pub fn upsert_server(&self, key: &str, server: ServerConfig) -> Result<(), ConfigError> {
        self.data.write().server.insert(key.to_string(), server);
        self.save()
    }

    pub fn update_server_public_key(&self, key: &str, encrypted_key: String) -> Result<(), ConfigError> {
        let mut guard = self.data.write();
        if let Some(server) = guard.server.get_mut(key) {
            server.server_public_key = Some(encrypted_key);
            drop(guard);
            self.save()
        } else {
            drop(guard);
            Err(ConfigError::ServerNotFound(key.to_string()))
        }
    }


    pub fn get_server(&self, key: &str) -> Option<ServerConfig> {
        self.data.read().server.get(key).cloned()
    }

    pub fn delete_server(&self, key: &str) -> Result<(), ConfigError> {
        let mut guard = self.data.write();
        if guard.server.remove(key).is_none() {
            return Err(ConfigError::ServerNotFound(key.to_string()));
        }

        drop(guard);
        self.save()
    }
    pub fn insert_black_list(&self, black_list_contain: &str) -> Result<(), ConfigError> {
        self.data.write().blacklist.contains.insert(0, black_list_contain.into());
        self.save()
    }
    
    pub fn get_black_list(&self) -> Result<BlacklistConfig, ConfigError> {
        Ok(self.data.read().blacklist.clone())
    }
    pub fn upsert_quick_command(&self, des: &str, command: &str) -> Result<(), ConfigError> {
        self.data.write().quick_command.insert(des.to_string(),command.to_string());
        self.save()
    }

    pub fn delete_quick_command(&self, des: &str) -> Result<(), ConfigError> {
        let mut guard = self.data.write();
        if guard.quick_command.remove(des).is_none() {
            return Err(ConfigError::ServerNotFound(des.to_string()));
        }
        drop(guard);
        self.save()
    }

    pub fn update_appearance(&self, theme: &str) -> Result<(), ConfigError> {
        self.data.write().appearance.theme = theme.to_string();
        self.save()
    }

    pub fn update_terminal_config(&self, cfg: TerminalConfig) -> Result<(), ConfigError> {
        self.data.write().appearance.terminal = cfg;
        self.save()
    }

}


// ========================= Session State =========================

pub struct SessionAuthState {
    pub pending_host_key: Option<oneshot::Sender<bool>>,
    pub pending_keyboard_auth: Option<oneshot::Sender<String>>,
}

pub struct SessionHandles {
    pub command_tx: UnboundedSender<(FRCCommand, Option<FRCCommandReply>)>,
    pub abort_tx: UnboundedSender<()>,
    pub channels: Arc<Mutex<HashSet<String>>>,
}

use crate::zmodem::ZmodemSession;
use cersei_tools::permissions::PermissionDecision;

#[derive(Clone)]
pub struct ChannelCopilot {
    pub active_provider: String,
    pub conversation: Vec<cersei::prelude::Message>,
    pub model: String,
}

#[derive(Clone)]
pub struct Services {
    pub handles: Arc<Mutex<HashMap<String, SessionHandles>>>,
    pub auth_states: Arc<Mutex<HashMap<String, Arc<Mutex<SessionAuthState>>>>>,
    pub config: ConfigManager,
    pub master_password: Arc<Mutex<Option<String>>>,
    pub zmodem_sessions: Arc<Mutex<HashMap<String, ZmodemSession>>>,
    pub copilots: Arc<Mutex<HashMap<String, ChannelCopilot>>>,
    pub pending_confirms: Arc<dashmap::DashMap<Uuid, oneshot::Sender<PermissionDecision>>>,
    pub copilot_cancel: Arc<dashmap::DashMap<String, tokio_util::sync::CancellationToken>>,
    pub skills_dir: PathBuf,
}

impl Services {
    pub fn new() -> Result<Self> {
        let proj_dirs = ProjectDirs::from("", "", "FaoRerm")
            .ok_or(ConfigError::ServerNotFound("path not found".to_string()))?;
        let config_path = proj_dirs.config_dir().join("faoconfig.toml");
        let cm = ConfigManager::load_or_default(config_path)?;

        let skills_dir = proj_dirs.config_dir().join("skills");
        crate::copilot::skills::ensure_skills_dir(&skills_dir)?;

        Ok(Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
            auth_states: Arc::new(Mutex::new(HashMap::new())),
            config: cm.clone(),
            master_password: Arc::new(Mutex::new(None)),
            zmodem_sessions: Arc::new(Mutex::new(HashMap::new())),
            copilots: Arc::new(Mutex::new(HashMap::new())),
            pending_confirms: Arc::new(dashmap::DashMap::new()),
            copilot_cancel: Arc::new(dashmap::DashMap::new()),
            skills_dir,
        })
    }
}
