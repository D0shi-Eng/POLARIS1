// مزوّد عبر أداة سطر أوامر مثبّتة على الجهاز (Claude CLI، Codex CLI).
//
// الأداة هنا «نقل» لنموذج بعيد، لا وكيل: تُشغَّل بلا أدواتها، في مجلد فارغ، والمُوجِّه على الإدخال المعياري. كل فعل في
// المهمّة يبقى عند المضيف وبوابته. البيانات تغادر الجهاز إلى مزوّد الأداة، فالمزوّد يُعلن «بعيدًا» ويخضع لسياسة الخروج كغيره.
// تسجيل الدخول ملك الأداة: المضيف لا يقرأ مفتاحًا ولا يخزّنه.

pub mod claude;
pub mod codex;
pub mod process;
pub mod prompt;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Deserialize;

use super::{CallContext, ProviderAdapter};
use crate::domain::facts::{CapabilityClaim, Fact};
use crate::domain::model::{DiscoveredModel, ModelCapability, ModelKind};
use crate::domain::{HealthProbe, HealthReason, HealthState, InvocationOutput, InvocationSpec, RuntimeState};
use crate::error::{ProviderError, ProviderErrorCode};
use process::{ProcessFailure, ProcessOutput};

/// أطول فحص صحة (`--version`).
const VERSION_BUDGET: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliFlavor {
    Claude,
    Codex,
}

impl CliFlavor {
    /// اسم الملف التنفيذي بلا امتداد.
    pub fn program(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    /// معرّف المزوّد في الفهرس.
    pub fn provider_id(self) -> &'static str {
        match self {
            Self::Claude => "claude-cli",
            Self::Codex => "codex-cli",
        }
    }
}

/// المواضع الافتراضية المعروفة للأداة على Windows، من متغيّرات بيئة المستخدم.
pub fn known_locations(flavor: CliFlavor, env: &dyn Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    match flavor {
        CliFlavor::Claude => {
            if let Some(home) = env("USERPROFILE") {
                out.push(PathBuf::from(home).join(".local").join("bin").join("claude.exe"));
            }
        }
        CliFlavor::Codex => {
            if let Some(local) = env("LOCALAPPDATA") {
                out.push(PathBuf::from(local).join("Programs").join("OpenAI").join("Codex").join("bin").join("codex.exe"));
            }
        }
    }
    out
}

/// يجد الملف التنفيذي: المواضع المعروفة أولًا، ثم مجلدات PATH. لا تشغيل ولا صدفة.
pub fn locate(flavor: CliFlavor, env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    if let Some(found) = known_locations(flavor, env).into_iter().find(|p| p.is_file()) {
        return Some(found);
    }
    let path = env("PATH")?;
    let names: &[&str] = if cfg!(windows) { &[".exe", ".cmd"] } else { &[""] };
    std::env::split_paths(&path).flat_map(|dir| names.iter().map(move |ext| dir.join(format!("{}{ext}", flavor.program())))).find(|p| p.is_file())
}

fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

#[derive(Deserialize)]
struct AliasFile {
    aliases: HashMap<String, Vec<(String, String)>>,
}

/// أسماء بديلة توثّقها الأداة لنماذجها ولا تسردها بأمر. من ملف بيانات، لا من الشيفرة.
fn documented_aliases(provider_id: &str) -> &'static [(String, String)] {
    static ALIASES: OnceLock<HashMap<String, Vec<(String, String)>>> = OnceLock::new();
    ALIASES
        .get_or_init(|| serde_json::from_str::<AliasFile>(include_str!("../../../data/cli-models.json")).map(|f| f.aliases).unwrap_or_default())
        .get(provider_id)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

pub struct CliAgent {
    flavor: CliFlavor,
}

impl CliAgent {
    pub fn claude() -> Self {
        Self { flavor: CliFlavor::Claude }
    }

    pub fn codex() -> Self {
        Self { flavor: CliFlavor::Codex }
    }

    fn executable(&self) -> Result<PathBuf, ProviderError> {
        locate(self.flavor, &process_env).ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderUnreachable, format!("the {} executable was not found", self.flavor.program())))
    }

    /// مجلد عمل فارغ: الأداة لا ترى مشروعًا ولا ملفات إعداد مشروع.
    fn workdir(&self) -> Result<PathBuf, ProviderError> {
        let dir = std::env::temp_dir().join("polaris-cli-provider").join(self.flavor.program());
        std::fs::create_dir_all(&dir).map_err(|e| ProviderError::new(ProviderErrorCode::ProviderInternalError, format!("cannot create the CLI working folder: {e}")))?;
        Ok(dir)
    }

    fn run(&self, args: &[String], input: &[u8], ctx: &CallContext<'_>, deadline: Instant) -> Result<ProcessOutput, ProviderError> {
        let exe = self.executable()?;
        let cwd = self.workdir()?;
        process::run(&exe, args, &cwd, input, deadline, &|| ctx.cancel.is_cancelled()).map_err(|failure| match failure {
            ProcessFailure::NotFound => ProviderError::new(ProviderErrorCode::ProviderUnreachable, "the CLI executable was not found"),
            ProcessFailure::Spawn(detail) => ProviderError::new(ProviderErrorCode::ProviderUnreachable, format!("the CLI could not be started: {detail}")),
            ProcessFailure::TimedOut => ProviderError::new(ProviderErrorCode::ProviderTimeout, "the CLI did not finish before the deadline"),
            ProcessFailure::Cancelled => ProviderError::new(ProviderErrorCode::Cancelled, "cancelled"),
            ProcessFailure::OutputTooLarge => ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "the CLI printed more than the accepted output size"),
        })
    }
}

