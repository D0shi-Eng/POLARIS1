// فهرس المزوّدات: المدمجة بمحوّلاتها، والمستضافة من الفهرس الموثّق، وبناء المخصّص.
//
// كل مدخل حقائق موثّقة عن بروتوكول المزوّد، لا عن نموذج بعينه. ما لم يكن مؤكدًا يبقى UNKNOWN، ويُقرأ لكل
// نموذج من بيانات المزوّد عند الاكتشاف. لا نموذج افتراضي هنا، ولا نقطة نهاية بعيدة قابلة للتعديل.
//
// المستضاف (ADR-037) يُقرأ من `data/hosted-catalog.json`: لقطة مقلَّصة من فهرس models.dev، وهو الفهرس الذي يبني منه
// OpenCode قائمة مزوّداته، مع تاريخ أخذها. البيانات خارج الشيفرة: أسماء المزوّدات والنماذج لا تُكتب في المصدر،
// وفحص «لا اسم نموذج في المنتج» يبقى صادقًا على نطاقه.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use serde::Deserialize;
use url::{Host, Url};

use crate::domain::facts::CapabilityClaim as C;
use crate::domain::messages::{EffortWire, MaxTokensField, WireProfile};
use crate::domain::provider::{AuthMode, EndpointType, Locality, ProviderCapabilities, ProviderKind};

#[derive(Debug, Clone)]
pub struct ProviderDescriptor {
    pub id: String,
    pub kind: ProviderKind,
    /// اسم علم للمزوّد. لا يُترجم.
    pub display_name: String,
    /// مفتاح ترجمة للمزوّد العام الذي ليس اسم علم.
    pub display_name_key: String,
    pub endpoint_type: EndpointType,
    pub auth_mode: AuthMode,
    pub locality: Locality,
    /// نقطة النهاية الافتراضية. للمحلي: قابلة للتغيير داخل الحلقة المحلية فقط.
    pub default_endpoint: Option<String>,
    pub endpoint_configurable: bool,
    /// اسم المضيف الوحيد المسموح للبعيد.
    pub remote_host: Option<String>,
    /// متغيّر البيئة الرسمي للمفتاح.
    pub credential_env_var: Option<String>,
    pub model_listing_requires_auth: bool,
    pub enabled_by_default: bool,
    pub capabilities: ProviderCapabilities,
    /// ترتيبه في «الشائعين» (1 أوّلًا)، أو صفر.
    pub popular_rank: u16,
    /// صياغة الطلب كما توثّقها صفحة المزوّد (2026-10-06). المستضاف يأخذها من الفهرس؛ المدمج محوّله يعرف صياغته.
    pub wire: WireProfile,
}

const U: C = C::UNKNOWN;
const Y: C = C::documented(true);
const N: C = C::documented(false);

const GENERIC_OPENAI_COMPATIBLE: ProviderCapabilities = ProviderCapabilities {
    supports_streaming: Y,
    supports_model_listing: Y,
    supports_health_check: Y,
    supports_chat: Y,
    supports_embeddings: U,
    supports_vision: U,
    supports_audio_input: U,
    supports_audio_output: U,
    supports_tools: U,
    supports_json_schema: U,
    supports_system_prompt: Y,
    supports_reasoning_control: U,
};

const LOCAL_STUDIO: ProviderCapabilities = ProviderCapabilities {
    supports_embeddings: Y,
    supports_tools: Y,
    supports_json_schema: Y,
    ..GENERIC_OPENAI_COMPATIBLE
};

const LOCAL_NATIVE: ProviderCapabilities = ProviderCapabilities {
    supports_embeddings: Y,
    supports_tools: Y,
    supports_json_schema: Y,
    ..GENERIC_OPENAI_COMPATIBLE
};

const REMOTE_OPENAI: ProviderCapabilities = ProviderCapabilities {
    supports_embeddings: Y,
    supports_vision: Y,
    supports_audio_input: Y,
    supports_audio_output: Y,
    supports_tools: Y,
    supports_json_schema: Y,
    supports_reasoning_control: Y,
    ..GENERIC_OPENAI_COMPATIBLE
};

