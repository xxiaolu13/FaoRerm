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
    pub ai: AIConfig,

    #[serde(rename = "global_blacklist")]
    pub blacklist: BlacklistConfig,
    #[serde(default)]
    pub server: BTreeMap<String, ServerConfig>,
    #[serde(default)]
    pub quick_command: BTreeMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AIConfig {
    pub url: String,
    pub token: String,
    pub model: String,
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


    pub fn get_snapshot(&self) -> FaoConfig {
        self.data.read().clone()
    }

    pub fn update_ai(&self, ai_config: AIConfig) -> Result<(), ConfigError> {
        self.data.write().ai = ai_config;
        self.save()
    }

    pub fn upsert_server(&self, key: &str, server: ServerConfig) -> Result<(), ConfigError> {
        self.data.write().server.insert(key.to_string(), server);
        self.save()
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

// 暂时通过 static 代替
pub struct SessionRecordings{// 这里面Uuid都是session的id
    tx: Arc<tokio::sync::Mutex<HashMap<Uuid,UnboundedSender<FRCEvent>>>>,
    data: Arc<tokio::sync::Mutex<HashMap<Uuid,Bytes>>>,
}
impl SessionRecordings{
    pub fn new() -> Self{
        Self {
            tx: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            data: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }
}
#[derive(Clone)]
pub struct Services {
    pub handles: Arc<Mutex<HashMap<String, SessionHandles>>>,
    pub auth_states: Arc<Mutex<HashMap<String, Arc<Mutex<SessionAuthState>>>>>,
    pub recordings: Arc<Mutex<SessionRecordings>>,
    pub config: ConfigManager,
    pub master_password: Arc<Mutex<Option<String>>>,
}

impl Services {
    pub fn new() -> Result<Self> {

        let recordings = SessionRecordings::new();
        let recordings = Arc::new(Mutex::new(recordings));


        let proj_dirs = ProjectDirs::from("", "", "FaoRerm")
            .ok_or(ConfigError::ServerNotFound("path not found".to_string()))?;
        let config_path = proj_dirs.config_dir().join("faoconfig.toml");
        let cm = ConfigManager::load_or_default(config_path)?;

        Ok(Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
            auth_states: Arc::new(Mutex::new(HashMap::new())),
            recordings,
            config: cm.clone(),
            master_password: Arc::new(Mutex::new(None)),
        })
    }
    
}