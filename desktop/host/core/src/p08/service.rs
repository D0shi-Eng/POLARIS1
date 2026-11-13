// تركيب Phase-08: خدمات التنفيذ والمخرجات ومساحة العمل، وتسجيل أدواتها في سجل Phase-04.
//
// لا مسار جديد إلى الأثر: كل أداة هنا `ToolAdapter` يُسجَّل في السجل نفسه ويمرّ بالبوابة
// نفسها. المنصّة تقدّم ما لا تعرفه النواة (منفذ الصندوق، ومسارات البيئات، والخط، ومجلد
// التصدير)، وغيابها يعني «غير متاح» صريحًا لا تشغيلًا بديلًا.

use std::path::PathBuf;
use std::sync::Arc;

use crate::audit::AuditLedger;
use crate::p03::clock::RuntimeClock;
use crate::p04::adapter::ToolAdapter;
use crate::p04::service::Phase04;
use crate::p04::skill::{SkillDescriptor, SkillSource};
use crate::p04::tool::RiskClass;
use crate::storage::{Database, StorageError};

use polaris_host_providers::net::HttpClient;

use crate::p02::ports::CredentialStore;

use crate::p05::browser::url_policy::NavigationPolicy;

use super::attachments::AttachmentService;
use super::browser::tools::browser_adapters;
use super::browser::{BrowserProcessPort, BrowserService, UnavailableBrowser};
use super::integrations::device::DeviceService;
use super::integrations::packages::PackageService;
use super::integrations::publish::{LocalFolderPublisher, PublishService};
use super::integrations::settings::Phase08Settings;
use super::integrations::share::ShareService;
use super::integrations::voice::{inspect_wav, LocalWhisperTranscriber, Transcriber};
use super::conversation::ConversationService;
use super::threads::ThreadService;
use super::missions::{MissionPreferences, ReleaseSandboxObserver};
use super::oauth::{OAuthService, UrlOpener};
use super::scheduler::service::SchedulerService;
use super::artifacts::service::ArtifactService;
use super::artifacts::store::ArtifactStore;
use super::artifacts::tools::{DeleteOutputTool, DocumentTool, MoveOutputTool, PresentationTool, RegisterTool, SpreadsheetTool};
use super::execution::tools::{CommandTool, PythonTool};
use super::execution::{ExecutionService, RuntimeCatalog, SandboxPort, UnavailableSandbox};
use super::workspace::WorkspaceRoot;
use super::workspace_tools::workspace_adapters;

pub const SKILL_AGENTIC_WORK: &str = "polaris.skill.agentic-work";

/// ما تقدّمه المنصّة لـPhase-08.
pub struct Phase08Platform {
    pub sandbox: Arc<dyn SandboxPort>,
    pub catalog: RuntimeCatalog,
    pub pdf_font: Option<PathBuf>,
    pub export_root: Option<PathBuf>,
    /// يفتح عنوان التفويض في متصفّح المستخدم (OAuth). غيابه: يُعرض العنوان ليفتحه بنفسه.
    pub url_opener: Option<Arc<dyn UrlOpener>>,
    /// عملية Chromium الحقيقية (Edge في كائن مهمّة على ويندوز). غيابها: لا متصفّح حقيقي.
    pub browser: Arc<dyn BrowserProcessPort>,
    /// سياسة التنقّل نفسها التي يطبّقها Phase-05، لكل طلب في المتصفّح.
    pub navigation: NavigationPolicy,
    /// TEST FIXTURE (ADR-042): واجهات البحث وGitHub البعيدة تُحلّ إلى هذا الأصل على الحلقة المحلية. `None` في المنتج دائمًا.
    pub remote_fixture: Option<String>,
}

impl Default for Phase08Platform {
    fn default() -> Self {
        Self {
            sandbox: Arc::new(UnavailableSandbox("no execution sandbox is bound on this host")),
            catalog: RuntimeCatalog::default(),
            pdf_font: None,
            export_root: None,
            url_opener: None,
            browser: Arc::new(UnavailableBrowser("no browser engine is bound on this host")),
            navigation: NavigationPolicy::product(),
            remote_fixture: None,
        }
    }
}

