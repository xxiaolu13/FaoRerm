//! TerminalAi 的配置。

use cersei_provider::Provider;
use std::path::PathBuf;

/// Provider 类型选择 — 按 API 传输格式而非供应商分类。
///
/// - Anthropic 兼容：使用 Messages API（POST /v1/messages）。
///   适用于 Anthropic、OpenRouter、OneAPI、LiteLLM 代理等。
/// - OpenAI 兼容：使用 Chat Completions API（POST /chat/completions）。
///   适用于 OpenAI、Ollama、vLLM、Azure、Groq、DeepSeek 等。
///
/// `base_url` 默认为官方 API 端点 — 可覆盖以使用代理，
/// 如 OpenRouter、OneAPI、LiteLLM、DeepSeek、Ollama 等。
#[derive(Clone)]
pub enum ProviderKind {
    Anthropic {
        api_key: String,
        base_url: String,
    },
    OpenAI {
        api_key: String,
        base_url: String,
    },
}

impl ProviderKind {
    /// 此 provider 类型的可读名称。
    pub fn name(&self) -> &str {
        match self {
            ProviderKind::Anthropic { .. } => "anthropic",
            ProviderKind::OpenAI { .. } => "openai",
        }
    }

    /// 从此配置构建 cersei Provider。
    pub fn build(&self) -> Box<dyn Provider> {
        match self {
            ProviderKind::Anthropic { api_key, base_url } => {
                Box::new(
                    cersei_provider::Anthropic::builder()
                        .api_key(api_key.clone())
                        .base_url(base_url.clone())
                        .build()
                        .expect("构建 Anthropic provider 失败"),
                )
            }
            ProviderKind::OpenAI { api_key, base_url } => {
                Box::new(
                    cersei_provider::OpenAi::builder()
                        .api_key(api_key.clone())
                        .base_url(base_url.clone())
                        .build()
                        .expect("构建 OpenAI provider 失败"),
                )
            }
        }
    }
}

/// TerminalAi 助手的配置。
pub struct TerminalAiConfig {
    /// LLM provider。
    pub provider: ProviderKind,

    /// 模型名称，例如 "claude-sonnet-4-6"、"gpt-4o"、"gpt-5"。
    /// 默认："claude-sonnet-4-6"
    pub model: String,

    /// 每次查询的最大 agent 轮次（工具调用 + 响应）。
    /// 默认：10
    pub max_turns: u32,

    /// 扩展思考预算，以 token 计（仅 Claude，OpenAI 忽略）。
    /// 默认：None（无扩展思考）
    pub thinking_budget: Option<u32>,

    /// 宿主机上的工作目录（用于 Read/Grep 等文件操作）。
    /// 这是本地文件系统，不是远程 SSH 系统。
    /// 默认：当前目录
    pub working_dir: PathBuf,

    /// 内存中保留的最大终端历史条目数。
    /// 默认：200
    pub max_terminal_entries: usize,

    /// 注入到系统提示中的终端上下文最大字符数。
    /// 默认：50_000
    pub max_terminal_context_chars: usize,

    /// 技能目录。如果设置，技能将从此目录加载。
    /// 在启动时，如果文件不存在，默认的终端分析技能将被写入此处。
    ///
    /// 集成说明：将此设置为你的 GUI 的固定技能目录，例如
    /// `~/.your-app/skills/` 或类似路径。
    pub skills_dir: Option<PathBuf>,

    /// 在基础提示之后追加的系统提示。
    /// 用于添加项目特定的指示。
    pub extra_system_prompt: Option<String>,
}

impl Default for TerminalAiConfig {
    fn default() -> Self {
        Self {
            provider: ProviderKind::Anthropic {
                api_key: std::env::var("ANTHROPIC_API_KEY").unwrap_or_default(),
                base_url: "https://api.anthropic.com".to_string(),
            },
            model: "claude-sonnet-4-6".to_string(),
            max_turns: 10,
            thinking_budget: None,
            working_dir: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            max_terminal_entries: 200,
            max_terminal_context_chars: 50_000,
            skills_dir: None,
            extra_system_prompt: None,
        }
    }
}
