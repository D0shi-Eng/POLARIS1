// المحوّلات: واجهة واحدة، ومحوّل لكل بروتوكول.
//
// لا قاعدة عمل خاصة بمزوّد تخرج من هنا. الطبقات العليا ترى `ProviderAdapter`
// فقط، ولا تتفرّع على نوع المزوّد.

use std::time::Instant;

use crate::domain::{DiscoveredModel, HealthProbe, InvocationOutput, InvocationSpec, ProviderKind};
use crate::error::ProviderError;
use crate::net::{CancelToken, HttpClient, ResolvedEndpoint};
use crate::secret::SecretValue;

pub mod anthropic;
pub mod cli;
pub mod common;
pub mod google;
pub mod lmstudio;
pub mod ollama;
pub mod openai_compat;
pub mod openrouter;

/// ما يحتاجه المحوّل لنداء واحد. كل شيء فيه قرّره المضيف قبل النداء.
pub struct CallContext<'a> {
    pub http: &'a HttpClient,
    pub endpoint: &'a ResolvedEndpoint,
    pub credential: Option<&'a SecretValue>,
    pub cancel: &'a CancelToken,
    pub deadline: Instant,
    /// مهلة الخمول لبثّ الاستدعاء (Phase-08). `None` في الاكتشاف والفحص.
    pub idle: Option<std::time::Duration>,
}

pub trait ProviderAdapter: Send + Sync {
    /// النماذج كما يبلغ بها المزوّد الآن.
    fn discover_models(&self, ctx: &CallContext<'_>) -> Result<Vec<DiscoveredModel>, ProviderError>;

    /// فحص صحة واحد، بقياس الزمن.
    fn health_check(&self, ctx: &CallContext<'_>) -> HealthProbe;

    /// استدعاء واحد. البث يُستعمل داخليًا حيث يدعمه البروتوكول.
    fn invoke(&self, spec: &InvocationSpec, ctx: &CallContext<'_>) -> Result<InvocationOutput, ProviderError>;

    /// هل ينقل هذا المحوّل الأدوات بصيغة الاستدعاء الأصيل؟ لا يعني أن النموذج يجيدها: ذلك يُقاس.
    /// محوّل لا ينقلها يرفض طلبًا يعرضها بدل أن يُسقطها صامتًا.
    fn supports_native_tools(&self) -> bool {
        false
    }

    /// هل ينقل هذا المحوّل صورًا في رسالة المستخدم؟ لا يعني أن النموذج يراها: الرؤية قدرة النموذج المعلنة. محوّل لا
    /// ينقلها يرفض رسالة تحملها (`messages::ChatMessage::images`).
    fn supports_image_input(&self) -> bool {
        false
    }
}

/// المحوّل المناسب لنوع المزوّد.
pub fn adapter_for(kind: ProviderKind) -> Box<dyn ProviderAdapter> {
    match kind {
        ProviderKind::LocalOpenaiCompatible => Box::new(openai_compat::OpenAiCompatible::local_generic()),
        ProviderKind::LmStudio => Box::new(lmstudio::LmStudio::new()),
        ProviderKind::Ollama => Box::new(ollama::OllamaNative::new()),
        ProviderKind::Openai => Box::new(openai_compat::OpenAiCompatible::hosted_openai()),
        ProviderKind::Openrouter => Box::new(openrouter::OpenRouter::new()),
        ProviderKind::Anthropic => Box::new(anthropic::AnthropicMessages::new()),
        ProviderKind::Google => Box::new(google::GoogleGenerativeLanguage::new()),
        ProviderKind::OpenaiCompatibleApi => Box::new(openai_compat::OpenAiCompatible::with_flavor(openai_compat::Flavor::HostedGeneric)),
        ProviderKind::CustomOpenaiCompatible => Box::new(openai_compat::OpenAiCompatible::with_flavor(openai_compat::Flavor::Custom)),
        ProviderKind::ClaudeCli => Box::new(cli::CliAgent::claude()),
        ProviderKind::CodexCli => Box::new(cli::CliAgent::codex()),
    }
}
