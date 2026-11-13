// Phase-02: المزوّدون، والنماذج، والمشاريع، والسياق.
//
// كل خدمة هنا تملك مسؤولية واحدة، و`Phase02` هو التركيب فقط: يبني الخدمات من
// منافذها ويحمل مراجعها. لا منطق عمل في هذا الملف.

pub mod context;
pub mod egress;
pub mod errors;
pub mod invocation;
pub mod ipc;
pub mod models;
pub mod ports;
pub mod projects;
pub mod providers;
pub mod routing;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use polaris_host_providers::net::HttpClient;

use crate::audit::AuditLedger;
use crate::storage::{Database, StorageError};

pub use errors::P02Error;
pub use ports::{CredentialPrompt, CredentialStore, Environment};

/// ما يحتاجه Phase-02 من منصّته. المنافذ تُحقن، فلا تعرف النواة Windows.
pub struct Phase02Config {
    /// مجلد بيانات التطبيق. غيابه يعني قاعدة في الذاكرة (للاختبار فقط).
    pub data_dir: Option<PathBuf>,
    pub credential_store: Arc<dyn CredentialStore>,
    pub credential_prompt: Arc<dyn CredentialPrompt>,
    pub environment: Arc<dyn Environment>,
    pub is_windows: bool,
    /// تجهيزة اختبار على الحلقة المحلية تقف مكان المزوّدين البعيدين. لا تُضبط إلا في
    /// بناء القياس `e2e` أو في الاختبار.
    pub remote_fixture: Option<String>,
}

impl Phase02Config {
    /// إعداد للاختبار: قاعدة في الذاكرة، ومخزن اعتماد في الذاكرة، وبيئة فارغة.
    pub fn for_tests() -> Self {
        Self {
            data_dir: None,
            credential_store: Arc::new(ports::MemoryCredentialStore::default()),
            credential_prompt: Arc::new(ports::NoPrompt),
            environment: Arc::new(ports::MapEnvironment::default()),
            is_windows: cfg!(windows),
            remote_fixture: None,
        }
    }
}

/// حقائق حيّة يقرؤها المُحلِّل والإتاحة.
#[derive(Default)]
pub struct LiveFacts {
    network_contacted: AtomicBool,
}

impl LiveFacts {
    pub fn mark_network_contact(&self) {
        self.network_contacted.store(true, Ordering::SeqCst);
    }

    pub fn network_contacted(&self) -> bool {
        self.network_contacted.load(Ordering::SeqCst)
    }
}

pub struct Phase02 {
    pub db: Arc<Database>,
    pub audit: Arc<AuditLedger>,
    /// عميل HTTP واحد للعملية. تشاركه الطبقات التي تحتاج الشبكة، فلا تفتح كل
    /// طبقة شبكتها الخاصة بسياستها الخاصة.
    pub http: Arc<HttpClient>,
    pub providers: Arc<providers::ProviderRegistry>,
    pub secrets: Arc<providers::SecretBroker>,
    pub discovery: Arc<providers::ModelDiscovery>,
    pub models: Arc<models::ModelRegistry>,
    pub preferences: Arc<models::Preferences>,
    pub projects: Arc<projects::ProjectService>,
    pub sources: Arc<context::SourceService>,
    pub assembler: Arc<context::Assembler>,
    pub invocations: Arc<invocation::InvocationService>,
    pub live: Arc<LiveFacts>,
    /// ما قرّره حارس الإقلاع (Phase-07). غائب لقاعدة الذاكرة.
    pub recovery: Option<crate::p07::recovery::RecoveryReport>,
}

impl Phase02 {
    pub fn build(config: Phase02Config) -> Result<Self, StorageError> {
        let mut recovery = None;
        let db = Arc::new(match &config.data_dir {
            Some(dir) => {
                // Phase-07: حارس الإقلاع يفحص الملف قبل فتحه، ويسترد التالف من أحدث نسخة
                // مُتحقَّق منها، ثم يسلّم قفل المثيل لفتح القاعدة. تالف بلا نسخة يُغلق المخزن
                // ولا يُلمس الملف.
                let guarded = crate::p07::recovery::guard(dir, &crate::time::now_rfc3339_utc())
                    .map_err(|e| StorageError::Open(e.to_string()))?;
                if guarded.report.action == crate::p07::recovery::RecoveryAction::FailedClosed {
                    return Err(StorageError::Open(format!(
                        "{}: the local store is damaged and was left untouched",
                        guarded.report.reason_code
                    )));
                }
                let db = Database::open_with_lock(dir, guarded.lock)?;
                recovery = Some(guarded.report);
                db
            }
            None => Database::in_memory()?,
        });
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let live = Arc::new(LiveFacts::default());
        let http = Arc::new(HttpClient::new());
        let providers = Arc::new(providers::ProviderRegistry::new(
            db.clone(),
            config.environment.clone(),
            config.is_windows,
            config.remote_fixture.clone(),
        ));
        let secrets = Arc::new(providers::SecretBroker::new(
            config.credential_store.clone(),
            config.credential_prompt.clone(),
            config.environment.clone(),
            audit.clone(),
        ));
        let models = Arc::new(models::ModelRegistry::new(db.clone()));
        let preferences = Arc::new(models::Preferences::new(db.clone()));
        let discovery = Arc::new(providers::ModelDiscovery::new(
            providers.clone(),
            secrets.clone(),
            models.clone(),
            http.clone(),
            audit.clone(),
            live.clone(),
        ));
        let projects = Arc::new(projects::ProjectService::new(db.clone(), audit.clone()));
        let sources = Arc::new(context::SourceService::new(db.clone(), projects.clone(), audit.clone()));
        let assembler = Arc::new(context::Assembler::new(sources.clone()));
        let invocations = Arc::new(invocation::InvocationService::new(invocation::InvocationDeps {
            providers: providers.clone(),
            secrets: secrets.clone(),
            models: models.clone(),
            preferences: preferences.clone(),
            projects: projects.clone(),
            sources: sources.clone(),
            assembler: assembler.clone(),
            http: http.clone(),
            audit: audit.clone(),
            live: live.clone(),
        }));
        Ok(Self { db, audit, http, providers, secrets, discovery, models, preferences, projects, sources, assembler, invocations, live, recovery })
    }
}