const REMOTE_ANTHROPIC: ProviderCapabilities = ProviderCapabilities {
    supports_embeddings: N,
    supports_vision: Y,
    supports_audio_input: N,
    supports_audio_output: N,
    supports_tools: Y,
    supports_json_schema: U,
    supports_reasoning_control: Y,
    ..GENERIC_OPENAI_COMPATIBLE
};

const REMOTE_GOOGLE: ProviderCapabilities = ProviderCapabilities {
    supports_embeddings: Y,
    supports_vision: Y,
    supports_audio_input: Y,
    supports_audio_output: U,
    supports_tools: Y,
    supports_json_schema: Y,
    supports_reasoning_control: Y,
    ..GENERIC_OPENAI_COMPATIBLE
};

/// مزوّد عبر أداة سطر أوامر: ردّ نصّي كامل بلا بثّ، وبلا نقل أدوات أصيلة ولا صور (المضيف يستعمل العقد النصّي).
const CLI_AGENT: ProviderCapabilities = ProviderCapabilities {
    supports_streaming: N,
    supports_embeddings: N,
    supports_vision: N,
    supports_audio_input: N,
    supports_audio_output: N,
    supports_tools: N,
    supports_json_schema: N,
    ..GENERIC_OPENAI_COMPATIBLE
};

/// المستضاف من الفهرس: البروتوكول المتوافق يعرف استدعاء الدوال، والنموذج الواحد يُقرأ من الفهرس أو المزوّد.
const HOSTED_GENERIC: ProviderCapabilities = ProviderCapabilities { supports_tools: Y, ..GENERIC_OPENAI_COMPATIBLE };

/// نماذج قد يعيد بعض المزوّدين قائمتها: لا يُفترض أن المخصّص يجيب عن `/models`.
const CUSTOM_GENERIC: ProviderCapabilities = ProviderCapabilities { supports_model_listing: U, supports_health_check: U, ..GENERIC_OPENAI_COMPATIBLE };

/// محدّدات المزوّد المحلي والبعيد المدمج. المعرّف مفتاح الترجمة أيضًا.
#[allow(clippy::too_many_arguments)]
fn builtin(
    id: &str,
    kind: ProviderKind,
    display_name: &str,
    endpoint_type: EndpointType,
    auth_mode: AuthMode,
    locality: Locality,
    default_endpoint: Option<&str>,
    remote_host: Option<&str>,
    credential_env_var: Option<&str>,
    model_listing_requires_auth: bool,
    capabilities: ProviderCapabilities,
    popular_rank: u16,
) -> ProviderDescriptor {
    ProviderDescriptor {
        id: id.to_string(),
        kind,
        display_name: display_name.to_string(),
        display_name_key: format!("provider.name.{id}"),
        endpoint_type,
        auth_mode,
        locality,
        default_endpoint: default_endpoint.map(str::to_string),
        endpoint_configurable: locality == Locality::Local,
        remote_host: remote_host.map(str::to_string),
        credential_env_var: credential_env_var.map(str::to_string),
        model_listing_requires_auth,
        enabled_by_default: locality == Locality::Local,
        capabilities,
        popular_rank,
        wire: if locality == Locality::Local { WireProfile::LOCAL } else { WireProfile::HOSTED },
    }
}