pub struct Phase08Config {
    pub db: Arc<Database>,
    pub audit: Arc<AuditLedger>,
    pub clock: RuntimeClock,
    pub phase04: Arc<Phase04>,
    pub http: Arc<HttpClient>,
    /// مخزن الأسرار نفسه الذي يملكه Phase-02. رموز OAuth تُحفظ فيه وحده.
    pub credential_store: Arc<dyn CredentialStore>,
    /// مجلد البيانات: تحته `workspaces/` و`runtimes/`.
    pub data_dir: Option<PathBuf>,
    pub platform: Phase08Platform,
}

pub struct Phase08 {
    pub execution: Arc<ExecutionService>,
    pub artifacts: Arc<ArtifactService>,
    pub workspaces: WorkspaceRoot,
    pub attachments: Arc<AttachmentService>,
    pub scheduler: Arc<SchedulerService>,
    pub oauth: Arc<OAuthService>,
    pub settings: Arc<Phase08Settings>,
    /// بحث الويب من الإعدادات (ADR-042): المزوّد المختار وحالته ومفتاحه واختبار الاتصال.
    pub web_search: Arc<super::search_settings::WebSearchService>,
    /// موصل GitHub للقراءة (ADR-042): رمز المستخدم في مخزن الاعتماد، وثلاث أدوات قراءة عبر البوابة.
    pub github: Arc<super::integrations::github::GitHubService>,
    /// إشعارات النظام (ADR-042): القرار هنا، والعرض لمنفذ يربطه المضيف على ويندوز.
    pub notifications: Arc<super::notify::NotificationService>,
    pub share: Arc<ShareService>,
    pub publish: Arc<PublishService>,
    pub packages: Arc<PackageService>,
    pub device: Arc<DeviceService>,
    pub preferences: Arc<MissionPreferences>,
    pub observer: Arc<ReleaseSandboxObserver>,
    /// المحادثة: أدوار المستخدم وسرد المهمّة الحيّ.
    pub conversations: Arc<ConversationService>,
    /// إدارة المحادثات والمشاريع من قائمة «⋯»: تسمية، تثبيت، مفضّلة، أرشفة، نقل، حذف (ADR-031).
    pub threads: Arc<ThreadService>,
    pub browser: Arc<BrowserService>,
    pub refused_registrations: Vec<(String, &'static str)>,
    /// مجلد التصدير الذي عيّنته المنصّة (Documents\POLARIS Exports). لا يعبر إلى العارض.
    pub export_root: Option<PathBuf>,
    pub pdf_font_available: bool,
    pub imports_root: PathBuf,
    pub(crate) http: Arc<HttpClient>,
    audit: Arc<AuditLedger>,
    /// ذاكرة Phase-05: تُربط بعد بناء المرحلتين، لـ«تذكّر هذا» وحده (ADR-032).
    memory: std::sync::OnceLock<Arc<crate::p05::memory::MemoryService>>,
    /// الامتدادات وسجلّ الجلسة للقراءة (عارض التتبّع، خطة 2026-10-07، ADR-041). المخزن نفسه الذي يكتبه زمن التشغيل.
    pub spans: Arc<crate::p03::watch::spans::SqliteSpans>,
    pub sessions: Arc<crate::p03::watch::session::SqliteSessionLog>,
    /// بوابة الأدوات: قبول المستخدم لتعريف أداة MCP أُعيد تعريفها (ASI04).
    pub phase04: Arc<crate::p04::service::Phase04>,
}

/// أدوات المراحل السابقة التي تدخل مهارة العمل الوكيلي. أدوات سطح المكتب لا تدخلها:
/// تحتاج منحة نافذة صريحة لكل مهمّة، فتبقى في مهارتها. وأفعال متصفّح Phase-05 النصّي
/// (نقر، كتابة، تنزيل، رفع) يحلّ محلّها المتصفّح الحقيقي هنا.
const EARLIER_TOOLS: [&str; 6] = [
    crate::p04::builtin::TOOL_CONTEXT_READ,
    crate::p04::builtin::TOOL_AUDIT_CHAIN,
    crate::p04::builtin::TOOL_PROJECT_NOTE,
    // جلب نصّي خفيف بلا جافاسكربت (Phase-05)، احتياطًا حين لا يتوفّر المتصفّح الحقيقي.
    "polaris.web.navigate",
    "polaris.web.read_page",
    "polaris.memory.propose",
];

fn agentic_work_skill(tools: Vec<String>) -> SkillDescriptor {
    SkillDescriptor {
        skill_id: SKILL_AGENTIC_WORK.into(),
        name: "Agentic work".into(),
        description: "Carries a mission end to end: reads attached files, runs PowerShell and Python in the mission sandbox, drives a real Chromium browser whose every request passes the navigation policy, and writes verified documents, decks, spreadsheets and sites into the mission workspace. Anything that leaves the workspace or the sandbox waits for approval.".into(),
        version: "1.0.0".into(),
        enabled: true,
        required_capabilities: vec!["polaris.capability.tool.workspace_write".into(), "polaris.capability.tool.sandboxed_process".into()],
        allowed_tools: tools,
        input_schema_ref: "p08.skill.agentic-work.input.v1".into(),
        output_schema_ref: "p08.skill.agentic-work.output.v1".into(),
        risk_class: RiskClass::Moderate,
        source: SkillSource::BuiltIn,
        created_at: "2026-09-25T00:00:00Z".into(),
        updated_at: "2026-09-25T00:00:00Z".into(),
    }
}

/// مهارات المكتبة (`skills.*` في كتالوج المتخصّصين) كواصفات تظهر في المعرض ويُتحكَّم بتفعيلها.
/// المهارة لا تمنح قدرة: أدواتها أدوات العمل الوكيلي، والمنهج تعليمات فقط.
fn library_skills(tools: &[String]) -> Vec<SkillDescriptor> {
    let catalog = crate::p03::specialist::SpecialistCatalog::builtin();
    catalog
        .specialists()
        .iter()
        .filter(|s| s.domain_id == crate::p03::specialist::SKILLS_DOMAIN)
        .map(|s| {
            let slug = s.specialist_id.trim_start_matches("skills.");
            SkillDescriptor {
                skill_id: format!("{}{slug}", crate::p04::skill::LIBRARY_SKILL_PREFIX),
                name: s.name_en.clone(),
                description: s.summary_en.clone(),
                version: "1.0.0".into(),
                enabled: true,
                required_capabilities: vec!["polaris.capability.tool.workspace_write".into()],
                allowed_tools: tools.to_vec(),
                input_schema_ref: "p08.skill.agentic-work.input.v1".into(),
                output_schema_ref: "p08.skill.agentic-work.output.v1".into(),
                risk_class: RiskClass::Moderate,
                source: SkillSource::BuiltIn,
                created_at: "2026-11-13T00:00:00Z".into(),
                updated_at: "2026-11-13T00:00:00Z".into(),
            }
        })
        .collect()
}

impl Phase08 {
    /// يربط ذاكرة Phase-05 مرة واحدة. بلاها تُرفض «تذكّر هذا» بخطأ اعتماد، لا بكتابة صامتة في مكان آخر.
    pub fn bind_memory(&self, memory: Arc<crate::p05::memory::MemoryService>) {
        // الإعداد المحفوظ يُطبَّق عند الإقلاع: من فعّل الاسترجاع الدلالي يجده مفعّلًا بعد إعادة التشغيل.
        super::semantic_memory::apply(&self.settings, &memory, &self.http);
        let _ = self.memory.set(memory);
    }

