use std::fmt::{Display, Formatter};
use std::string::FromUtf8Error;
use bytes::Bytes;
use russh::{ChannelId, Pty, Sig};
use serde::{Deserialize, Serialize};
use super::key::*;
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum VaultError {
    #[error("keyring error")]
    SystemError(),
    #[error("serde error: {0}")]
    SerializationError(#[from] serde_json::Error),
    #[error("method error: {0}")]
    ChangeError(#[from] FromUtf8Error),
    #[error("change to utf8 error: {0}")]
    MethodError(#[from] anyhow::Error),
    #[error("vault error")]
    NotFound,
}


#[derive(Debug,Clone,Deserialize, Serialize)]
pub enum TargetSSHAuth{
    PassWord(EncryptedPassword),
    PrivateKeyPath(String)
}


#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TargetSSHOptions {
    pub name: String,
    pub host_id: Uuid,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub allow_insecure_algos: Option<bool>,
    pub auth: TargetSSHAuth,
}
// new
impl TargetSSHOptions{
    pub fn new(name: &str,host: &str,port: u16,username: &str,auth: TargetSSHAuth,allow_insecure_algos: Option<bool>) -> Self{
        let host_id = Uuid::new_v4();
        Self { name: name.to_string(), host_id, host:host.to_string(), port, username: username.to_string(), allow_insecure_algos, auth }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SshCredential {
    pub auth: TargetSSHAuth,
    pub server_public_key: String, // key.algorithm.as_str() key.public_key_base64();
}
// impl SshCredential{
//     pub fn new(auth: TargetSSHAuth,server_public_key: String) -> Self {
//         let sc = SshCredential{ auth,server_public_key};
//         sc
//     }
//     pub fn insert(&self,host_id: &str,name: &str) -> Result<(),VaultError>{
//         let entry = Entry::new(name ,host_id)
//         .map_err(|e|VaultError::SystemError())?;
//         let message = serde_json::to_string(&self)
//         .map_err(|e|VaultError::SerializationError(e))?;
//         let byte_u8 = message.as_bytes();
//         entry.set_secret(byte_u8)
//         .map_err(|e|VaultError::SystemError())?;
//         Ok(())
//     }

//     pub fn get(host_id: &str,name: &str) -> Result<Self,VaultError>{
//         let entry = Entry::new(name ,host_id)
//         .map_err(|e|VaultError::SystemError())?;
//         let message = entry.get_secret()
//         .map_err(|_|VaultError::NotFound)?;
//         let message_string = String::from_utf8(message)
//         .map_err(|e|VaultError::ChangeError(e))?;
//         let msg = serde_json::from_str(&message_string)
//         .map_err(|e|VaultError::SerializationError(e))?;
//         Ok(msg)
//     }
// }


#[derive(Clone, Debug)]
pub struct PtyRequest {
    pub term: String,
    pub col_width: u32,
    pub row_height: u32,
    pub pix_width: u32,
    pub pix_height: u32,
    pub modes: Vec<(Pty, u32)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Hash, Eq)]
pub struct ServerChannelId(pub ChannelId);

impl Display for ServerChannelId {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Clone, Debug)]
pub struct DirectTCPIPParams {
    pub host_to_connect: String,
    pub port_to_connect: u32,
    pub originator_address: String,
    pub originator_port: u32,
}

#[derive(Clone, Debug)]
pub struct ForwardedTcpIpParams {
    pub connected_address: String,
    pub connected_port: u32,
    pub originator_address: String,
    pub originator_port: u32,
}

#[derive(Clone, Debug)]
pub struct ForwardedStreamlocalParams {
    pub socket_path: String,
}

#[derive(Clone, Debug)]
pub struct X11Request {
    pub single_conection: bool,
    pub x11_auth_protocol: String,
    pub x11_auth_cookie: String,
    pub x11_screen_number: u32,
}

#[derive(Clone, Debug)]
pub enum ChannelOperation {
    OpenShell,
    OpenDirectTCPIP(DirectTCPIPParams), // IP端口转发
    OpenDirectStreamlocal(String),
    OpenX11(String, u32),
    RequestPty(PtyRequest), // 请求pty
    ResizePty(PtyRequest),  // 窗口大小
    RequestShell,
    RequestEnv(String, String),
    RequestExec(String),
    RequestX11(X11Request),
    AgentForward,             //代理转发
    RequestSubsystem(String), // sftp
    Data(Bytes),
    ExtendedData { data: Bytes, ext: u32 },
    Close,
    Eof,
    Signal(Sig),
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum SshRecordingMetadata {
    #[serde(rename = "ssh-shell")]
    Shell { channel: usize },
    #[serde(rename = "ssh-exec")]
    Exec { channel: usize },
    #[serde(rename = "ssh-direct-tcpip")]
    DirectTcpIp { host: String, port: u16 },
    #[serde(rename = "ssh-direct-socket")]
    DirectSocket { path: String },
    #[serde(rename = "ssh-forwarded-tcpip")]
    ForwardedTcpIp { host: String, port: u16 },
    #[serde(rename = "ssh-forwarded-socket")]
    ForwardedSocket { path: String },
}