fn builtins() -> Vec<ProviderDescriptor> {
    use AuthMode::*;
    use EndpointType::*;
    use Locality::*;
    use ProviderKind as K;
    vec![
        builtin("lm-studio", K::LmStudio, "LM Studio", OpenaiCompatible, NoAuthLocal, Local, Some("http://127.0.0.1:1234"), None, None, false, LOCAL_STUDIO, 0),
        builtin("ollama", K::Ollama, "Ollama", OllamaNative, NoAuthLocal, Local, Some("http://127.0.0.1:11434"), None, None, false, LOCAL_NATIVE, 0),
        // لا منفذ افتراضي: الخادم العام يحدّده المستخدم، ولا يُفحص قبل ذلك.
        builtin("local-openai-compatible", K::LocalOpenaiCompatible, "OpenAI-compatible local server", OpenaiCompatible, NoAuthLocal, Local, None, None, None, false, GENERIC_OPENAI_COMPATIBLE, 0),
        builtin("anthropic", K::Anthropic, "Anthropic", AnthropicMessages, ApiKey, Remote, Some("https://api.anthropic.com"), Some("api.anthropic.com"), Some("ANTHROPIC_API_KEY"), true, REMOTE_ANTHROPIC, 1),
        builtin("openai", K::Openai, "OpenAI", OpenaiCompatible, ApiKey, Remote, Some("https://api.openai.com"), Some("api.openai.com"), Some("OPENAI_API_KEY"), true, REMOTE_OPENAI, 2),
        builtin("google", K::Google, "Google", GoogleGenerativeLanguage, ApiKey, Remote, Some("https://generativelanguage.googleapis.com"), Some("generativelanguage.googleapis.com"), Some("GOOGLE_API_KEY"), true, REMOTE_GOOGLE, 3),
        // قائمة النماذج عامة في وثائق المزوّد؛ الاستدعاء يتطلب مفتاحًا.
        builtin("openrouter", K::Openrouter, "OpenRouter", OpenaiCompatible, ApiKey, Remote, Some("https://openrouter.ai"), Some("openrouter.ai"), Some("OPENROUTER_API_KEY"), false, GENERIC_OPENAI_COMPATIBLE, 4),
        // أداتا سطر الأوامر (2026-11-12): بعيدتان لأن البيانات تغادر الجهاز إلى مزوّد الأداة. العنوان يوثّق وجهة البيانات؛ الاتصال
        // تجريه الأداة نفسها، والمضيف لا يفتح مقبسًا إليه. الدخول ملك الأداة، فلا متغيّر بيئة ولا مفتاح.
        builtin("claude-cli", K::ClaudeCli, "Claude CLI", LocalCli, CliLogin, Remote, Some("https://api.anthropic.com"), Some("api.anthropic.com"), None, false, CLI_AGENT, 5),
        builtin("codex-cli", K::CodexCli, "Codex CLI", LocalCli, CliLogin, Remote, Some("https://api.openai.com"), Some("api.openai.com"), None, false, CLI_AGENT, 6),
    ]
}

/// نموذج كما يوثّقه الفهرس. حقيقة من واصف ثابت (STATIC_DESCRIPTOR)، لا ما أبلغ به المزوّد.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentedModel {
    pub id: String,
    pub name: String,
    pub context_window: Option<u64>,
    pub max_output_tokens: Option<u64>,
    pub tools: bool,
    pub reasoning: bool,
    pub vision: bool,
}

#[derive(Deserialize)]
struct RawHosted {
    id: String,
    name: String,
    base_url: String,
    host: String,
    env: Option<String>,
    popular: u16,
    models: Vec<RawModelRow>,
    /// صياغة موثّقة لهذا المزوّد، إن وُجدت في جدول المولّد (`tools/provider-catalog/generate.mjs`، `WIRE`).
    #[serde(default)]
    wire: Option<RawWire>,
}

#[derive(Deserialize)]
struct RawWire {
    max_tokens: String,
    effort: String,
    echo_reasoning: bool,
    reasoning_split: bool,
}

/// صياغة مدخل الفهرس. قيمة غير معروفة تبقى على الافتراض المستضاف، فلا يُرسل حقل لم يُوثَّق.
fn wire_of(raw: Option<RawWire>) -> WireProfile {
    let Some(raw) = raw else { return WireProfile::HOSTED };
    WireProfile {
        send_temperature: false,
        max_tokens: if raw.max_tokens == "max_completion_tokens" { MaxTokensField::MaxCompletionTokens } else { MaxTokensField::MaxTokens },
        effort: match raw.effort.as_str() {
            "reasoning_effort" => EffortWire::ReasoningEffort,
            "enable_thinking" => EffortWire::EnableThinking,
            "thinking" => EffortWire::ThinkingType,
            _ => EffortWire::Omit,
        },
        echo_reasoning: raw.echo_reasoning,
        reasoning_split: raw.reasoning_split,
    }
}

/// صفّ نموذج كما يكتبه ملف الفهرس المضمَّن: المعرّف، والاسم، ونافذة السياق، وحدّ المخرجات، وأعلام القدرات.
type RawModelRow = (String, String, u64, u64, u8);

#[derive(Deserialize)]
struct RawCatalog {
    source: String,
    retrieved: String,
    hosted: Vec<RawHosted>,
    documented: HashMap<String, Vec<RawModelRow>>,
}

