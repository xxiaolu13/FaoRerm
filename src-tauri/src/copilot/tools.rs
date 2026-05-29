use crate::service::Services;
use async_trait::async_trait;
use cersei_tools::{PermissionLevel, Tool, ToolCategory, ToolContext, ToolResult};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

pub struct TerminalTypeTool {
    pub services: Arc<tokio::sync::Mutex<Services>>,
    pub session_id: String,
    pub channel_id: String,
}

impl TerminalTypeTool {
    pub fn new(services: Arc<tokio::sync::Mutex<Services>>, session_id: String, channel_id: String) -> Self {
        Self { services, session_id, channel_id }
    }

    fn check_blacklist(services: &Services, command: &str) -> Option<String> {
        let blacklist = services.config.get_black_list()
            .ok()
            .unwrap_or_default();
        if !blacklist.enabled {
            return None;
        }
        for pattern in &blacklist.contains {
            if command.contains(pattern) {
                return Some(pattern.clone());
            }
        }
        None
    }
}

#[async_trait]
impl Tool for TerminalTypeTool {
    fn name(&self) -> &str {
        "TerminalType"
    }

    fn description(&self) -> &str {
        "Type a shell command into the user's SSH terminal and optionally wait for output. \
         Use this to run commands on the remote system. \
         The user will be asked to confirm before execution. \
         Set wait_for_output=true and a timeout_ms to block until the command completes and get the output back. \
         Set wait_for_output=false (or omit) to fire-and-forget — the output will be visible in terminal history next time you're queried."
    }

    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::Dangerous
    }

    fn category(&self) -> ToolCategory {
        ToolCategory::Custom
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to type into the terminal"
                },
                "wait_for_output": {
                    "type": "boolean",
                    "description": "Whether to wait for command output. Default: false (fire-and-forget). Set to true if you need to analyze the output immediately."
                },
                "timeout_ms": {
                    "type": "integer",
                    "description": "Max wait time in milliseconds if wait_for_output=true. Default: 30000 (30s), max: 300000 (5min)."
                }
            },
            "required": ["command"]
        })
    }

    async fn execute(&self, input: Value, _ctx: &ToolContext) -> ToolResult {
        #[derive(Deserialize)]
        struct Input {
            command: String,
            #[serde(default)]
            wait_for_output: bool,
            #[serde(default = "default_timeout")]
            timeout_ms: u64,
        }

        fn default_timeout() -> u64 {
            30_000
        }

        let input: Input = match serde_json::from_value(input) {
            Ok(i) => i,
            Err(e) => return ToolResult::error(format!("Invalid input: {}", e)),
        };

        let command = input.command.trim().to_string();
        if command.is_empty() {
            return ToolResult::error("Command cannot be empty");
        }

        let ch_id = match Uuid::parse_str(&self.channel_id) {
            Ok(id) => id,
            Err(e) => return ToolResult::error(format!("Invalid channel_id: {}", e)),
        };

        let before_content = crate::FAO_RECORD.get_content(&ch_id);

        {
            let services = self.services.lock().await;

            if let Some(pattern) = Self::check_blacklist(&services, &command) {
                return ToolResult::error(format!(
                    "Command blocked by blacklist policy: contains '{}'. \
                     Please try a different approach or ask the user for guidance.",
                    pattern
                ));
            }

            let send_result = {
                let handles_guard = services.handles.lock().await;
                let session = match handles_guard.get(&self.session_id) {
                    Some(s) => s,
                    None => return ToolResult::error(format!("Session '{}' not found", self.session_id)),
                };

                let data = format!("{}\n", &command);
                let bytes = data.as_bytes().to_vec();
                session.command_tx.send((
                    crate::client::domain::FRCCommand::Channel(
                        ch_id,
                        crate::client::common::ChannelOperation::Data(bytes::Bytes::from(bytes)),
                    ),
                    None,
                )).is_ok()
            };

            if !send_result {
                return ToolResult::error("Failed to send command to channel");
            }
        }

        if !input.wait_for_output {
            return ToolResult::success(format!(
                "Typed into terminal: {}\n\nOutput will be visible in terminal history.",
                command
            ));
        }

        tokio::time::sleep(Duration::from_millis(input.timeout_ms.min(300_000))).await;

        let after_content = crate::FAO_RECORD.get_content(&ch_id);

        let new_output = match (&before_content, &after_content) {
            (Some(before), Some(after)) => {
                if after.len() > before.len() {
                    after[before.len()..].to_string()
                } else {
                    after.clone()
                }
            }
            (None, Some(after)) => after.clone(),
            _ => return ToolResult::success(format!("Typed into terminal: {}\n\n(no terminal recording available)", command)),
        };

        ToolResult::success(format!("Command output:\n{}", new_output))
    }
}

pub struct ReadTerminalTool {
    pub channel_id: String,
}

impl ReadTerminalTool {
    pub fn new(channel_id: String) -> Self {
        Self { channel_id }
    }
}

#[async_trait]
impl Tool for ReadTerminalTool {
    fn name(&self) -> &str {
        "ReadTerminal"
    }

    fn description(&self) -> &str {
        "Read the current content of the terminal. Returns the recent terminal output \
         (last ~50KB, ANSI escapes stripped). Use this to see what's currently on screen \
         or to check command output after using TerminalType."
    }

    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::None
    }

    fn category(&self) -> ToolCategory {
        ToolCategory::Custom
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {}
        })
    }

    async fn execute(&self, _input: Value, _ctx: &ToolContext) -> ToolResult {
        let ch_id = match Uuid::parse_str(&self.channel_id) {
            Ok(id) => id,
            Err(e) => return ToolResult::error(format!("Invalid channel_id: {}", e)),
        };

        match crate::FAO_RECORD.get_content(&ch_id) {
            Some(content) => {
                if content.is_empty() {
                    ToolResult::success("Terminal is empty (no output yet).".to_string())
                } else {
                    ToolResult::success(format!("Terminal content:\n{}", content))
                }
            }
            None => ToolResult::error("No recording found for this channel. The terminal may not be connected."),
        }
    }
}