    pub fn memory(&self) -> Option<&Arc<crate::p05::memory::MemoryService>> {
        self.memory.get()
    }

    pub fn build(config: Phase08Config) -> Result<Self, StorageError> {
        let base = config.data_dir.clone().unwrap_or_else(|| std::env::temp_dir().join("polaris-p08"));
        let workspaces = WorkspaceRoot::new(base.join("workspaces"));
        let mut catalog = config.platform.catalog;
        if catalog.runtimes_root.is_none() {
            catalog.runtimes_root = Some(base.join("runtimes"));
        }
        let export_root = config.platform.export_root.clone();
        let pdf_font_available = config.platform.pdf_font.as_ref().is_some_and(|p| p.is_file());
        let execution = Arc::new(ExecutionService::new(config.platform.sandbox, workspaces.clone(), catalog, config.db.clone(), config.audit.clone(), config.clock.clone()));
        let (db, audit, clock) = (config.db.clone(), config.audit.clone(), config.clock.clone());
        let attachments = Arc::new(AttachmentService::new(db.clone(), audit.clone(), clock.clone(), base.join("attachments"), workspaces.clone()));
        let scheduler = Arc::new(SchedulerService::new(db.clone(), audit.clone(), clock.clone()));
        let oauth = Arc::new(OAuthService::new(db.clone(), audit.clone(), clock.clone(), config.http.clone(), config.credential_store.clone(), config.platform.url_opener.clone()));
        let settings = Arc::new(Phase08Settings::new(db.clone()));
        let share = Arc::new(ShareService::new(db.clone(), audit.clone(), clock.clone()));
        let publish = Arc::new(PublishService::new(db.clone(), audit.clone(), clock.clone(), vec![Arc::new(LocalFolderPublisher { root: base.join("publications") })], workspaces.clone()));
        let packages = Arc::new(PackageService::new(db.clone(), audit.clone(), clock.clone()));
        let device = Arc::new(DeviceService::new(db.clone(), audit.clone(), clock.clone(), workspaces.clone(), base.join("imports")));
        let preferences = Arc::new(MissionPreferences::new(db.clone(), clock.clone()));
        let conversations = Arc::new(ConversationService::new(db.clone(), clock.clone(), workspaces.clone(), preferences.clone()));
        let threads = Arc::new(ThreadService::new(db.clone(), clock.clone(), workspaces.clone(), audit.clone(), conversations.clone()));
        let browser = Arc::new(BrowserService::new(
            config.platform.browser.clone(),
            config.http.clone(),
            config.platform.navigation.clone(),
            workspaces.clone(),
            base.join("browser-profiles"),
            db.clone(),
            audit.clone(),
            clock.clone(),
        ));
        if settings.get("browser.engine_enabled").and_then(|v| v.as_bool()) == Some(false) {
            browser.set_enabled(false);
        }
        let artifacts = Arc::new(ArtifactService::new(ArtifactStore::new(config.db.clone(), config.audit.clone(), config.clock.clone()), workspaces.clone(), config.platform.pdf_font, config.clock.clone()));
        let observer = Arc::new(ReleaseSandboxObserver { execution: execution.clone(), browser: browser.clone(), artifacts: Some(artifacts.clone()) });

        let mut adapters: Vec<Arc<dyn ToolAdapter>> = workspace_adapters(&workspaces, config.platform.export_root);
        adapters.push(Arc::new(CommandTool { service: execution.clone() }));
        adapters.push(Arc::new(PythonTool { service: execution.clone() }));
        adapters.push(Arc::new(DocumentTool { service: artifacts.clone() }));
        adapters.push(Arc::new(PresentationTool { service: artifacts.clone() }));
        adapters.push(Arc::new(SpreadsheetTool { service: artifacts.clone() }));
        adapters.push(Arc::new(RegisterTool { service: artifacts.clone() }));
        adapters.push(Arc::new(MoveOutputTool { service: artifacts.clone() }));
        adapters.push(Arc::new(DeleteOutputTool { service: artifacts.clone() }));
        adapters.push(Arc::new(super::package_tool::ZipTool { workspaces: workspaces.clone() }));
        adapters.push(Arc::new(super::web_search::WebSearchTool {
            http: config.http.clone(),
            settings: settings.clone(),
            store: config.credential_store.clone(),
            fixture: config.platform.remote_fixture.clone(),
        }));
        let github = Arc::new(super::integrations::github::GitHubService::new(config.http.clone(), config.credential_store.clone(), audit.clone(), clock.clone(), config.platform.remote_fixture.clone()));
        adapters.extend(super::integrations::github::read_tools(&github));
        let notifications = Arc::new(super::notify::NotificationService::new(settings.clone()));
        let web_search = Arc::new(super::search_settings::WebSearchService::new(config.http.clone(), settings.clone(), config.credential_store.clone(), audit.clone(), config.platform.remote_fixture.clone()));
        adapters.extend(browser_adapters(&browser));
        let mut tools: Vec<String> = adapters.iter().map(|a| a.tool_id().to_string()).collect();
        tools.extend(EARLIER_TOOLS.iter().filter(|t| config.phase04.tool_exists(t)).map(|t| t.to_string()));
        let library = library_skills(&tools);
        let mut refused_registrations = config.phase04.register_composite(adapters, agentic_work_skill(tools))?;
        // مكتبة المهارات: كل مهارة تعمل بأدوات العمل الوكيلي نفسها، ومنهجها يدخل الموجّه عبر متخصّصها.
        for skill in library {
            refused_registrations.extend(config.phase04.register_composite(Vec::new(), skill)?);
        }
        config.phase04.prefer_skill(SKILL_AGENTIC_WORK);
        Ok(Self {
            execution,
            artifacts,
            workspaces,
            attachments,
            scheduler,
            oauth,
            settings,
            web_search,
            github,
            notifications,
            share,
            publish,
            packages,
            device,
            preferences,
            observer,
            conversations,
            threads,
            browser,
            refused_registrations,
            export_root,
            pdf_font_available,
            imports_root: base.join("imports"),
            http: config.http,
            audit,
            memory: std::sync::OnceLock::new(),
            spans: Arc::new(crate::p03::watch::spans::SqliteSpans::new(config.db.clone())),
            sessions: Arc::new(crate::p03::watch::session::SqliteSessionLog::new(config.db.clone())),
            phase04: config.phase04.clone(),
        })
    }