struct Catalog {
    source: String,
    retrieved: String,
    descriptors: Vec<Arc<ProviderDescriptor>>,
    documented: HashMap<String, Vec<DocumentedModel>>,
}

const HOSTED_JSON: &str = include_str!("../data/hosted-catalog.json");
/// معرّفات لا يأخذها مزوّد مخصّص ولا مستضاف: المدمجة.
const BUILTIN_IDS: [&str; 9] = ["lm-studio", "ollama", "local-openai-compatible", "anthropic", "openai", "google", "openrouter", "claude-cli", "codex-cli"];

fn documented(raw: Vec<RawModelRow>) -> Vec<DocumentedModel> {
    raw.into_iter()
        .map(|(id, name, context, output, flags)| DocumentedModel {
            id,
            name,
            context_window: (context > 0).then_some(context),
            max_output_tokens: (output > 0).then_some(output),
            tools: flags & 1 != 0,
            reasoning: flags & 2 != 0,
            vision: flags & 4 != 0,
        })
        .collect()
}

/// مدخل مستضاف صالح: معرّف بشكل المعرّف، وعنوان https مضيفه هو المذكور، بلا استعلام ولا بيانات اعتماد.
fn hosted_is_sound(raw: &RawHosted) -> bool {
    let id_ok = is_provider_id(&raw.id) && !BUILTIN_IDS.contains(&raw.id.as_str());
    let url_ok = Url::parse(&raw.base_url).is_ok_and(|u| {
        u.scheme() == "https" && u.query().is_none() && u.username().is_empty() && matches!(u.host(), Some(Host::Domain(h)) if h.eq_ignore_ascii_case(&raw.host))
    });
    let env_ok = raw.env.as_deref().is_none_or(is_env_var_name);
    id_ok && url_ok && env_ok && !raw.name.trim().is_empty() && raw.name.chars().count() <= 64
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        // الملف جزء من الثنائي ومختبَر؛ فشل تحليله عيب بناء لا حالة تشغيل، فيُترك الفهرس المستضاف فارغًا ويكشفه الاختبار.
        let raw: RawCatalog = serde_json::from_str(HOSTED_JSON).unwrap_or(RawCatalog {
            source: String::new(),
            retrieved: String::new(),
            hosted: Vec::new(),
            documented: HashMap::new(),
        });
        let mut descriptors: Vec<Arc<ProviderDescriptor>> = builtins().into_iter().map(Arc::new).collect();
        let mut documented_models: HashMap<String, Vec<DocumentedModel>> = HashMap::new();
        for (id, models) in raw.documented {
            documented_models.insert(id, documented(models));
        }
        for entry in raw.hosted {
            if !hosted_is_sound(&entry) || descriptors.iter().any(|d| d.id == entry.id) {
                continue;
            }
            descriptors.push(Arc::new(ProviderDescriptor {
                display_name_key: format!("provider.name.{}", entry.id),
                id: entry.id.clone(),
                kind: ProviderKind::OpenaiCompatibleApi,
                display_name: entry.name,
                endpoint_type: EndpointType::OpenaiCompatible,
                auth_mode: AuthMode::ApiKey,
                locality: Locality::Remote,
                default_endpoint: Some(entry.base_url.trim_end_matches('/').to_string()),
                endpoint_configurable: false,
                remote_host: Some(entry.host.to_ascii_lowercase()),
                credential_env_var: entry.env,
                model_listing_requires_auth: true,
                enabled_by_default: false,
                capabilities: HOSTED_GENERIC,
                // المدمجة البعيدة تأخذ المراتب 1..6، والمستضافة بعدها.
                popular_rank: if entry.popular > 0 { entry.popular.saturating_add(6) } else { 0 },
                wire: wire_of(entry.wire),
            }));
            documented_models.insert(entry.id, documented(entry.models));
        }
        Catalog { source: raw.source, retrieved: raw.retrieved, descriptors, documented: documented_models }
    })
}

/// كل الواصفات بترتيب ثابت: المحلي أولًا، ثم البعيد المدمج، ثم المستضاف بترتيب الفهرس.
pub fn builtin_descriptors() -> &'static [Arc<ProviderDescriptor>] {
    &catalog().descriptors
}

