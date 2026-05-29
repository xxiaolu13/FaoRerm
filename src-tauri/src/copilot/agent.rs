use crate::copilot::tools::{TerminalTypeTool, ReadTerminalTool};
use crate::service::{ChannelCopilot, ProviderConfig, Services};

use async_trait::async_trait;
use cersei::prelude::*;
use cersei_agent::{AgentBuilder, events::AgentEvent};
use cersei_tools::permissions::{PermissionDecision, PermissionPolicy, PermissionRequest};
use cersei_tools::skill_tool::SkillTool as InnerSkillTool;
use cersei_tools::{Tool, ToolCategory, ToolContext, ToolResult};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use uuid::Uuid;

const BASE_SYSTEM_PROMPT: &str = "\
You are an AI assistant embedded in an SSH terminal client. You sit in a \
sidebar next to the user's terminal and help them understand and manage their \
remote server sessions.

## Tools

- **ReadTerminal**: Read the current terminal screen content. Always available, \
  no confirmation needed. Use this to understand what the user sees.
- **TerminalType**: Type a command into the remote SSH terminal. Requires user \
  confirmation before execution. Use `wait_for_output=true` when you need to \
  see the command result.
- **Skill**: Structured analysis templates. Use `skill='list'` to see available \
  skills like /analyze-error, /diagnose, /investigate, /explain-command.

## When to use each tool

**ReadTerminal** — Use freely whenever you need to see what's on the terminal. \
This is your primary way to understand the user's context.

