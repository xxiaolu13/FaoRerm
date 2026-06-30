//! 权限确认模块：替代 cersei 的 PermissionPolicy。
//!
//! 核心思想：用 `ConfirmableTool<Inner>` 包装器在 `Tool::call` 内部
//! await 用户决策。rig 流式 loop 天然串行执行工具，无需额外队列。

use async_trait::async_trait;
use rig::completion::ToolDefinition;
use rig::tool::Tool;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::Emitter;
use uuid::Uuid;

/// 工具权限级别（仅用于前端展示，不影响 rig 行为）。
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionLevel {
    None,
    Dangerous,
}

/// 用户确认决策。
#[derive(Clone, Copy, Debug)]
pub enum PermissionDecision {
    Allow,
    Deny,
}

/// 包装内层工具的 trait（对象安全，便于 ConfirmableTool 持有 dyn）。
/// 取代 cersei_tools::Tool + ToolContext 的组合。
#[async_trait]
pub trait InnerTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn permission_level(&self) -> PermissionLevel;
    fn input_schema(&self) -> Value;

    /// 在用户确认前执行的预检查（如黑名单）。
    /// 返回 Err 表示命令不应执行（不弹确认框，直接拒绝）。
    async fn pre_check(&self, _input: &Value) -> Result<(), String> {
        Ok(())
    }

    /// 实际执行工具逻辑。
    async fn execute(&self, input: Value) -> Result<String, String>;
}

/// 确认包装器：实现 rig::tool::Tool，在 call() 内部 await 用户决策。
///
/// 这是替代 cersei PermissionPolicy 的原生 rig 方式：
/// rig 无 Permission 概念，Tool::call 是唯一拦截点。
pub struct ConfirmableTool {
    pub inner: Arc<dyn InnerTool>,
    pub permission_level: PermissionLevel,
    pub pending_confirms:
        Arc<dashmap::DashMap<Uuid, tokio::sync::oneshot::Sender<PermissionDecision>>>,
    pub app_handle: tauri::AppHandle,
    pub channel_id: String,
    pub cancel_token: tokio_util::sync::CancellationToken,
}

/// 工具错误类型（rig::tool::Tool 要求 Error: std::error::Error）。
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct ToolError(pub String);

/// rig::tool::Tool 的 Args 用 Value（整个 input 对象），
/// Output 用 String（工具结果文本）。
impl Tool for ConfirmableTool {
    const NAME: &'static str = "confirmable_tool"; // 会被 name() 覆盖
    type Error = ToolError;
    type Args = Value;
    type Output = String;

    fn name(&self) -> String {
        self.inner.name().to_string()
    }

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: self.inner.name().to_string(),
            description: self.inner.description().to_string(),
            parameters: self.inner.input_schema(),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        // 1. 预检查（黑名单等）— 在确认前执行，避免用户确认注定被拒的命令
        if let Err(e) = self.inner.pre_check(&args).await {
            return Err(ToolError(e));
        }

        // 2. None 级别直接放行
        if matches!(self.permission_level, PermissionLevel::None) {
            return self.inner.execute(args).await.map_err(ToolError);
        }

        // 3. Dangerous 级别：emit 确认请求 + await 用户决策
        let request_id = Uuid::new_v4();
        let (tx, rx) = tokio::sync::oneshot::channel::<PermissionDecision>();
        self.pending_confirms.insert(request_id, tx);

        let _ = self.app_handle.emit(
            "copilot:confirm",
            serde_json::json!({
                "request_id": request_id.to_string(),
                "tool": self.inner.name(),
                "input": &args,
                "description": self.inner.description(),
                "permission_level": serde_json::to_value(self.permission_level).unwrap_or_default(),
            }),
        );

        // 4. 等待决策，同时监听 cancel（避免死锁）
        let decision = tokio::select! {
            biased;
            _ = self.cancel_token.cancelled() => {
                // cancel 触发：清理 pending_confirms，返回错误
                self.pending_confirms.remove(&request_id);
                return Err(ToolError("cancelled".into()));
            }
            res = rx => match res {
                Ok(d) => d,
                Err(_) => return Err(ToolError("confirmation channel closed".into())),
            },
        };

        match decision {
            PermissionDecision::Allow => self.inner.execute(args).await.map_err(ToolError),
            PermissionDecision::Deny => Err(ToolError(
                "User denied the command execution".into(),
            )),
        }
    }
}