/// خروج غير ناجح بلا مخرجات مفهومة: يُصنَّف من مجرى الخطأ.
fn exit_error(output: &ProcessOutput) -> ProviderError {
    let detail = String::from_utf8_lossy(&output.stderr);
    ProviderError::new(claude::classify(&detail), format!("the CLI exited with {:?}: {}", output.status, detail.chars().take(600).collect::<String>()))
}

impl ProviderAdapter for CliAgent {
    fn discover_models(&self, ctx: &CallContext<'_>) -> Result<Vec<DiscoveredModel>, ProviderError> {
        match self.flavor {
            CliFlavor::Claude => Ok(documented_aliases(self.flavor.provider_id())
                .iter()
                .map(|(id, name)| {
                    let mut model = DiscoveredModel::bare(id.clone());
                    model.display_name = Fact::documented(name.clone());
                    model.kind = ModelKind::Chat;
                    model.set_claim(ModelCapability::TextInput, CapabilityClaim::documented(true));
                    model.set_claim(ModelCapability::TextOutput, CapabilityClaim::documented(true));
                    model
                })
                .collect()),
            CliFlavor::Codex => {
                let output = self.run(&codex::models_args(), b"", ctx, ctx.deadline)?;
                if output.status != Some(0) {
                    return Err(exit_error(&output));
                }
                codex::parse_models(&output.stdout)
            }
        }
    }

    fn health_check(&self, ctx: &CallContext<'_>) -> HealthProbe {
        let began = Instant::now();
        let deadline = ctx.deadline.min(began + VERSION_BUDGET);
        match self.run(&["--version".to_string()], b"", ctx, deadline) {
            Ok(output) if output.status == Some(0) => HealthProbe { state: HealthState::Healthy, reason: HealthReason::Ok, latency_ms: Some(began.elapsed().as_millis() as u64), runtime: RuntimeState::NotApplicable },
            Ok(_) => HealthProbe { state: HealthState::Misconfigured, reason: HealthReason::ResponseInvalid, latency_ms: Some(began.elapsed().as_millis() as u64), runtime: RuntimeState::NotApplicable },
            Err(error) if error.code == ProviderErrorCode::ProviderTimeout => HealthProbe { state: HealthState::Unknown, reason: HealthReason::ProviderTimeout, latency_ms: None, runtime: RuntimeState::NotApplicable },
            // الأداة غير موجودة أو لا تُشغَّل: لا «نقطة نهاية» لهذا المزوّد على هذا الجهاز.
            Err(_) => HealthProbe { state: HealthState::Misconfigured, reason: HealthReason::EndpointNotConfigured, latency_ms: None, runtime: RuntimeState::NotApplicable },
        }
    }

    fn invoke(&self, spec: &InvocationSpec, ctx: &CallContext<'_>) -> Result<InvocationOutput, ProviderError> {
        if !spec.tools.is_empty() {
            return Err(ProviderError::new(ProviderErrorCode::UnsupportedCapability, "this provider does not carry native tool calls"));
        }
        if spec.messages.iter().any(|m| !m.images.is_empty()) {
            return Err(ProviderError::new(ProviderErrorCode::UnsupportedCapability, "this provider does not carry image input"));
        }
        let input = prompt::render(spec);
        let args = match self.flavor {
            CliFlavor::Claude => claude::invoke_args(&spec.provider_model_id, spec.user_effort),
            CliFlavor::Codex => codex::invoke_args(&spec.provider_model_id, &self.workdir()?.to_string_lossy(), spec.user_effort),
        };
        let output = self.run(&args, input.as_bytes(), ctx, ctx.deadline)?;
        let parsed = match self.flavor {
            CliFlavor::Claude => claude::parse(&output.stdout),
            CliFlavor::Codex => codex::parse(&output.stdout),
        };
        match parsed {
            Ok(reply) => Ok(reply),
            // مخرجات غير مفهومة مع خروج غير ناجح: سبب الخروج أدلّ من «ردّ غير صالح».
            Err(error) if error.code == ProviderErrorCode::ProviderResponseInvalid && output.status != Some(0) => Err(exit_error(&output)),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_executable_is_found_in_a_known_location_or_on_path() {
        let root = std::env::temp_dir().join(format!("polaris-cli-locate-{}", std::process::id()));
        let known = root.join("home").join(".local").join("bin");
        let on_path = root.join("tools");
        std::fs::create_dir_all(&known).unwrap();
        std::fs::create_dir_all(&on_path).unwrap();
        let home = root.join("home").to_string_lossy().to_string();
        let path = on_path.to_string_lossy().to_string();
        let env = move |name: &str| match name {
            "USERPROFILE" => Some(home.clone()),
            "PATH" => Some(path.clone()),
            _ => None,
        };
        assert_eq!(locate(CliFlavor::Claude, &env), None);
        let ext = if cfg!(windows) { ".exe" } else { "" };
        std::fs::write(on_path.join(format!("claude{ext}")), b"").unwrap();
        assert_eq!(locate(CliFlavor::Claude, &env), Some(on_path.join(format!("claude{ext}"))));
        if cfg!(windows) {
            std::fs::write(known.join("claude.exe"), b"").unwrap();
            assert_eq!(locate(CliFlavor::Claude, &env), Some(known.join("claude.exe")));
        }
        assert_eq!(locate(CliFlavor::Codex, &env), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_alias_file_lists_models_for_the_cli_that_cannot_list_them() {
        let aliases = documented_aliases("claude-cli");
        assert!(aliases.len() >= 3, "{aliases:?}");
        assert!(aliases.iter().all(|(id, name)| !id.is_empty() && !name.is_empty() && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')), "{aliases:?}");
        assert!(documented_aliases("codex-cli").is_empty());
    }
}
