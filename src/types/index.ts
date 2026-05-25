export interface ServerConfig {
  id: string;
  host: string;
  port: number;
  user: string;
  enabled: boolean;
  contains: string[];
  method: "password" | "key";
  password?: string;
  allow_insecure_algos: boolean;
  inactivity_timeout?: number;
  keepalive_interval?: number;
  server_public_key?: string;
}

export interface FaoConfig {
  ai: AIConfig;
  global_blacklist: BlacklistConfig;
  server: Record<string, ServerConfig>;
  quick_command: Record<string, string>;
}

export interface AIConfig {
  url: string;
  token: string;
  model: string;
}

export interface BlacklistConfig {
  enabled: boolean;
  contains: string[];
}

export type TabStatus = "connecting" | "connected" | "disconnected" | "error";

export interface TabState {
  tabId: string;
  sessionId: string;
  serverId: string;
  serverName: string;
  host: string;
  channelId: string;
  status: TabStatus;
}

export interface ChannelOutput {
  channel_id: string;
  data: number[];
}

export interface SshEvent {
  session_id: string;
  channel_id: string | null;
  kind: SshEventKind;
}

export type SshEventKind =
  | { type: "state"; state: string }
  | { type: "error"; error: string }
  | { type: "session_dropped" }
  | { type: "host_key_unknown"; key_type: string; fingerprint: string }
  | { type: "host_key_received"; key_type: string; fingerprint: string }
  | { type: "keyboard_auth"; prompt: string }
  | { type: "channel_success" }
  | { type: "channel_close" }
  | { type: "channel_eof" }
  | { type: "channel_failure" }
  | { type: "exit_status"; exit_status: number }
  | { type: "exit_signal"; signal_name: string; core_dumped: boolean; error_message: string; lang_tag: string };

export interface ZmodemStartEvent {
  channel_id: string;
  direction: string;
}

export interface ZmodemProgress {
  channel_id: string;
  direction: string;
  filename: string;
  transferred: number;
  total: number;
}

export interface ZmodemCompleteEvent {
  channel_id: string;
  direction: string;
  success: boolean;
}

export interface ZmodemTransferState {
  channelId: string;
  direction: "upload" | "download";
  filename: string;
  transferred: number;
  total: number;
  active: boolean;
}
