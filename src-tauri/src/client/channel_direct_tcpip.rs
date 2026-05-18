use anyhow::Result;
use bytes::Bytes;
use russh::client::Msg;
use russh::Channel;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tracing::*;
use uuid::Uuid;


use super::domain::{SshClientError,FRCEvent};
use super::common::ChannelOperation;

pub struct DirectTCPIPChannel {
    client_channel: Channel<Msg>,
    channel_id: Uuid,
    ops_rx: UnboundedReceiver<ChannelOperation>,
    events_tx: UnboundedSender<FRCEvent>,
    session_id: Uuid,
}

impl DirectTCPIPChannel {
    pub const fn new(
        client_channel: Channel<Msg>,
        channel_id: Uuid,
        ops_rx: UnboundedReceiver<ChannelOperation>,
        events_tx: UnboundedSender<FRCEvent>,
        session_id: Uuid,
    ) -> Self {
        Self {
            client_channel,
            channel_id,
            ops_rx,
            events_tx,
            session_id,
        }
    }

    pub async fn run(mut self) -> Result<(), SshClientError> {
        loop {
            tokio::select! {
                incoming_data = self.ops_rx.recv() => {
                    match incoming_data {
                        Some(ChannelOperation::Data(data)) => {
                            trace!(
                                channel = %self.channel_id,
                                session = %self.session_id,
                                data_len = data.len(),
                                "direct_tcpip: outflow to server"
                            );
                            self.client_channel.data(&*data).await?;
                        }
                        Some(ChannelOperation::Eof) => {
                            self.client_channel.eof().await?;
                        },
                        Some(ChannelOperation::Close)|None => break,
                        Some(operation) => {
                            warn!(client_channel=%self.channel_id, ?operation, session=%self.session_id, "unexpected client_channel operation");
                        }
                    }
                }
                channel_event = self.client_channel.wait() => {
                    match channel_event {
                        Some(russh::ChannelMsg::Data { data }) => {
                            let bytes: &[u8] = &data;
                            let len = bytes.len();
                            trace!(
                                channel = %self.channel_id,
                                session = %self.session_id,
                                data_len = len,
                                "direct_tcpip: inflow from server"
                            );
                            self.events_tx.send(FRCEvent::Output(
                                self.channel_id,
                                Bytes::from(bytes.to_vec()),
                            )).map_err(|_| SshClientError::MpscError)?;
                        }
                        Some(russh::ChannelMsg::Close) => {
                            self.events_tx.send(FRCEvent::Close(self.channel_id)).map_err(|_| SshClientError::MpscError)?;
                        },
                        Some(russh::ChannelMsg::Success) => {
                            self.events_tx.send(FRCEvent::Success(self.channel_id)).map_err(|_| SshClientError::MpscError)?;
                        },
                        Some(russh::ChannelMsg::Eof) => {
                            self.events_tx.send(FRCEvent::Eof(self.channel_id)).map_err(|_| SshClientError::MpscError)?;
                        }
                        None => {
                            self.events_tx.send(FRCEvent::Close(self.channel_id)).map_err(|_| SshClientError::MpscError)?;
                            break
                        },
                        Some(operation) => {
                            warn!(client_channel=%self.channel_id, ?operation, session=%self.session_id, "unexpected client_channel operation");
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

impl Drop for DirectTCPIPChannel {
    fn drop(&mut self) {
        info!(client_channel=%self.channel_id, session=%self.session_id, "Closed");
    }
}