**TerminalType** — Use ONLY when:
- The user explicitly asks you to run a command (\"run df -h\", \"check disk space\")
- You are actively solving a problem and need to run a diagnostic command as \
  part of that solution (e.g., user reports an error, you need to check logs)
- You have explained what command you plan to run and why

Do NOT use TerminalType just to explore, gather information, or satisfy your \
own curiosity. If the user asks \"what do you see?\" or \"what's on my terminal?\", \
just use ReadTerminal and describe it — don't start running commands.

**Skill** — Use when the user's request matches a skill's purpose, or when you \
need structured analysis of an error or situation.

## CRITICAL: Do NOT call tools after giving your answer

When you have answered the user's question, STOP. Do NOT call any tools \
after providing your response. This includes follow-up questions, suggestions, \
or offers to help further. If you ask \"Do you need me to check X?\" or \
\"Would you like me to run Y?\", that is the END of your turn — wait for the \
user's next message before taking any action. Never call TerminalType or any \
other tool as a follow-up to your own question.

## Behavior guidelines

- Be concise. One or two sentences beats a paragraph.
- Match your response to the user's intent. If they're observing, help them \
  observe. If they're troubleshooting, help them troubleshoot.
- When describing terminal content, summarize what's relevant — don't just \
  dump the raw output back at them.
- If you see an error or something noteworthy in the terminal, mention it \
  briefly, but don't start running commands unless the user asks you to act on it.
- If a command is blocked by blacklist policy, suggest an alternative or ask \
  the user how to proceed.";

pub struct TerminalAi {
    services: Arc<tokio::sync::Mutex<Services>>,
    channel_id: String,
    session_id: String,
    pub app_handle: tauri::AppHandle,
}

impl TerminalAi {
    pub fn new(
        services: Arc<tokio::sync::Mutex<Services>>,
        session_id: String,
        channel_id: String,
        app_handle: tauri::AppHandle,
    ) -> Self {
        Self {
            services,
            channel_id,
            session_id,
            app_handle,
        }
    }

    pub async fn ask_stream(&self, question: &str) -> anyhow::Result<()> {
        let services = self.services.lock().await;

        let copilot = {
            let copilots = services.copilots.lock().await;
            copilots.get(&self.channel_id).cloned()
        };

        let (active_provider, conversation) = match copilot {
            Some(c) => (c.active_provider.clone(), c.conversation.clone()),
            None => {
                let default = services.config.get_snapshot().ai.default_provider.clone();
                (default, Vec::new())
            }
        };

        let provider_config = services.config.get_snapshot().ai.providers.get(&active_provider)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Provider '{}' not found in config", active_provider))?;

        let ch_id = Uuid::parse_str(&self.channel_id)
            .map_err(|e| anyhow::anyhow!("Invalid channel_id: {}", e))?;

        let terminal_context = crate::FAO_RECORD.get_content(&ch_id);

        let mut system_prompt = BASE_SYSTEM_PROMPT.to_string();
        if let Some(content) = &terminal_context {
            if !content.is_empty() {
                system_prompt.push_str(&format!("\n\n<terminal_content>\n{}\n</terminal_content>", content));
            }
        }
        if let Some(extra) = &provider_config.extra_system_prompt {
            system_prompt.push_str(&format!("\n\n<project_context>\n{}\n</project_context>", extra));
        }

        let provider_kind = build_provider(&provider_config)?;

        let terminal_type_tool = Arc::new(TerminalTypeTool::new(
            self.services.clone(),
            self.session_id.clone(),
            self.channel_id.clone(),
        ));
        let read_terminal_tool = Arc::new(ReadTerminalTool::new(
            self.channel_id.clone(),
        ));
        let skills_dir = services.skills_dir.clone();
        let skill_tool = Arc::new(
            InnerSkillTool::new()
                .with_project_root(&std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
                .with_extra_path(skills_dir)
        );

        let mut tools: Vec<Box<dyn Tool>> = vec![];
        tools.push(Box::new(TerminalTypeToolShim {
            inner: terminal_type_tool,
        }));
        tools.push(Box::new(ReadTerminalToolShim {
            inner: read_terminal_tool,
        }));
        tools.push(Box::new(SkillToolShim {
            inner: skill_tool,
        }));

        let pending_confirms = services.pending_confirms.clone();
        let app_handle = self.app_handle.clone();
        let channel_id = self.channel_id.clone();

        let policy = TauriConfirmPolicy {
            pending_confirms,
            app_handle: app_handle.clone(),
        };

        let cancel_token = tokio_util::sync::CancellationToken::new();
        services.copilot_cancel.insert(self.channel_id.clone(), cancel_token.clone());

        let provider = provider_kind.build();
        let agent = Arc::new(
            AgentBuilder::default()
                .provider_boxed(provider)
                .model(&provider_config.model)
                .system_prompt(system_prompt)
                .tools(tools)
                .permission_policy(policy)
                .max_turns(provider_config.max_turns)
                .cancel_token(cancel_token)
                .working_dir(&std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
                .with_messages(conversation.clone())
                .build()?
        );

        drop(services);

        let mut stream = agent.run_stream(question);

        while let Some(event) = stream.next().await {
            let evt = match &event {
                AgentEvent::TextDelta(t) => serde_json::json!({
                    "type": "text_delta",
                    "text": t,
                }),
                AgentEvent::ThinkingDelta(t) => serde_json::json!({
                    "type": "thinking_delta",
                    "text": t,
                }),
                AgentEvent::ToolStart { name, id, input } => serde_json::json!({
                    "type": "tool_start",
                    "name": name,
                    "id": id,
                    "input": input,
                }),
                AgentEvent::ToolEnd { name, id, result, is_error, duration } => serde_json::json!({
                    "type": "tool_end",
                    "name": name,
                    "id": id,
                    "result": result,
                    "is_error": is_error,
                    "duration_ms": duration.as_millis(),
                }),
                AgentEvent::TurnStart { turn } => serde_json::json!({
                    "type": "turn_start",
                    "turn": turn,
                }),
                AgentEvent::TurnComplete { turn, stop_reason, .. } => serde_json::json!({
                    "type": "turn_complete",
                    "turn": turn,
                    "stop_reason": format!("{:?}", stop_reason),
                }),
                AgentEvent::Status(s) => serde_json::json!({
                    "type": "status",
                    "message": s,
                }),
                AgentEvent::Error(e) => serde_json::json!({
                    "type": "error",
                    "message": e,
                }),
                AgentEvent::Complete(output) => serde_json::json!({
                    "type": "complete",
                    "text": output.text(),
                }),
                _ => continue,
            };

            let _ = app_handle.emit(&format!("copilot:event:{}", channel_id), evt);

            if let AgentEvent::Complete(_) = &event {
                break;
            }
            if let AgentEvent::Error(_) = &event {
                break;
            }
        }

        let new_conversation = agent.messages();
        {
            let services = self.services.lock().await;
            let mut copilots = services.copilots.lock().await;
            copilots.insert(self.channel_id.clone(), ChannelCopilot {
                active_provider,
                conversation: new_conversation,
                model: provider_config.model,
            });
            services.copilot_cancel.remove(&self.channel_id);
        }

        Ok(())
    }
}

fn build_provider(config: &ProviderConfig) -> anyhow::Result<crate::copilot::config::ProviderKind> {
    match config.provider_type.as_str() {
        "anthropic" => Ok(crate::copilot::config::ProviderKind::Anthropic {
            api_key: config.token.clone(),
            base_url: if config.url.is_empty() {
                "https://api.anthropic.com".to_string()
            } else {
                config.url.clone()
            },
        }),
        "openai" => Ok(crate::copilot::config::ProviderKind::OpenAI {
            api_key: config.token.clone(),
            base_url: if config.url.is_empty() {
                "https://api.openai.com/v1".to_string()
            } else {
                config.url.clone()
            },
        }),
        other => Err(anyhow::anyhow!("Unknown provider type: {}", other)),
    }
}

struct TerminalTypeToolShim {
    inner: Arc<TerminalTypeTool>,
}

#[async_trait]
impl Tool for TerminalTypeToolShim {
    fn name(&self) -> &str { "TerminalType" }
    fn description(&self) -> &str {
        "Type a shell command into the user's SSH terminal. \
         Set wait_for_output=true and timeout_ms to get output back. \
         Default is fire-and-forget (output visible in terminal history next query)."
    }
    fn permission_level(&self) -> cersei_tools::PermissionLevel {
        cersei_tools::PermissionLevel::Dangerous
    }
    fn category(&self) -> ToolCategory { ToolCategory::Custom }
    fn input_schema(&self) -> Value { self.inner.input_schema() }
    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        self.inner.execute(input, ctx).await
    }
}

struct ReadTerminalToolShim {
    inner: Arc<ReadTerminalTool>,
}

#[async_trait]
impl Tool for ReadTerminalToolShim {
    fn name(&self) -> &str { "ReadTerminal" }
    fn description(&self) -> &str {
        "Read the current content of the terminal. No confirmation needed. \
         Returns recent terminal output (ANSI escapes stripped)."
    }
    fn permission_level(&self) -> cersei_tools::PermissionLevel {
        cersei_tools::PermissionLevel::None
    }
    fn category(&self) -> ToolCategory { ToolCategory::Custom }
    fn input_schema(&self) -> Value { self.inner.input_schema() }
    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        self.inner.execute(input, ctx).await
    }
}

struct TauriConfirmPolicy {
    pending_confirms: Arc<dashmap::DashMap<Uuid, tokio::sync::oneshot::Sender<PermissionDecision>>>,
    app_handle: tauri::AppHandle,
}

#[async_trait]
impl PermissionPolicy for TauriConfirmPolicy {
    async fn check(&self, req: &PermissionRequest) -> PermissionDecision {
        if req.permission_level == cersei_tools::PermissionLevel::None {
            return PermissionDecision::Allow;
        }

        let request_id = Uuid::new_v4();
        let (dec_tx, dec_rx) = tokio::sync::oneshot::channel::<PermissionDecision>();

        self.pending_confirms.insert(request_id, dec_tx);

        let _ = self.app_handle.emit("copilot:confirm", serde_json::json!({
            "request_id": request_id.to_string(),
            "tool": req.tool_name,
            "input": req.tool_input,
            "description": req.description,
            "permission_level": format!("{:?}", req.permission_level),
        }));

        match dec_rx.await {
            Ok(decision) => decision,
            Err(_) => PermissionDecision::Deny("confirmation channel closed".into()),
        }
    }
}

struct SkillToolShim {
    inner: Arc<InnerSkillTool>,
}

#[async_trait]
impl Tool for SkillToolShim {
    fn name(&self) -> &str { "Skill" }
    fn description(&self) -> &str {
        "Execute a skill (prompt template). Use skill='list' to see available skills. \
         Try /analyze-error, /diagnose, /investigate, /explain-command"
    }
    fn permission_level(&self) -> cersei_tools::PermissionLevel {
        cersei_tools::PermissionLevel::None
    }
    fn category(&self) -> ToolCategory { ToolCategory::Custom }
    fn input_schema(&self) -> Value { self.inner.input_schema() }
    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        self.inner.execute(input, ctx).await
    }
}
