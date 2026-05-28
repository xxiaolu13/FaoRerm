//! 终端分析技能。
//!
//! 这些是 AI 可以通过 `Skill` 工具调用的提示模板。
//! 它们引导 AI 对终端问题进行结构化分析。
//!
//! ## GUI 集成说明
//!
//! 技能从 `TerminalAiConfig::skills_dir` 指定的固定目录加载。
//! 启动时，如果目录不存在，一组默认的终端分析技能
//! 将被写入该目录。用户随后可以在该目录中编辑/添加/删除技能文件 —
//! GUI 不需要做任何特殊操作。
//!
//! 如果没有配置 `skills_dir`，技能将被写入临时目录并
//! 从那里加载（用于独立/测试场景）。

use std::fs;
use std::path::{Path, PathBuf};

/// 确保技能目录存在，并包含默认的终端分析技能。
///
/// 返回技能目录的路径（如有需要则创建）。
///
/// 集成说明：在应用启动时使用你的固定技能目录路径调用此方法。
/// 用户可以通过编辑此目录中的 .md 文件来自定义技能。
pub fn ensure_skills_dir(skills_dir: &Path) -> std::io::Result<PathBuf> {
    fs::create_dir_all(skills_dir)?;

    // 如果默认技能文件不存在，则写入它们
    for skill in DEFAULT_SKILLS {
        let path = skills_dir.join(format!("{}.md", skill.name));
        if !path.exists() {
            fs::write(&path, skill.to_markdown())?;
        }
    }

    Ok(skills_dir.to_path_buf())
}

/// 一个技能定义（AI 分析的提示模板）。
pub struct SkillDef {
    pub name: &'static str,
    pub description: &'static str,
    pub argument_hint: Option<&'static str>,
    pub prompt_template: &'static str,
    pub allowed_tools: Option<&'static [&'static str]>,
}

impl SkillDef {
    fn to_markdown(&self) -> String {
        let hint = self
            .argument_hint
            .map(|h| format!("argument-hint: {}", h))
            .unwrap_or_default();
        let tools = self
            .allowed_tools
            .map(|t| format!("allowed-tools: {}", t.join(", ")))
            .unwrap_or_default();

        format!(
            "---\ndescription: {}\n{}\n{}\n---\n\n{}",
            self.description, hint, tools, self.prompt_template
        )
    }
}

/// 默认的终端分析技能。
pub const DEFAULT_SKILLS: &[SkillDef] = &[
    SkillDef {
        name: "analyze-error",
        description: "分析终端错误消息并建议修复方案",
        argument_hint: Some("<错误描述或粘贴错误信息>"),
        prompt_template: "分析这个终端错误并诊断根本原因：\n\n$ARGUMENTS\n\n\
            1. 解析错误消息 — 实际的错误是什么？\n\
            2. 检查终端历史以获取上下文 — 是什么导致了这个问题？\n\
            3. 如果是构建/开发错误，使用 Read/Grep 检查相关文件\n\
            4. 使用 TerminalType 在远程系统上运行诊断命令\n\
            5. 提出具体的修复方案和步骤\n\
            6. 修复后，使用 TerminalType 验证",
        allowed_tools: Some(&["Read", "Grep", "Glob", "Bash", "TerminalType"]),
    },
    SkillDef {
        name: "diagnose",
        description: "使用完整的终端历史诊断终端会话中出现的问题",
        argument_hint: None,
        prompt_template: "通过查看终端历史来诊断问题所在：\n\n\
            1. 查看终端历史中的最后几条命令 — 哪一条失败了？\n\
            2. 仔细阅读错误输出\n\
            3. 检查是否是之前的命令设置了错误的状态（错误的目录、缺少文件等）\n\
            4. 使用 TerminalType 运行调查命令（ls、pwd、cat、grep、env、ps、df）\
            来检查当前的远程系统状态\n\
            5. 用简单的语言解释出了什么问题\n\
            6. 提出如何修复的方案$ARGUMENTS_SUFFIX",
        allowed_tools: Some(&["Read", "Grep", "Glob", "Bash", "TerminalType"]),
    },
    SkillDef {
        name: "investigate",
        description: "主动调查远程系统状态并提出解决方案",
        argument_hint: Some("<要调查的内容>"),
        prompt_template: "调查远程系统状态：\n\n$ARGUMENTS\n\n\
            1. 使用 TerminalType 运行诊断命令（ls、pwd、env、ps aux、df -h、free -m）\n\
            2. 分析结果 — 当前状态是什么？\n\
            3. 识别任何问题或异常\n\
            4. 提出后续步骤或解决方案\n\
            5. 运行验证命令以确认",
        allowed_tools: Some(&["Read", "Grep", "Glob", "Bash", "TerminalType"]),
    },
    SkillDef {
        name: "explain-command",
        description: "在用户运行之前解释 shell 命令的作用",
        argument_hint: Some("<要解释的命令>"),
        prompt_template: "解释这个 shell 命令的作用：\n\n$ARGUMENTS\n\n\
            1. 分解命令的每个部分\n\
            2. 解释每个标志/选项的作用\n\
            3. 描述预期的输出是什么\n\
            4. 警告任何潜在的副作用或危险\n\
            5. 如果有更安全或更好的方式，建议替代方案",
        allowed_tools: None,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skill_markdown_format() {
        let md = DEFAULT_SKILLS[0].to_markdown();
        assert!(md.starts_with("---"));
        assert!(md.contains("解析错误消息"));
        assert!(md.contains("$ARGUMENTS"));
        assert!(md.contains("TerminalType"));
    }

    #[test]
    fn test_ensure_skills_dir_creates_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = ensure_skills_dir(tmp.path()).unwrap();
        assert_eq!(dir, tmp.path());

        // 所有技能文件都应该存在
        for skill in DEFAULT_SKILLS {
            let path = tmp.path().join(format!("{}.md", skill.name));
            assert!(path.exists(), "缺少技能文件: {}", skill.name);
            let content = fs::read_to_string(&path).unwrap();
            assert!(content.contains(skill.description));
        }
    }

    #[test]
    fn test_ensure_skills_dir_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        ensure_skills_dir(tmp.path()).unwrap();
        // 第二次调用不应覆盖或报错
        ensure_skills_dir(tmp.path()).unwrap();
    }
}
