use aes_gcm::Key;
use russh::client::{AuthResult, Handle, KeyboardInteractiveAuthResponse};
use russh::*;
use russh::{Preferred, client, kex};
use std::borrow::Cow;
use std::sync::Arc;
use std::net::ToSocketAddrs;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::sync::{oneshot, Mutex};
// use crate::ssh::common::ConnectionError;
use russh::keys::{PublicKey, PublicKeyBase64,PrivateKeyWithHashAlg};
use uuid::Uuid;
use std::collections::HashMap;
use bytes::Bytes;
use std::error::Error;
use russh::client::{Msg, Session};
use tokio::task::JoinHandle;
use std::io;
use std::time::Duration;
use tracing::*;
use super::common::*;
use super::key::*;
use super::channel_session::*;
use super::channel_direct_tcpip::*;
use crate::FAO_SERVICES;
use crate::service::Services;
use futures::pin_mut;




#[derive(Debug, thiserror::Error)]
pub enum ConnectionError {
    #[error("Host key mismatch")]
    HostKeyMismatch {
        received_key_type: russh::keys::Algorithm,
        received_key_base64: String,
        known_key_type: String,
        known_key_base64: String,
    },

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Key(#[from] russh::keys::Error),

    #[error(transparent)]
    Ssh(#[from] russh::Error),

    #[error("Could not resolve address")]
    Resolve,

    #[error("Internal error")]
    Internal,

    #[error("Aborted")] // 中止
    Aborted,

    #[error("Authentication failed")]
    Authentication,
}

#[derive(thiserror::Error, Debug)]
pub enum SshClientError {
    #[error("mpsc error")]
    MpscError,
    #[error("russh error: {0}")]
    Russh(#[from] russh::Error),
    #[error(transparent)]
    Other(Box<dyn Error + Send + Sync>),
}
impl SshClientError {
    pub fn other<E: Error + Send + Sync + 'static>(err: E) -> Self {
        Self::Other(Box::new(err))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FRCState {
    NotInitialized,
    Connecting,
    Connected,
    Disconnected,
}

#[derive(Debug, thiserror::Error)]
pub enum FaoClientHandlerError {
    #[error("Connection error")]
    ConnectionError(ConnectionError),

    #[error("SSH")]
    Ssh(#[from] russh::Error),

    #[error("Internal error")]
    Internal,
}
pub struct FaoClientHandler {
    pub session_id: Uuid,
    pub ssh_options: TargetSSHOptions,
    pub event_tx: UnboundedSender<ClientHandlerEvent>,
    pub services: Services,
}
#[derive(Debug)]
pub enum ClientHandlerEvent {
    HostKeyReceived(PublicKey),
    HostKeyUnknown(PublicKey, oneshot::Sender<bool>),
    ForwardedTcpIp(Channel<Msg>, ForwardedTcpIpParams),
    ForwardedStreamlocal(Channel<Msg>, ForwardedStreamlocalParams),
    ForwardedAgent(Channel<Msg>),
    X11(Channel<Msg>, String, u32),
    Disconnect,
}
impl client::Handler for FaoClientHandler{
    type Error = FaoClientHandlerError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, FaoClientHandlerError> {
        let user_password = self.services.master_password.lock().await.clone()
            .ok_or(FaoClientHandlerError::ConnectionError(ConnectionError::Authentication))?;
        let known = validate(&self.ssh_options.name, &user_password, server_public_key)
            .await
            .map_err(|e| {
                error!("server key validate error {e}");
                FaoClientHandlerError::ConnectionError(ConnectionError::Key(russh::keys::Error::InvalidSignature))
            })?;

        match known {
            KnownHostValidationResult::Valid => Ok(true),
            KnownHostValidationResult::Unknown | KnownHostValidationResult::Invalid => {
                let (tx, rx) = tokio::sync::oneshot::channel();
                self.event_tx.send(ClientHandlerEvent::HostKeyUnknown(server_public_key.clone(), tx))
                    .map_err(|_| FaoClientHandlerError::Internal)?;
                let accepted = rx.await
                    .map_err(|_| FaoClientHandlerError::Internal)?;
                Ok(accepted)
            }
        }
    }
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        connected_address: &str,
        connected_port: u32,
        originator_address: &str,
        originator_port: u32,
        __session: &mut Session,
    ) -> Result<(), Self::Error> {
        let connected_address = connected_address.to_string();
        let originator_address = originator_address.to_string();
        let _ = self.event_tx.send(ClientHandlerEvent::ForwardedTcpIp(
            channel,
            ForwardedTcpIpParams {
                connected_address,
                connected_port,
                originator_address,
                originator_port,
            },
        ));
        Ok(())
    }

    async fn server_channel_open_x11(
        &mut self,
        channel: Channel<Msg>,
        originator_address: &str,
        originator_port: u32,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let originator_address = originator_address.to_string();
        let _ = self.event_tx.send(ClientHandlerEvent::X11(
            channel,
            originator_address,
            originator_port,
        ));
        Ok(())
    }

    async fn server_channel_open_forwarded_streamlocal(
        &mut self,
        channel: Channel<Msg>,
        socket_path: &str,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let socket_path = socket_path.to_string();
        let _ = self.event_tx.send(ClientHandlerEvent::ForwardedStreamlocal(
            channel,
            ForwardedStreamlocalParams { socket_path },
        ));
        Ok(())
    }

    async fn server_channel_open_agent_forward(
        &mut self,
        channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let _ = self
            .event_tx
            .send(ClientHandlerEvent::ForwardedAgent(channel));
        Ok(())
    }
}



pub type  FRCCommandReply = oneshot::Sender<Result<(), SshClientError>>;

#[derive(Clone, Debug)]
pub enum FRCCommand {
    Connect(TargetSSHOptions),
    Channel(Uuid, ChannelOperation),
    // KeyBoardMessage(String),
    ForwardTCPIP(String, u32),
    CancelTCPIPForward(String, u32),
    StreamlocalForward(String),
    CancelStreamlocalForward(String),
    Disconnect,
}


#[derive(Debug)]
pub enum FRCEvent {
    State(FRCState),
    Output(Uuid, Bytes),
    Success(Uuid),
    ChannelFailure(Uuid),
    Eof(Uuid),
    Close(Uuid),
    Error(anyhow::Error),
    ExitStatus(Uuid, u32),
    ExitSignal {
        channel: Uuid,
        signal_name: Sig,
        core_dumped: bool,
        error_message: String,
        lang_tag: String,
    },
    ExtendedData {
        channel: Uuid,
        data: Bytes,
        ext: u32,
    },
    ConnectionError(ConnectionError),
    Done,
    KeyBoardAuth(String, oneshot::Sender<String>),
    HostKeyReceived(PublicKey),
    HostKeyUnknown(PublicKey, oneshot::Sender<bool>),
    ForwardedTcpIp(Uuid, ForwardedTcpIpParams),
    ForwardedStreamlocal(Uuid, ForwardedStreamlocalParams),
    ForwardedAgent(Uuid),
    X11(Uuid, String, u32),
}

#[derive(Debug)]
pub enum InnerEvent {
    FRCCommand(FRCCommand, Option<FRCCommandReply>),
    ClientHandlerEvent(ClientHandlerEvent),
}
pub struct FaoRemoteClient {
    pub session_id: Uuid,
    pub session: Option<Arc<tokio::sync::Mutex<Handle<FaoClientHandler>>>>,
    pub state: FRCState,
    pub tx: UnboundedSender<FRCEvent>, // event
    pub abort_rx: UnboundedReceiver<()>,
    pub inner_event_rx: UnboundedReceiver<InnerEvent>,
    pub inner_event_tx: UnboundedSender<InnerEvent>,
    pub channel_pipes: Arc<Mutex<HashMap<Uuid, UnboundedSender<ChannelOperation>>>>,
    pub pending_ops: Vec<(Uuid, ChannelOperation)>,
    pub pending_forwards: Vec<(String, u32)>,
    pub pending_streamlocal_forwards: Vec<String>,
    pub child_tasks: Vec<JoinHandle<Result<(), SshClientError>>>,
    pub services: Services,
}


pub struct FaoRemoteClientHandles {
    pub event_rx: UnboundedReceiver<FRCEvent>,
    pub command_tx: UnboundedSender<(FRCCommand, Option<FRCCommandReply>)>,
    pub abort_tx: UnboundedSender<()>,
}


impl FaoRemoteClient {
    pub fn set_state(&mut self, state: FRCState) -> Result<(), SshClientError> {
        self.state = state.clone();
        self.tx
            .send(FRCEvent::State(state))
            .map_err(|_| SshClientError::MpscError)?;
        Ok(())
    }
    pub fn set_disconnected(&mut self) {
        self.session = None;
        for (id, op) in self.pending_ops.drain(..) {
            if matches!(op, ChannelOperation::OpenShell) {
                let _ = self.tx.send(FRCEvent::Close(id));
            }
            if let ChannelOperation::OpenDirectTCPIP { .. } = op {
                let _ = self.tx.send(FRCEvent::Close(id));
            }
        }
        let _ = self.set_state(FRCState::Disconnected);
        let _ = self.tx.send(FRCEvent::Done);
    }
    pub async fn disconnect(&mut self) {
        if let Some(session) = &mut self.session {
            let _ = session
                .lock()
                .await
                .disconnect(russh::Disconnect::ByApplication, "", "")
                .await;
            self.set_disconnected();
        }
    }
    pub fn new(session_id: Uuid, services: Services) -> io::Result<FaoRemoteClientHandles>{
        let (event_tx, event_rx) = unbounded_channel();
        let (command_tx, mut command_rx) = unbounded_channel();
        let (abort_tx, abort_rx) = unbounded_channel();
        let (inner_event_tx, inner_event_rx) = unbounded_channel();
        let frc = FaoRemoteClient{
            session_id,
            session: None,
            state: FRCState::NotInitialized,
            tx: event_tx,
            abort_rx: abort_rx,
            inner_event_rx,
            inner_event_tx: inner_event_tx.clone(),
            channel_pipes: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            pending_ops: vec![],
            pending_forwards: vec![],
            pending_streamlocal_forwards: vec![],
            child_tasks: vec![],
            services,
        };

        tokio::spawn(
            {
                async move {
                    while let Some((e, response)) = command_rx.recv().await {
                        inner_event_tx.send(InnerEvent::FRCCommand(e, response))?;
                    }
                    Ok::<(), anyhow::Error>(())
                }
            }
            .instrument(Span::current()), // trace
        );

        frc.start()?;

        Ok(FaoRemoteClientHandles{
            event_rx,
            command_tx,
            abort_tx,
        })
    }


    pub async fn apply_channel_op(&mut self, channel_id: Uuid, op: ChannelOperation) -> Result<(),SshClientError> {
        if self.state != FRCState::Connected {
            self.pending_ops.push((channel_id, op));
            return Ok(());
        }
        match op {
            ChannelOperation::OpenShell => {
                self.open_shell(channel_id).await?;
            }
            ChannelOperation::OpenDirectTCPIP(params) => {
                self.open_direct_tcpip(channel_id, params).await?;
            }
            ChannelOperation::OpenDirectStreamlocal(path) => {
                self.open_direct_streamlocal(channel_id, path).await?;
            }
            op => {
                let mut channel_pipes = self.channel_pipes.lock().await;
                trace!(channel = %channel_id, op = ?op, "apply_channel_op: forwarding op to channel pipe");
                if let Some(tx) = channel_pipes.get(&channel_id) {
                    if tx.send(op).is_err() {
                        warn!(channel = %channel_id, "apply_channel_op: channel pipe closed, removing");
                        channel_pipes.remove(&channel_id);
                    }
                } else {
                    warn!(channel = %channel_id, "apply_channel_op: operation for unknown channel");
                }
            }
        }
        Ok(())

    }

    pub fn start(mut self) -> io::Result<JoinHandle<anyhow::Result<()>>> {
        let name = format!("SSH {} client commands", self.session_id);
        tokio::task::Builder::new().name(&name).spawn(
            async move {
                async {
                    loop {
                        tokio::select! {
                            Some(event) = self.inner_event_rx.recv() => {
                                trace!(event=?event, "command_loop: event received");
                                if self.handle_event(event).await? {
                                    break
                                }
                            }
                            Some(()) = self.abort_rx.recv() => {
                                trace!("Abort requested");
                                self.disconnect().await;
                                break
                            }
                        };
                    }
                    Ok::<(), anyhow::Error>(())
                }
                .await
                .map_err(|error| {
                    error!(?error, "error in command loop");
                    let err = anyhow::anyhow!("Error in command loop: {error}");
                    let _ = self.tx.send(FRCEvent::Error(error));
                    err
                })?;
                info!("Client session closed");
                Ok::<(), anyhow::Error>(())
            }
            .instrument(Span::current()),
        )
    }

    pub async fn handle_event(&mut self, event: InnerEvent) -> std::io::Result<bool>{
        match event {
            InnerEvent::FRCCommand(cmd, reply) => {
                let result = self.handle_command(cmd).await;
                let brk = matches!(result, Ok(true));
                if let Some(reply) = reply {
                    let _ = reply.send(result.map(|_| ()));
                }
                return Ok(brk);
            }
            InnerEvent::ClientHandlerEvent(client_event) => {
                trace!("Client handler event: {:?}", client_event);
                match client_event {
                    ClientHandlerEvent::Disconnect => {
                        self._on_disconnect();
                    }
                    ClientHandlerEvent::ForwardedTcpIp(channel, params) => {
                        info!("New forwarded connection: {params:?}");
                        let id = self.setup_server_initiated_channel(channel).await?;
                        let _ = self.tx.send(FRCEvent::ForwardedTcpIp(id, params));
                    }
                    ClientHandlerEvent::ForwardedStreamlocal(channel, params) => {
                        info!("New forwarded socket connection: {params:?}");
                        let id = self.setup_server_initiated_channel(channel).await?;
                        let _ = self.tx.send(FRCEvent::ForwardedStreamlocal(id, params));
                    }
                    ClientHandlerEvent::ForwardedAgent(channel) => {
                        info!("New forwarded agent connection");
                        let id = self.setup_server_initiated_channel(channel).await?;
                        let _ = self.tx.send(FRCEvent::ForwardedAgent(id));
                    }
                    ClientHandlerEvent::X11(channel, originator_address, originator_port) => {
                        info!("New X11 connection from {originator_address}:{originator_port:?}");
                        let id = self.setup_server_initiated_channel(channel).await?;
                        let _ = self
                            .tx
                            .send(FRCEvent::X11(id, originator_address, originator_port));
                    }
                    event => {
                        error!(?event, "Unhandled client handler event");
                    }
                }
            }
        }
        Ok(false)
    }


    async fn connect(&mut self, ssh_options: TargetSSHOptions) -> Result<(), ConnectionError> {
        let user_password = self.services.master_password.lock().await.clone()
            .ok_or(ConnectionError::Authentication)?;
        let address_basic = format!("{}:{}", ssh_options.host, ssh_options.port);
        let address_str = &address_basic;
        let address = match address_str
            .to_socket_addrs()
            .map_err(ConnectionError::Io)
            .and_then(|mut x| x.next().ok_or(ConnectionError::Resolve))
        {
            Ok(address) => address,
            Err(error) => {
                error!(?error, address=%address_str, "Cannot resolve target address");
                self.set_disconnected();
                return Err(error);
            }
        };

        info!(?address, username = &ssh_options.username[..], "Connecting");
        let algos = if ssh_options.allow_insecure_algos.unwrap_or(false) {
            Preferred {
                kex: Cow::Borrowed(&[
                    kex::MLKEM768X25519_SHA256,
                    kex::CURVE25519,
                    kex::CURVE25519_PRE_RFC_8731,
                    kex::ECDH_SHA2_NISTP256,
                    kex::ECDH_SHA2_NISTP384,
                    kex::ECDH_SHA2_NISTP521,
                    kex::DH_G16_SHA512,
                    kex::DH_G14_SHA256, // non-default
                    kex::DH_GEX_SHA256,
                    kex::DH_G1_SHA1, // non-default
                    kex::EXTENSION_SUPPORT_AS_CLIENT,
                    kex::EXTENSION_SUPPORT_AS_SERVER,
                    kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT,
                    kex::EXTENSION_OPENSSH_STRICT_KEX_AS_SERVER,
                ]),
                key: Cow::Borrowed(&[
                    russh::keys::Algorithm::Ed25519,
                    russh::keys::Algorithm::Ecdsa {
                        curve: russh::keys::EcdsaCurve::NistP256,
                    },
                    russh::keys::Algorithm::Ecdsa {
                        curve: russh::keys::EcdsaCurve::NistP384,
                    },
                    russh::keys::Algorithm::Ecdsa {
                        curve: russh::keys::EcdsaCurve::NistP521,
                    },
                    russh::keys::Algorithm::Rsa {
                        hash: Some(russh::keys::HashAlg::Sha256),
                    },
                    russh::keys::Algorithm::Rsa {
                        hash: Some(russh::keys::HashAlg::Sha512),
                    },
                    russh::keys::Algorithm::Rsa { hash: None },
                ]),
                cipher: Cow::Borrowed(&[
                    russh::cipher::CHACHA20_POLY1305,
                    russh::cipher::AES_256_GCM,
                    russh::cipher::AES_256_CTR,
                    russh::cipher::AES_256_CBC,
                    russh::cipher::AES_192_CTR,
                    russh::cipher::AES_192_CBC,
                    russh::cipher::AES_128_CTR,
                    russh::cipher::AES_128_CBC,
                    russh::cipher::TRIPLE_DES_CBC,
                ]),
                ..<_>::default()
            }
        } else {
            Preferred::default()
        };

        let ssh_config = self.services.config.get_server(&ssh_options.name)
        .ok_or_else(|| {
            error!("get server config error; name={},ip&port={}", ssh_options.name,&address_basic);
            ConnectionError::Ssh(russh::Error::Disconnect)
        })?;
        let mut config = russh::client::Config {
            preferred: algos,
            nodelay: true,
            inactivity_timeout: ssh_config.inactivity_timeout.map(Duration::from_secs),
            keepalive_interval: ssh_config.keepalive_interval.map(Duration::from_secs),
            ..Default::default()
        };
        if ssh_options.allow_insecure_algos.unwrap_or(false) {
            if let Ok(gex) = russh::client::GexParams::new(2048, 2048, 8192) {
                config.gex = gex;
            }
        }

        let config = Arc::new(config);

        let (event_tx, mut event_rx) = unbounded_channel();
        let handler = FaoClientHandler {
            session_id: self.session_id,
            ssh_options: ssh_options.clone(),
            event_tx,
            services: self.services.clone(),
        };

        let fut_connect = russh::client::connect(config, address, handler);
        pin_mut!(fut_connect);
        let server_config = self.services.config.get_server(&ssh_options.name)
        .ok_or_else(|| {
            error!("get server config error; name={},ip&port={}", &ssh_options.name,&address_basic);
            ConnectionError::Authentication
        })?;
        let secret = server_config.secret.ok_or_else(|| {
            error!("get server config error check auth method, this method is password but can not find secret from config; name={}, ip&port={}", &ssh_options.name, &address_basic);
            ConnectionError::Authentication
        })?;
        
        loop {
            tokio::select! {
                Some(event) = event_rx.recv() => {
                    match event {
                        ClientHandlerEvent::HostKeyReceived(key) => {
                            self.tx.send(FRCEvent::HostKeyReceived(key)).map_err(|_| ConnectionError::Internal)?;
                        }
                        ClientHandlerEvent::HostKeyUnknown(key, reply) => {
                            self.tx.send(FRCEvent::HostKeyUnknown(key, reply)).map_err(|_| ConnectionError::Internal)?;
                        }
                        _ => {}
                    }
                }
                Some(()) = self.abort_rx.recv() => {
                    info!("Abort requested");
                    self.set_disconnected();
                    return Err(ConnectionError::Aborted)
                }
                session = &mut fut_connect => {
                    let mut session = match session {
                        Ok(session) => session,
                        Err(error) => {
                            let connection_error = match error {
                                FaoClientHandlerError::ConnectionError(e) => e,
                                FaoClientHandlerError::Ssh(e) => ConnectionError::Ssh(e),
                                FaoClientHandlerError::Internal => ConnectionError::Internal,
                            };
                            error!(error=?connection_error, "Connection error");
                            return Err(connection_error);
                        }
                    };

                    let mut auth_result = false;
                    let mut auth_error_msg: Option<String> = None;
                    match ssh_options.auth {
                        TargetSSHAuth::PassWord(auth) => {
                            
                            let key = get_server_hash_key(&user_password,&secret)
                            .map_err(|e| 
                            {error!("get_server_hash_key error");
                            ConnectionError::Authentication})?;
                            let password = auth.decrypt(&key).map_err(|_| {
                                ConnectionError::Internal
                            })?;
                            let response = session
                                    .authenticate_password(
                                        ssh_options.username.clone(),
                                        password,
                                    )
                                    .await?;
                            auth_result = self._handle_auth_result(
                                &mut session,
                                ssh_options.username.clone(),
                                response
                            ).await.unwrap_or(false);
                            if auth_result {
                                debug!(username=&ssh_options.username[..], "Authenticated with password");
                            } else {
                                auth_error_msg = Some("Password authentication was rejected by the SSH target".to_string());
                            }
                        }
                        TargetSSHAuth::PrivateKeyPath(path) => {
                            let best_hash = session.best_supported_rsa_hash().await?.flatten();
                            #[allow(clippy::explicit_auto_deref)]
                            let keys = load_keys(
                                path,
                            )?;
                            let allow_insecure_algos = ssh_options.allow_insecure_algos.unwrap_or(false);
                            for key in keys {
                                let key = Arc::new(key);
                                if key.key_data().is_rsa() && best_hash.is_none() && !allow_insecure_algos {
                                    info!("Skipping ssh-rsa (SHA1) key authentication since insecure SSH algos are not allowed for this target");
                                    continue;
                                }
                                let key_str = key.public_key().to_openssh().map_err(russh::Error::from)?;
                                let mut response  = session
                                    .authenticate_publickey(
                                        ssh_options.username.clone(),
                                        PrivateKeyWithHashAlg::new(key.clone(), best_hash),
                                    )
                                    .await?;

                                auth_result = self._handle_auth_result(
                                    &mut session,
                                    ssh_options.username.clone(),
                                    response
                                ).await.unwrap_or(false);

                                if !auth_result && key.key_data().is_rsa() && best_hash.is_some() && allow_insecure_algos {
                                    // Corner case: OpenSSH advertising rsa2-sha-* through server-sig-algs, but it being
                                    // disabled via PubkeyAcceptedAlgorithms. So far the only case is our own test suite.
                                    // In this case we retry with ssh-rsa (SHA1)
                                    response = session
                                        .authenticate_publickey(
                                            ssh_options.username.clone(),
                                            PrivateKeyWithHashAlg::new(key.clone(), None),
                                        ).await?;

                                    auth_result = self._handle_auth_result(
                                        &mut session,
                                        ssh_options.username.clone(),
                                        response
                                    ).await.unwrap_or(false);
                                }

                                if auth_result {
                                    debug!(username=&ssh_options.username[..], key=%key_str, "Authenticated with key");
                                    break;
                                }
                                auth_error_msg = Some("Public key authentication was rejected by the SSH target".into());
                            }
                        }
                    }

                    if !auth_result {
                        let reason = auth_error_msg.unwrap_or_else(|| "Authentication was rejected by the SSH target".to_string());
                        error!(%reason, "FaoRerm could not authenticate with SSH target");// 这里
                        let _ = session
                            .disconnect(russh::Disconnect::ByApplication, "", "")
                            .await;
                        return Err(ConnectionError::Authentication);
                    }

                    self.session = Some(Arc::new(Mutex::new(session)));

                    info!(?address, "Connected");

                    tokio::spawn({
                        let inner_event_tx = self.inner_event_tx.clone();
                        async move {
                            while let Some(e) = event_rx.recv().await {
                                info!("{:?}", e);
                                inner_event_tx.send(InnerEvent::ClientHandlerEvent(e))?;
                            }
                            Ok::<(), anyhow::Error>(())
                        }
                    }.instrument(Span::current()));

                    return Ok(())
                }
            }
        }
    }



    async fn _handle_auth_result(
        &self,
        session: &mut Handle<FaoClientHandler>,
        username: String,
        result: AuthResult,
    ) -> Result<bool,ConnectionError> {
        info!("Handling AuthResult");
        match result {
            AuthResult::Success => {
                debug!("AuthResult is already success, no further handling needed");
                return Ok(true);
            }
            AuthResult::Failure {
                remaining_methods: methods,
                ..
            } => {
                let session_id_str = self.session_id.to_string();
                
                debug!("Initial auth failed, checking remaining methods");
                // for method in methods.iter() {
                if methods.contains(&MethodKind::KeyboardInteractive){ 
                    // if matches!(method, MethodKind::KeyboardInteractive) {
                        debug!("Found keyboard-interactive challenge");
                        let mut kb_result = session
                            .authenticate_keyboard_interactive_start(username.clone(), None)
                            .await.map_err(|e| {
                                error!("keyboard start error: {}", e);
                                ConnectionError::Authentication
                        })?;

                        loop {
                            match kb_result{
                                KeyboardInteractiveAuthResponse::InfoRequest {
                                    name,
                                    instructions,
                                    prompts 
                                } => 
                                {   
                                    let mut responses = Vec::new();
                                    for prompt in prompts.iter().clone() {
                                        let (keyboard_tx,keyboard_rx) = oneshot::channel();
                                        debug!(
                                            prompt = prompt.prompt,
                                            echo = prompt.echo,
                                            instructions = &instructions,
                                            "Prompt received for keyboard-interactive"
                                        );
                                        let msg;
                                        let prompt_msg = prompt.prompt.to_string();
                                        if !instructions.is_empty(){
                                            msg = format!("{}\n{}",&instructions,prompt_msg);
                                        }else{
                                            msg = prompt_msg;
                                        }
                                        
                                        self.tx.send(FRCEvent::KeyBoardAuth(msg, keyboard_tx))
                                        .map_err(|_| ConnectionError::Internal)?;

                                        let user_input = keyboard_rx.await.map_err(|_| ConnectionError::Internal)?;
                                        responses.push(user_input);
                                    }
                                    debug!("Responding with empty responses");
                                    kb_result = session
                                        .authenticate_keyboard_interactive_respond(responses)
                                        .await?;
                                }
                                KeyboardInteractiveAuthResponse::Success => {
                                    return Ok(true);
                                }
                                KeyboardInteractiveAuthResponse::Failure {
                                    partial_success, ..
                                } => {
                                    if partial_success {
                                        kb_result = session
                                            .authenticate_keyboard_interactive_start(username.clone(), None)
                                            .await?;
                                        continue;
                                    }
                                    return Err(ConnectionError::Authentication);
                                }
                            }
                        }

                    // }
                }
            }
        }
        warn!("keyboard auth error");
        Ok(false)
    }


    pub async fn handle_command(&mut self, cmd: FRCCommand) -> Result<bool, SshClientError> {
        match cmd {
            FRCCommand::Connect(options) => match self.connect(options).await {
                Ok(()) => {
                    self.set_state(FRCState::Connected)
                        .map_err(SshClientError::other)?;
                    let ops = self.pending_ops.drain(..).collect::<Vec<_>>();
                    for (id, op) in ops {
                        self.apply_channel_op(id, op).await?;
                    }

                    let forwards = self.pending_forwards.drain(..).collect::<Vec<_>>();
                    for (address, port) in forwards {
                        self.tcpip_forward(address, port).await?;
                    }

                    let forwards = self
                        .pending_streamlocal_forwards
                        .drain(..)
                        .collect::<Vec<_>>();
                    for socket_path in forwards {
                        self.streamlocal_forward(socket_path).await?;
                    }
                }
                Err(e) => {
                    debug!("Connect error: {}", e);
                    let _ = self.tx.send(FRCEvent::ConnectionError(e));
                    self.set_disconnected();

                    return Ok(true);
                }
            },
            FRCCommand::Channel(ch, op) => {
                self.apply_channel_op(ch, op).await?;
            }
            FRCCommand::ForwardTCPIP(address, port) => {
                self.tcpip_forward(address, port).await?;
            }
            FRCCommand::CancelTCPIPForward(address, port) => {
                self.cancel_tcpip_forward(address, port).await?;
            }
            FRCCommand::StreamlocalForward(socket_path) => {
                self.streamlocal_forward(socket_path).await?;
            }
            FRCCommand::CancelStreamlocalForward(socket_path) => {
                self.cancel_streamlocal_forward(socket_path).await?;
            }
            FRCCommand::Disconnect => {
                self.disconnect().await;
                return Ok(true);
            }
            
        }
        Ok(false)
    }

    pub async fn setup_server_initiated_channel(
        &mut self,
        channel: russh::Channel<russh::client::Msg>,
    ) -> std::io::Result<Uuid> {
        let id = Uuid::new_v4();

        let (tx, rx) = unbounded_channel();
        self.channel_pipes.lock().await.insert(id, tx);

        let session_channel = SessionChannel::new(channel, id, rx, self.tx.clone(), self.session_id);

        self.child_tasks.push(
            tokio::task::Builder::new()
                .name(&format!("SSH {} {:?} ops", self.session_id, id))
                .spawn(session_channel.run())?,
        );

        Ok(id)
    }


    pub async fn open_shell(&mut self, channel_id: Uuid) -> Result<(), SshClientError> {
        if let Some(session) = &self.session {
            let session = session.lock().await;
            let channel = session.channel_open_session().await?;

            let (tx, rx) = unbounded_channel();
            self.channel_pipes.lock().await.insert(channel_id, tx);

            let channel = SessionChannel::new(channel, channel_id, rx, self.tx.clone(), self.session_id);
            self.child_tasks.push(
                tokio::task::Builder::new()
                    .name(&format!("SSH {} {:?} ops", self.session_id, channel_id))
                    .spawn(channel.run())
                    .map_err(|e| SshClientError::Other(Box::new(e)))?,
            );
        }
        Ok(())
    }


    async fn open_direct_tcpip(
        &mut self,
        channel_id: Uuid,
        params: DirectTCPIPParams,
    ) -> Result<(), SshClientError> {
        if let Some(session) = &self.session {
            let session = session.lock().await;
            let channel = session
                .channel_open_direct_tcpip(
                    params.host_to_connect,
                    params.port_to_connect,
                    params.originator_address,
                    params.originator_port,
                )
                .await?;

            let (tx, rx) = unbounded_channel();
            self.channel_pipes.lock().await.insert(channel_id, tx);

            let channel =
                DirectTCPIPChannel::new(channel, channel_id, rx, self.tx.clone(), self.session_id);
            self.child_tasks.push(
                tokio::task::Builder::new()
                    .name(&format!("SSH {} {:?} ops", self.session_id, channel_id))
                    .spawn(channel.run())
                    .map_err(|e| SshClientError::Other(Box::new(e)))?,
            );
        }
        Ok(())
    }

    async fn open_direct_streamlocal(
        &mut self,
        channel_id: Uuid,
        path: String,
    ) -> Result<(), SshClientError> {
        if let Some(session) = &self.session {
            let session = session.lock().await;
            let channel = session.channel_open_direct_streamlocal(path).await?;

            let (tx, rx) = unbounded_channel();
            self.channel_pipes.lock().await.insert(channel_id, tx);

            let channel =
                DirectTCPIPChannel::new(channel, channel_id, rx, self.tx.clone(), self.session_id);
            self.child_tasks.push(
                tokio::task::Builder::new()
                    .name(&format!("SSH {} {:?} ops", self.session_id, channel_id))
                    .spawn(channel.run())
                    .map_err(|e| SshClientError::Other(Box::new(e)))?,
            );
        }
        Ok(())
    }

    pub async fn tcpip_forward(&mut self, address: String, port: u32) -> Result<(), SshClientError> {
        if let Some(session) = &self.session {
            let session = session.lock().await;
            session.tcpip_forward(address, port).await?;
        } else {
            self.pending_forwards.push((address, port));
        }
        Ok(())
    }

    pub async fn cancel_tcpip_forward(
        &mut self,
        address: String,
        port: u32,
    ) -> Result<(), SshClientError> {
        if let Some(session) = &self.session {
            let session = session.lock().await;
            session.cancel_tcpip_forward(address, port).await?;
        } else {
            self.pending_forwards
                .retain(|x| x.0 != address || x.1 != port);
        }
        Ok(())
    }

    pub async fn streamlocal_forward(&mut self, socket_path: String) -> Result<(), SshClientError> {
        if let Some(session) = &self.session {
            let session = session.lock().await;
            session.streamlocal_forward(socket_path).await?;
        } else {
            self.pending_streamlocal_forwards.push(socket_path);
        }
        Ok(())
    }

    pub async fn cancel_streamlocal_forward(
        &mut self,
        socket_path: String,
    ) -> Result<(), SshClientError> {
        if let Some(session) = &self.session {
            let session = session.lock().await;
            session.cancel_streamlocal_forward(socket_path).await?;
        } else {
            self.pending_streamlocal_forwards
                .retain(|x| x != &socket_path);
        }
        Ok(())
    }

    pub fn _on_disconnect(&mut self) {
        self.set_disconnected();
    }

}
// ======================================================================================================================================================


//     pub async fn auth<A: ToSocketAddrs, P: Into<String>>(
//         addrs: A,
//         user: String,
//         passwd: P,
//         s: &Sender<Vec<u8>>,
//         r: &mut Receiver<Vec<u8>>,
//     ) -> Result<Self, anyhow::Error> {
//         let config = build_ssh_config();
//         let shell = FaoClientHandler {};
//         let mut session = client::connect(config, addrs, shell).await?;

//         // 密码认证
//         let auth_ok = session.authenticate_password(&user, passwd).await?;
//         // 默认直接去交互认证
//         println!("{:?}", auth_ok);
//         let auth_res = multi_keyboard_auth(auth_ok, &mut session, user, s, r).await?;
//         debug!("Password auth result: {:?}", auth_res);
//         Ok(Self { inner: session })
//     }

//     pub async fn call(
//         &self,
//         s: tokio::sync::mpsc::Sender<Vec<u8>>,
//         mut r: tokio::sync::mpsc::Receiver<Vec<u8>>,
//     ) -> Result<u32> {
//         let mut channel = self.inner.channel_open_session().await?;
//         // 请求 PTY，使用固定尺寸或从配置获取
//         let (w, h) = (80, 50); // 默认终端大小
//         channel
//             .request_pty(false, "xterm-256color", w, h, 0, 0, &[])
//             .await?;
//         channel.request_shell(true).await?;
//         let mut code = 0;
//         let mut stdin_closed = false;
//         loop {
//             tokio::select! {
//                 // 从 WebSocket 接收用户输入
//                 received = r.recv() => {
//                     match received {
//                         None => {
//                             stdin_closed = true;
//                             channel.eof().await?;
//                         }

//                         Some(data) => {
//                             if data.is_empty() {
//                                     continue; // 忽略空包，防止崩溃
//                             }
//                             match data[0] {
//                                 0x01 => {
//                                     // 只发送 0x01 之后的内容给 SSH
//                                     if let Err(e) = channel.data(&data[1..]).await {
//                                         log::error!("Failed to send stdin to SSH: {:?}", e);
//                                         break;
//                                     }
//                                 }
//                                 // 0x02: 调整窗口大小 (Resize)
//                                 0x02 => {
//                                     // 期待格式: [0x02, col_high, col_low, row_high, row_low]
//                                     if data.len() >= 5 {
//                                         let cols = u16::from_be_bytes([data[1], data[2]]) as u32;
//                                         let rows = u16::from_be_bytes([data[3], data[4]]) as u32;

//                                         if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
//                                             log::error!("Failed to resize SSH window: {:?}", e);
//                                         }
//                                         log::debug!("Window resized to: {}x{}", cols, rows);
//                                     }
//                                     else{
//                                         log::error!("Data len less five");
//                                     }
//                                 }
//                                 _ => {
//                                     log::warn!("Received unknown command byte: {:02X}", data[0]);
//                                 }
//                             }
//                         }
//                     }
//                 }
//                 // 从 SSH 服务器接收输出
//                 Some(msg) = channel.wait() => {
//                     match msg {
//                         ChannelMsg::Data { ref data } => {
//                             if s.send(data.to_vec()).await.is_err() {
//                                 log::warn!("WebSocket channel closed");
//                                 break;
//                             }
//                         }
//                         ChannelMsg::ExitStatus { exit_status } => {
//                             code = exit_status;
//                             if !stdin_closed {
//                                 channel.eof().await?;
//                             }
//                             break;
//                         }
//                         _ => {}
//                     }
//                 }
//             }
//         }
//         Ok(code)
//     }

//     pub async fn close(&self) -> Result<()> {
//         self.inner
//             .disconnect(Disconnect::ByApplication, "", "English")
//             .await?;
//         Ok(())
//     }
// }
// const CONNECTION_TIMEOUT: Duration = Duration::from_secs(5);
// const AUTH_TIMEOUT: Duration = Duration::from_secs(3);

// pub async fn test_connect(
//     user: String,
//     ip: String,
//     port: String,
//     password: String,
// ) -> Result<String, actix_web::Error> {
//     let ip_port = format!("{}:{}", ip, port);
//     let config = client::Config {
//         inactivity_timeout: Some(Duration::from_secs(5)),
//         ..<_>::default()
//     };
//     let config = Arc::new(config);
//     let mut connect: russh::client::Handle<FaoClient> = timeout(
//         CONNECTION_TIMEOUT,
//         russh::client::connect(config, ip_port.clone(), FaoClient {}),
//     )
//     .await
//     .map_err(|_| ErrorRequestTimeout("Connection timeout"))? // 处理 timeout 错误
//     .map_err(|e| ErrorInternalServerError(e))?; // 处理 russh 错误

//     let password = crate::utils::symmetry::passwd_decrypt(password.clone())
//         .map_err(|e| ErrorInternalServerError(format!("Password decryption failed: {}", e)))?;

//     timeout(
//         AUTH_TIMEOUT,
//         connect.authenticate_password(user.clone(), password.clone()),
//     )
//     .await
//     .map_err(|_| ErrorGatewayTimeout("Auth timeout"))?
//     .map_err(|e| ErrorInternalServerError(format!("Authentication failed: {}", e)))?;

//     connect
//         .disconnect(russh::Disconnect::ByApplication, "", "en")
//         .await
//         .ok();
//     Ok::<String, actix_web::Error>(format!("connected to server {} successfully", ip_port))
// }

// pub fn build_ssh_config() -> Arc<client::Config> {
//     let config = client::Config {
//         keepalive_max: 3,
//         keepalive_interval: Some(Duration::from_secs(30)),
//         inactivity_timeout: Some(Duration::from_secs(1200)),
//         // allow_insecure_algos
//         preferred: Preferred {
//             kex: Cow::Borrowed(&[
//                 kex::MLKEM768X25519_SHA256,
//                 kex::CURVE25519,
//                 kex::CURVE25519_PRE_RFC_8731,
//                 kex::ECDH_SHA2_NISTP256,
//                 kex::ECDH_SHA2_NISTP384,
//                 kex::ECDH_SHA2_NISTP521,
//                 kex::DH_G16_SHA512,
//                 kex::DH_G14_SHA256, // non-default
//                 kex::DH_GEX_SHA256,
//                 kex::DH_G1_SHA1, // non-default
//                 kex::EXTENSION_SUPPORT_AS_CLIENT,
//                 kex::EXTENSION_SUPPORT_AS_SERVER,
//                 kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT,
//                 kex::EXTENSION_OPENSSH_STRICT_KEX_AS_SERVER,
//             ]),
//             key: Cow::Borrowed(&[
//                 russh::keys::Algorithm::Ed25519,
//                 russh::keys::Algorithm::Ecdsa {
//                     curve: russh::keys::EcdsaCurve::NistP256,
//                 },
//                 russh::keys::Algorithm::Ecdsa {
//                     curve: russh::keys::EcdsaCurve::NistP384,
//                 },
//                 russh::keys::Algorithm::Ecdsa {
//                     curve: russh::keys::EcdsaCurve::NistP521,
//                 },
//                 russh::keys::Algorithm::Rsa {
//                     hash: Some(russh::keys::HashAlg::Sha256),
//                 },
//                 russh::keys::Algorithm::Rsa {
//                     hash: Some(russh::keys::HashAlg::Sha512),
//                 },
//                 russh::keys::Algorithm::Rsa { hash: None },
//             ]),
//             cipher: Cow::Borrowed(&[
//                 russh::cipher::CHACHA20_POLY1305,
//                 russh::cipher::AES_256_GCM,
//                 russh::cipher::AES_256_CTR,
//                 russh::cipher::AES_256_CBC,
//                 russh::cipher::AES_192_CTR,
//                 russh::cipher::AES_192_CBC,
//                 russh::cipher::AES_128_CTR,
//                 russh::cipher::AES_128_CBC,
//                 russh::cipher::TRIPLE_DES_CBC,
//             ]),
//             ..<_>::default()
//         },
//         ..<_>::default()
//     };

//     Arc::new(config)
// }

// pub async fn multi_keyboard_auth(
//     auth: AuthResult,
//     session: &mut Handle<FaoClient>,
//     user: String,
//     s: &Sender<Vec<u8>>,       // 接收通道
//     r: &mut Receiver<Vec<u8>>, // 接收通道
// ) -> Result<bool, anyhow::Error> {
//     match auth {
//         AuthResult::Success => {
//             return Ok(true);
//         }
//         AuthResult::Failure {
//             remaining_methods,
//             partial_success,
//         } => {
//             if remaining_methods.contains(&MethodKind::KeyboardInteractive) {
//                 let mut kb_result = session
//                     .authenticate_keyboard_interactive_start(user.clone(), None)
//                     .await?;

//                 loop {
//                     match kb_result {
//                         KeyboardInteractiveAuthResponse::InfoRequest {
//                             name,
//                             instructions,
//                             prompts,
//                         } => {
//                             // 如果有指令信息，先打印出来
//                             if !instructions.is_empty() {
//                                 let inst_msg =
//                                     format!("{}\r\n", instructions.replace('\n', "\r\n"));
//                                 s.send(inst_msg.into_bytes()).await?;
//                             }

//                             let mut responses = Vec::new();

//                             for prompt in prompts.iter() {
//                                 // 1. 将提示语发给前端 xterm.js 显示
//                                 let prompt_msg = prompt.prompt.replace('\n', "\r\n");
//                                 s.send(prompt_msg.into_bytes()).await?;

//                                 // 2. 模拟一个微型的 LineProcessor 来收集用户输入
//                                 let mut input_buffer = String::new();

//                                 loop {
//                                     if let Some(data) = r.recv().await {
//                                         if data.is_empty() {
//                                             continue;
//                                         }

//                                         // 按照你的协议，0x01 代表标准输入
//                                         if data[0] == 0x01 {
//                                             let text = String::from_utf8_lossy(&data[1..]);

//                                             for c in text.chars() {
//                                                 match c {
//                                                     '\r' | '\n' => {
//                                                         // 收到回车，结束当前 Prompt 的输入
//                                                         s.send(b"\r\n".to_vec()).await?; // 换行回显
//                                                         break;
//                                                     }
//                                                     '\u{7f}' | '\u{8}' => {
//                                                         // 处理退格
//                                                         if input_buffer.pop().is_some() {
//                                                             // 向前端发送退格指令 (退格, 空格, 退格) 抹除屏幕上的字符
//                                                             s.send(b"\x08 \x08".to_vec()).await?;
//                                                         }
//                                                     }
//                                                     c if !c.is_control() => {
//                                                         input_buffer.push(c);
//                                                         // 如果该 Prompt 允许回显（比如不是密码），则回显给前端
//                                                         if prompt.echo {
//                                                             s.send(c.to_string().into_bytes())
//                                                                 .await?;
//                                                         }
//                                                     }
//                                                     _ => {}
//                                                 }
//                                             }

//                                             // 如果检测到回车，跳出 recv loop，进入下一个 prompt
//                                             if text.contains('\r') || text.contains('\n') {
//                                                 break;
//                                             }
//                                         }
//                                     } else {
//                                         return Err(anyhow!(
//                                             "WebSocket closed during authentication"
//                                         ));
//                                     }
//                                 }
//                                 // 将收集到的一行输入作为响应推入
//                                 responses.push(input_buffer.trim().to_string());
//                             }

//                             // 3. 把用户输入的所有信息交回给 SSH 服务器验证
//                             kb_result = session
//                                 .authenticate_keyboard_interactive_respond(responses)
//                                 .await?;
//                         }
//                         KeyboardInteractiveAuthResponse::Success => {
//                             return Ok(true);
//                         }
//                         KeyboardInteractiveAuthResponse::Failure {
//                             partial_success, ..
//                         } => {
//                             if partial_success {
//                                 kb_result = session
//                                     .authenticate_keyboard_interactive_start(user.clone(), None)
//                                     .await?;
//                                 continue;
//                             }
//                             return Err(anyhow!(
//                                 "Keyboard-interactive authentication failed permanently"
//                             ));
//                         }
//                     }
//                 }
//             }
//         }
//     }
//     Err(anyhow!(
//         "multi keyboard auth failed or no supported methods"
//     ))
// }
