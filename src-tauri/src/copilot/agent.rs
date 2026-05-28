use crate::copilot::tools::TerminalTypeTool;
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
You are a helpful AI assistant embedded in an SSH terminal client. You live in \
a sidebar panel next to the user's terminal.

**Your capabilities:**
- You can type commands into the terminal using the TerminalType tool (the \
  user will be asked to confirm before you type anything)
- You can use Skills for structured analysis: /analyze-error, /diagnose, \
  /investigate, /explain-command

**Important rules:**
- Always explain what you're about to do before using TerminalType
- Be concise — one or two sentences is better than a paragraph
- If you need more context, ask the user to describe what they see in the terminal
- If a command is blocked by blacklist policy, try a different approach or ask the user for guidance";

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

        let mut system_prompt = BASE_SYSTEM_PROMPT.to_string();
        if let Some(extra) = &provider_config.extra_system_prompt {
            system_prompt.push_str(&format!("\n\n<project_context>\n{}\n</project_context>", extra));
        }

        let provider_kind = build_provider(&provider_config)?;

        let terminal_type_tool = Arc::new(TerminalTypeTool::new(
            self.services.clone(),
            self.session_id.clone(),
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

struct TauriConfirmPolicy {
    pending_confirms: Arc<dashmap::DashMap<Uuid, tokio::sync::oneshot::Sender<PermissionDecision>>>,
    app_handle: tauri::AppHandle,
}

#[async_trait]
impl PermissionPolicy for TauriConfirmPolicy {
    async fn check(&self, req: &PermissionRequest) -> PermissionDecision {
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