    /// يدقّق تصديرًا طلبه المستخدم من الواجهة: الملف واسمه في مجلد التصدير وحجمه.
    pub fn audit_export(&self, mission_id: &str, path: &str, label: &str, bytes: usize) -> Result<(), String> {
        self.audit
            .append(&crate::audit::AuditRecord::new(
                crate::audit::AuditEventType::WorkspaceExported,
                "mission",
                mission_id,
                crate::audit::AuditOutcome::Success,
                serde_json::json!({ "path": path, "file_label": label, "bytes": bytes, "initiator": "USER" }),
            ))
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// يفرّغ تسجيلًا صوتيًّا على خادم التفريغ المحلي المضبوط. بلا ضبط: غير متاح صراحةً.
    /// الصوت لا يُخزَّن؛ التدقيق يحمل المدّة والطول لا المحتوى.
    pub fn transcribe(&self, wav: &[u8], language: Option<&str>) -> Result<String, String> {
        let facts = inspect_wav(wav)?;
        let endpoint = self.settings.get_str("voice.transcription_endpoint").ok_or("VOICE_NOT_CONFIGURED: a local transcription server is not configured")?;
        let model = self.settings.get_str("voice.transcription_model").unwrap_or_else(|| "whisper-1".into());
        let transcriber = LocalWhisperTranscriber { http: self.http.clone(), endpoint, model };
        let outcome = transcriber.transcribe(wav, language);
        let _ = self.audit.append(&crate::audit::AuditRecord::new(
            crate::audit::AuditEventType::TranscriptionCompleted,
            "voice",
            "local",
            if outcome.is_ok() { crate::audit::AuditOutcome::Success } else { crate::audit::AuditOutcome::Failure },
            serde_json::json!({ "seconds": facts.seconds, "chars": outcome.as_ref().map(|t| t.chars().count()).unwrap_or(0) }),
        ));
        outcome
    }
}
