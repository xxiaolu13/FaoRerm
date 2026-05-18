// Maps to Rust's ServerConfig
export interface ServerConfig {
  id: string;
  host: string;
  port: number;
  user: string;
  enabled: boolean; // black_list_switch
  contains: string[];
  method: "password" | "key";
  secret?: string;
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

// Tab state
export type TabStatus = "connecting" | "connected" | "disconnected" | "error";

export interface TabState {
  sessionId: string;
  serverId: string;
  serverName: string;
  host: string;
  channelId: string;
  status: TabStatus;
}

// Event payloads from Rust backend (ssh:host-key-unknown)
export interface HostKeyUnknownEvent {
  session_id: string;
  key_type: string;
  fingerprint: string;
}

// ssh:keyboard-auth
export interface KeyBoardAuthEvent {
  session_id: string;
  prompt: string;
}

// ssh:output
export interface SshOutputEvent {
  session_id: string;
  channel_id: string;
  data: number[];
}

// ssh:state
export interface SshStateEvent {
  session_id: string;
  state: string;
}

// ssh:error
export interface SshErrorEvent {
  session_id: string;
  error: string;
}

// ssh:channel-event
export interface SshChannelEvent {
  session_id: string;
  channel_id: string;
  event_type: string;
}

// ssh:exit-status
export interface SshExitStatusEvent {
  session_id: string;
  channel_id: string;
  exit_status: number;
}