pub fn descriptor(id: &str) -> Option<Arc<ProviderDescriptor>> {
    catalog().descriptors.iter().find(|d| d.id == id).cloned()
}

/// النماذج الموثّقة لمزوّد في الفهرس، أو قائمة فارغة.
pub fn documented_models(provider_id: &str) -> &'static [DocumentedModel] {
    catalog().documented.get(provider_id).map(Vec::as_slice).unwrap_or(&[])
}

/// مصدر الفهرس وتاريخ أخذه.
pub fn catalog_source() -> (&'static str, &'static str) {
    (&catalog().source, &catalog().retrieved)
}

/// شكل اسم متغيّر البيئة في العقد: `^[A-Z][A-Z0-9_]{2,63}$`.
pub fn is_env_var_name(name: &str) -> bool {
    matches!(name.chars().next(), Some(c) if c.is_ascii_uppercase())
        && (3..=64).contains(&name.len())
        && name.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// شكل معرّف المزوّد في العقد: `^[a-z][a-z0-9-]{1,47}$`.
pub fn is_provider_id(id: &str) -> bool {
    let mut chars = id.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
        && (2..=48).contains(&id.len())
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// لماذا رُفض مزوّد مخصّص.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustomRefusal {
    /// المعرّف ليس بالشكل، أو يأخذه مزوّد مدمج أو مستضاف.
    IdTaken,
    IdInvalid,
    NameInvalid,
    /// العنوان ليس https عامًّا ولا http على الحلقة المحلية، أو يحمل استعلامًا أو بيانات اعتماد.
    BaseUrlInvalid,
}

/// يبني واصف مزوّد أضافه المستخدم. المضيف البعيد يصبح المضيف الوحيد المسموح له، ويُفحص كل عنوان يُحلّ إليه عند الاتصال
/// كما في كل بعيد (عنوان خاص يُرفض)؛ المحلي على الحلقة المحلية وحدها. لا تمرير لعنوان غير هذين.
pub fn custom_descriptor(id: &str, display_name: &str, base_url: &str) -> Result<ProviderDescriptor, CustomRefusal> {
    if !is_provider_id(id) {
        return Err(CustomRefusal::IdInvalid);
    }
    if BUILTIN_IDS.contains(&id) || descriptor(id).is_some() {
        return Err(CustomRefusal::IdTaken);
    }
    let name = display_name.trim();
    if name.is_empty() || name.chars().count() > 64 || name.chars().any(char::is_control) {
        return Err(CustomRefusal::NameInvalid);
    }
    let base = base_url.trim().trim_end_matches('/');
    let local = crate::net::endpoint::loopback(base).is_ok();
    let remote_host = if local {
        None
    } else {
        let url = Url::parse(base).map_err(|_| CustomRefusal::BaseUrlInvalid)?;
        match url.host() {
            Some(Host::Domain(host)) if url.scheme() == "https" && host.contains('.') => {
                crate::net::endpoint::remote(base, host).map_err(|_| CustomRefusal::BaseUrlInvalid)?;
                Some(host.to_ascii_lowercase())
            }
            _ => return Err(CustomRefusal::BaseUrlInvalid),
        }
    };
    Ok(ProviderDescriptor {
        id: id.to_string(),
        kind: ProviderKind::CustomOpenaiCompatible,
        display_name: name.to_string(),
        display_name_key: format!("provider.name.{id}"),
        endpoint_type: EndpointType::OpenaiCompatible,
        auth_mode: AuthMode::OptionalApiKey,
        locality: if local { Locality::Local } else { Locality::Remote },
        default_endpoint: Some(base.to_string()),
        endpoint_configurable: false,
        remote_host,
        credential_env_var: None,
        model_listing_requires_auth: false,
        enabled_by_default: true,
        capabilities: CUSTOM_GENERIC,
        popular_rank: 0,
        wire: if local { WireProfile::LOCAL } else { WireProfile::HOSTED },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_are_unique_and_slug_shaped() {
        let mut seen = std::collections::HashSet::new();
        for d in builtin_descriptors() {
            assert!(seen.insert(d.id.clone()), "duplicate {}", d.id);
            assert!(is_provider_id(&d.id), "{}", d.id);
        }
        // تسعة مدمجة (منها أداتا سطر الأوامر)، وفهرس مستضاف حُلِّل فعلًا (لقطة 2026-10-06 تحمل 192 مدخلًا صالحًا).
        assert!(seen.len() > 150, "hosted catalog failed to load: {}", seen.len());
        assert_eq!(builtin_descriptors()[..9].iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), BUILTIN_IDS);
        assert_eq!(catalog_source().0, "https://models.dev/api.json");
    }

    #[test]
    fn remote_endpoints_are_fixed_https_and_local_ones_loopback() {
        for d in builtin_descriptors() {
            match d.locality {
                Locality::Remote => {
                    assert!(!d.endpoint_configurable, "{} remote endpoint must be fixed", d.id);
                    let endpoint = d.default_endpoint.as_deref().unwrap();
                    assert!(endpoint.starts_with("https://"));
                    let host = d.remote_host.as_deref().unwrap();
                    assert_eq!(Url::parse(endpoint).unwrap().host_str(), Some(host));
                    // البعيد إما بمفتاح API، وإما أداة سطر أوامر تحمل دخولها بنفسها (ولا مفتاح عندها في المضيف).
                    if d.endpoint_type == EndpointType::LocalCli {
                        assert_eq!(d.auth_mode, AuthMode::CliLogin, "{}", d.id);
                        assert!(d.credential_env_var.is_none(), "{} must not read a key", d.id);
                    } else {
                        assert_eq!(d.auth_mode, AuthMode::ApiKey);
                    }
                    assert!(!d.enabled_by_default, "{} remote must be opt-in", d.id);
                }
                Locality::Local => {
                    assert!(d.remote_host.is_none());
                    if let Some(endpoint) = &d.default_endpoint {
                        assert!(endpoint.starts_with("http://127.0.0.1:"));
                    }
                }
            }
        }
    }

    #[test]
    fn key_variables_are_upper_snake_and_popular_ranks_are_distinct() {
        let mut ranks = std::collections::HashSet::new();
        for d in builtin_descriptors() {
            if let Some(var) = &d.credential_env_var {
                assert!(is_env_var_name(var), "{var}");
            }
            if d.popular_rank > 0 {
                assert!(ranks.insert(d.popular_rank), "rank {} repeated", d.popular_rank);
            }
        }
        assert!(ranks.len() >= 15);
    }

    #[test]
    fn documented_models_carry_names_and_limits_from_the_snapshot() {
        let hosted = builtin_descriptors().iter().find(|d| d.kind == ProviderKind::OpenaiCompatibleApi).unwrap();
        assert!(!documented_models(&hosted.id).is_empty());
        assert!(documented_models("anthropic").iter().all(|m| !m.name.is_empty()));
        assert!(documented_models("no-such-provider").is_empty());
    }

    #[test]
    fn a_custom_provider_is_public_https_or_loopback_and_never_takes_a_registered_id() {
        let remote = custom_descriptor("my-gateway", "My gateway", "https://api.example.com/v1/").unwrap();
        assert_eq!(remote.locality, Locality::Remote);
        assert_eq!(remote.remote_host.as_deref(), Some("api.example.com"));
        assert_eq!(remote.default_endpoint.as_deref(), Some("https://api.example.com/v1"));
        assert_eq!(remote.auth_mode, AuthMode::OptionalApiKey);
        let local = custom_descriptor("my-local", "Local", "http://127.0.0.1:8080/v1").unwrap();
        assert_eq!(local.locality, Locality::Local);
        assert!(local.remote_host.is_none());

        assert_eq!(custom_descriptor("openai", "x", "https://api.example.com").unwrap_err(), CustomRefusal::IdTaken);
        assert_eq!(custom_descriptor("Bad Id", "x", "https://api.example.com").unwrap_err(), CustomRefusal::IdInvalid);
        assert_eq!(custom_descriptor("ok-id", " ", "https://api.example.com").unwrap_err(), CustomRefusal::NameInvalid);
        for url in ["http://api.example.com/v1", "https://10.0.0.5/v1", "https://user:pw@api.example.com", "https://api.example.com/v1?x=1", "ftp://x.y"] {
            assert_eq!(custom_descriptor("ok-id", "x", url).unwrap_err(), CustomRefusal::BaseUrlInvalid, "{url}");
        }
    }
}
