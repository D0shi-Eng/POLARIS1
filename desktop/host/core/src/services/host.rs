// تجميع الخدمات، وتوجيه العملية إلى مالكها المُسجَّل.
//
// `handle` ليست مُرسِلًا عامًّا: مدخلها اسمٌ من مجموعة مغلقة أثبتت البوابةُ قبلها
// أنه موجَّه، والمطابقة هنا شاملة فلا يمرّ اسم بلا مالك. لا يوجد فرع `_ =>` يستقبل
// «أي شيء آخر» بمنطق عام.

use std::sync::Arc;

use serde_json::Value;

use crate::capabilities::{CapabilityFacts, Phase02State};
use crate::ipc::errors::HostError;
use crate::p02::models::listing::list_views;
use crate::p02::models::view::selectable;
use crate::p02::{Phase02, Phase02Config};
use crate::p03::clock::RuntimeClock;
use crate::p03::service::{Phase03, Phase03Config};
use crate::p03::probe_runner::{ChainedTrustedEvidence, MissionProbeRunner};
use crate::p03::trusted_test_evidence::SharedTrustedTestEvidence;
use crate::p04::broker::Phase04BrokerFactory;
use crate::p04::evidence::ToolEvidenceSource;
use crate::p04::service::{Phase04, Phase04Config};
use crate::p05::browser::url_policy::NavigationPolicy;
use crate::p05::computer::port::{DesktopPort, UnavailableDesktop};
use crate::p05::session::ActionBudget;
use crate::p05::{Phase05, Phase05Config};
use crate::p06::{Phase06, Phase06Config};
use crate::p08::{Phase08, Phase08Config, Phase08Platform};
use crate::model::bootstrap::{Appearance, Locale};
use crate::services::app_info::AppInfoService;
use crate::services::bootstrap::BootstrapService;
use crate::services::capability_availability::CapabilityAvailabilityService;
use crate::services::platform_info::PlatformInfoService;
use crate::services::runtime_status::RuntimeStatusService;
use crate::services::settings_facade::SettingsFacade;
use crate::settings::resolver::{HostFacts, HostLocalSettingsResolver, LiveSettingFacts};

/// جلسة المستدعي حين لا يمرّ الطلب عبر البوابة (اختبار الوحدة).
const LOCAL_SESSION: &str = "local-session";

/// حالة Phase-02 داخل المضيف: جاهز، أو سبب عدم الجاهزية للتشخيص.
enum Phase02Slot {
    Ready(Arc<Phase02>),
    Unavailable(String),
}

/// جسر الحقائق الحيّة إلى مُحلِّل الإعدادات.
struct LiveBridge(Arc<Phase02>);

impl LiveSettingFacts for LiveBridge {
    fn enabled_model_count(&self) -> Option<i32> {
        self.0.models.enabled_available_count().ok().map(|n| n.min(i32::MAX as u64) as i32)
    }

    fn default_model_id(&self) -> Option<String> {
        self.0.preferences.default_model().ok().flatten()
    }

    fn usable_provider_count(&self) -> Option<i32> {
        let p = &self.0;
        let mut count = 0;
        for d in p.providers.relevant().ok()? {
            let Ok(state) = p.providers.state(&d.id) else { continue };
            let key = p.secrets.status(&d);
            if state.enabled && p.providers.resolve_endpoint(&state).is_ok() && (!key.required || key.configured) {
                count += 1;
            }
        }
        Some(count)
    }

    fn network_contacted(&self) -> bool {
        self.0.live.network_contacted()
    }
}

/// أقصى انتظار لمكان مهمّة قبل الرفض: أقل من مهلة `mission.start` في العارض (600 ث).
const MISSION_SLOT_WAIT: std::time::Duration = std::time::Duration::from_secs(540);
const MISSION_SLOT_POLL: std::time::Duration = std::time::Duration::from_millis(500);

pub struct DesktopHost {
    app_info: AppInfoService,
    platform_info: PlatformInfoService,
    runtime_status: RuntimeStatusService,
    capability_availability: CapabilityAvailabilityService,
    settings: SettingsFacade,
    locale: Locale,
    appearance: Appearance,
    phase02: Phase02Slot,
    /// Phase-03 يعيش فوق مخزن Phase-02 نفسه. غيابه يتبع غياب Phase-02، فلا
    /// مخزن ثانٍ ولا مسار حياة مستقل.
    phase03: Option<Arc<Phase03>>,
    /// مصدر الأدلّة المقيسة المشترك. تملؤه أدوات التنفيذ الموثوقة عبر الطبقة الأصلية.
    trusted_tests: Arc<SharedTrustedTestEvidence>,
    /// مُشغّل المسابر المربوطة بالمهامّ. هو المدخل الوحيد الذي يستطيع إنتاج دليل
    /// مقيس لعقدة يصدر معرّفَها وقتُ التشغيل، فيُنفَّذ أثناء التشغيل لا قبله.
    probes: Arc<MissionProbeRunner>,
    /// Phase-04: المهارات والأدوات وخوادم MCP. يتبع المخزن نفسه كما يتبعه Phase-03.
    phase04: Option<Arc<Phase04>>,
    /// مصدر أدلّة الأدوات. تملؤه بوابة الأدوات وحدها، ويقرؤه زمن تشغيل المهمّة.
    tool_evidence: Arc<ToolEvidenceSource>,
    /// Phase-05: الذاكرة والمتصفّح وسطح المكتب. يتبع المخزن نفسه وبوابة Phase-04 نفسها.
    phase05: Option<Arc<Phase05>>,
    /// Phase-06: الموصلات والكلفة والرصد والإعدادات. يدخل الطبقات السابقة من منافذها وحدها.
    phase06: Option<Arc<Phase06>>,
    /// Phase-08: بيئة التنفيذ والمخرجات والمجدول والتكاملات. أدواته في سجل Phase-04 نفسه.
    phase08: Option<Arc<Phase08>>,
}

/// ما تقدّمه المنصّة لـPhase-05 ولا تعرفه النواة: منفذ سطح المكتب، وأصول تجهيزة
/// الاختبار (بناء القياس وحده). الافتراض: لا سطح مكتب، وسياسة المنتج بلا تجهيزة.
pub struct Phase05Platform {
    pub desktop: Arc<dyn DesktopPort>,
    pub navigation: NavigationPolicy,
}

impl Default for Phase05Platform {
    fn default() -> Self {
        Self { desktop: Arc::new(UnavailableDesktop("no desktop port is bound on this host")), navigation: NavigationPolicy::product() }
    }
}

impl DesktopHost {
    /// يبني المضيف من حقائق المنصّة. اللغة والمظهر الابتدائيان يُقرآن مرة واحدة
    /// عند الإقلاع من نظام التشغيل، ولا يُخمّنهما العارض.
    pub fn new(platform_info: PlatformInfoService) -> Self {
        Self::with_phase02(platform_info, Phase02Config::for_tests())
    }

    /// يبني المضيف مع Phase-02. فشل فتح المخزن لا يُسقط المضيف: القشرة تعمل،
    /// وميزات Phase-02 تُعلن غير متاحة بسببها.
    pub fn with_phase02(platform_info: PlatformInfoService, config: Phase02Config) -> Self {
        Self::with_platform(platform_info, config, Phase05Platform::default())
    }

    /// يبني المضيف مع منافذ Phase-05 التي تقدّمها المنصّة.
    pub fn with_platform(platform_info: PlatformInfoService, config: Phase02Config, p05_platform: Phase05Platform) -> Self {
        Self::with_platforms(platform_info, config, p05_platform, Phase08Platform::default())
    }

    /// يبني المضيف مع منافذ Phase-05 وPhase-08 التي تقدّمها المنصّة.
    pub fn with_platforms(platform_info: PlatformInfoService, config: Phase02Config, p05_platform: Phase05Platform, mut p08_platform: Phase08Platform) -> Self {
        // سياسة تنقّل واحدة للمتصفّحين: ما يسمّيه بناء القياس من أصول تجهيزة يسري عليهما معًا.
        p08_platform.navigation = p05_platform.navigation.clone();
        let locale = platform_info.initial_locale();
        let appearance = platform_info.initial_appearance();
        let facts = HostFacts::phase_01(locale, appearance);
        // منافذ الأسرار نفسها لموصلات Phase-06: المخزن ونافذة النظام والبيئة. تُنسخ قبل أن
        // يستهلك Phase-02 إعداده، فلا يملك Phase-06 مخزنًا ثانيًا.
        let credential_ports = (config.credential_store.clone(), config.credential_prompt.clone(), config.environment.clone());
        let phase02 = match Phase02::build(config) {
            Ok(p) => Phase02Slot::Ready(Arc::new(p)),
            Err(error) => Phase02Slot::Unavailable(error.to_string()),
        };
        let resolver = match &phase02 {
            Phase02Slot::Ready(p) => HostLocalSettingsResolver::with_live(facts, Arc::new(LiveBridge(p.clone()))),
            Phase02Slot::Unavailable(_) => HostLocalSettingsResolver::new(facts),
        };
        // مصدرا الأدلّة المقيسة: نتائج مُستوعَبة جاهزة، ومسابر تُنفَّذ عند الطلب
        // لعقدة صدر معرّفها وقت التشغيل. كلاهما يمرّ بقواعد المصدر الموثوق نفسها،
        // ولا يصل إليهما عارض ولا وكيل ولا مزوّد.
        let trusted_tests = Arc::new(SharedTrustedTestEvidence::new());
        let probes = Arc::new(MissionProbeRunner::new());
        // المصدر الثالث: أدلّة الأدوات. يمرّ بالقواعد نفسها، ولا يصل إليه عارض ولا وكيل.
        let tool_evidence = Arc::new(ToolEvidenceSource::new());
        let trusted_evidence: Arc<dyn crate::p03::port::TrustedEvidenceSource> = Arc::new(ChainedTrustedEvidence::new(vec![
            trusted_tests.clone(),
            probes.clone(),
            tool_evidence.clone(),
        ]));
        let phase04 = match &phase02 {
            Phase02Slot::Ready(p) => Phase04::build(Phase04Config {
                db: p.db.clone(),
                audit: p.audit.clone(),
                clock: RuntimeClock::system(),
                http: p.http.clone(),
                sources: p.sources.clone(),
                evidence: tool_evidence.clone(),
            })
            .ok()
            .map(Arc::new),
            Phase02Slot::Unavailable(_) => None,
        };
        // Phase-05 فوق المخزن نفسه والبوابة نفسها. أدواته تُسجَّل في سجل Phase-04،
        // وخطّافاه (السياق والمراقب) يُربطان بزمن تشغيل Phase-03 أدناه.
        let phase05 = match (&phase02, &phase04) {
            (Phase02Slot::Ready(p), Some(p04)) => {
                let downloads_root = p.db.path().and_then(|path| path.parent()).map(|dir| dir.join("p05-downloads"));
                Phase05::build(Phase05Config {
                    db: p.db.clone(),
                    audit: p.audit.clone(),
                    clock: RuntimeClock::system(),
                    http: p.http.clone(),
                    phase04: p04.clone(),
                    desktop: p05_platform.desktop.clone(),
                    navigation: p05_platform.navigation.clone(),
                    downloads_root,
                    budget: ActionBudget::default(),
                })
                .ok()
                .map(Arc::new)
            }
            _ => None,
        };
        // Phase-08 فوق المخزن نفسه والسجل نفسه، بعد Phase-05 لتدخل أدوات الويب مهارته.
        let phase08 = match (&phase02, &phase04) {
            (Phase02Slot::Ready(p), Some(p04)) => Phase08::build(Phase08Config {
                db: p.db.clone(),
                audit: p.audit.clone(),
                clock: RuntimeClock::system(),
                phase04: p04.clone(),
                http: p.http.clone(),
                credential_store: credential_ports.0.clone(),
                data_dir: p.db.path().and_then(|path| path.parent()).map(|dir| dir.to_path_buf()),
                platform: p08_platform,
            })
            .ok()
            .map(Arc::new),
            _ => None,
        };
        // Phase-06 فوق المخزن نفسه: حارس الاستدعاء في Phase-02، والسياسة المركَّبة ومراقب
        // النشاط في بوابة Phase-04، والموصلات أدواتٌ في سجلّها نفسه.
        let phase06 = match &phase02 {
            Phase02Slot::Ready(p) => Some(Arc::new(Phase06::build(Phase06Config {
                db: p.db.clone(),
                audit: p.audit.clone(),
                clock: RuntimeClock::system(),
                http: p.http.clone(),
                phase02: Some(p.clone()),
                phase04: phase04.clone(),
                phase05: phase05.clone(),
                sources: Some(p.sources.clone()),
                credential_store: credential_ports.0.clone(),
                credential_prompt: credential_ports.1.clone(),
                environment: credential_ports.2.clone(),
                diagnostics_dir: p.db.path().and_then(|path| path.parent()).map(|dir| dir.join("diagnostics")),
            }))),
            Phase02Slot::Unavailable(_) => None,
        };
        let context_provider = match &phase06 {
            Some(p06) => Some(p06.context.clone() as Arc<dyn crate::p03::port::AgentContextProvider>),
            None => phase05.as_ref().map(|p05| p05.hooks.clone() as Arc<dyn crate::p03::port::AgentContextProvider>),
        };
        let earlier_observer = match &phase06 {
            Some(p06) => Some(p06.observer.clone() as Arc<dyn crate::p03::port::MissionObserver>),
            None => phase05.as_ref().map(|p05| p05.hooks.clone() as Arc<dyn crate::p03::port::MissionObserver>),
        };
        // مراقب Phase-08 (تحرير الصندوق) يأتي بعد مراقبي المراحل السابقة، ولا يغيّر ما يرونه.
        let mission_observer = match (&phase08, earlier_observer) {
            // المحادثة تسجّل السرد و«يفكّر»، وتقرأ ولا تغيّر شيئًا في المهمّة.
            // الإشعارات آخرًا (ADR-042): بعد أن يحفظ الآخرون ما يخصّهم، تقول للمستخدم إن مهمّة انتهت أو تنتظره.
            (Some(p08), Some(earlier)) => Some(Arc::new(crate::p08::missions::ObserverChain(vec![earlier, p08.observer.clone(), p08.conversations.clone(), p08.notifications.clone()])) as Arc<dyn crate::p03::port::MissionObserver>),
            (Some(p08), None) => Some(Arc::new(crate::p08::missions::ObserverChain(vec![p08.observer.clone(), p08.conversations.clone(), p08.notifications.clone()])) as Arc<dyn crate::p03::port::MissionObserver>),
            (None, earlier) => earlier,
        };
        let broker_factory: Option<Arc<dyn crate::p03::port::ToolBrokerFactory>> = match (&phase06, &phase04) {
            (Some(p06), _) if p06.brokers.is_some() => p06.brokers.clone().map(|b| b as Arc<dyn crate::p03::port::ToolBrokerFactory>),
            (_, Some(p04)) => Some(Arc::new(Phase04BrokerFactory::new(p04.clone())) as Arc<dyn crate::p03::port::ToolBrokerFactory>),
            _ => None,
        };
        let phase03 = match &phase02 {
            Phase02Slot::Ready(p) => Some(Arc::new(Phase03::build(Phase03Config {
                db: p.db.clone(),
                audit: p.audit.clone(),
                clock: RuntimeClock::system(),
                // مسار استدعاء Phase-02 نفسه: التوجيه والمحلّية وبوابة الخروج
                // وحلّ السرّ كلها تبقى هناك، ولا يتجاوزها وكيل.
                invocations: Some(p.invocations.clone()),
                // مصدر الأدلّة المقيسة مربوط فعلًا، ويملؤه تنفيذٌ نملكه وحده.
                // يبدأ فارغًا: بلا قياس حقيقي تبقى ادّعاءات الوكلاء غير محقَّقة،
                // وهو الجواب الصادق لا نقصًا يُسدّ بمخرجات نموذج.
                trusted_evidence: Some(trusted_evidence.clone()),
                // طبقة الأدوات مربوطة فعلًا: الوكيل يقترح، والبوابة تقرّر.
                // ميزانية الأدوات لكل مهمّة من الإعدادات الفعلية لنطاقها (Phase-06)، وإلا
                // فالميزانية المحافظة نفسها التي أُغلق بها Phase-04.
                tools: broker_factory,
                // سياق المشروع مربوط فعلًا باستدعاء الوكيل، لا مُعلَنًا فقط.
                sources: Some(p.sources.clone()),
                // الذاكرة والملاحظات تصل إلى الوكيل بيانات موسومة، والمراقب يبني
                // ذاكرة الحلقة ويغلق الجلسات مع المهمّة.
                context: context_provider,
                observer: mission_observer,
            }))),
            Phase02Slot::Unavailable(_) => None,
        };
        if let (Some(p06), Some(p03)) = (&phase06, &phase03) {
            p06.bind_missions(p03.cancellation.clone());
        }
        // فحص الإقلاع (خطة 2026-10-07، ADR-041): قبل أن يبدأ أيّ تشغيل، لا مهمّة RUNNING بلا عملية، ولا مهمّة نهائية بخطوة
        // مفتوحة، والسلسلتان سليمتان. الكسر تنبيه مفتوح في لوحة الصحة بموضعه.
        if let Some(p03) = &phase03 {
            let check = p03.boot_check();
            if let Some(p06) = &phase06 {
                use crate::p06::observe::alerts::{AlertKind, AlertSeverity};
                if let Some((at_seq, _)) = &check.audit_chain_broken {
                    p06.observe.raise(AlertKind::TamperDetected, AlertSeverity::Critical, "audit_events", &format!("CHAIN_BROKEN_AT_{at_seq}"));
                }
                for (session, at_seq) in &check.session_chains_broken {
                    p06.observe.raise(AlertKind::TamperDetected, AlertSeverity::Critical, &format!("session:{session}"), &format!("CHAIN_BROKEN_AT_{at_seq}"));
                }
            }
        }
        if let (Some(p08), Some(p05)) = (&phase08, &phase05) {
            // إيقاف جلسة من واجهة الجلسات يبلغ متصفّح Chromium كما يبلغ متصفّح Phase-05.
            let browser = p08.browser.clone();
            p05.add_session_closer(Arc::new(move |session_id: &str| browser.close_session(session_id)));
            p08.bind_memory(p05.memory.clone());
        }
        if let (Some(p08), Some(p03)) = (&phase08, &phase03) {
            p03.bind_model_preferences(p08.preferences.clone());
            p03.bind_conversations(p08.conversations.clone());
            p08.conversations.bind(Arc::downgrade(p03));
            // أدوار محجوبة تجاوزتها محادثاتها قبل هذا الإصلاح: خطواتها المفتوحة تُغلق مرة عند الإقلاع (E-3).
            p08.conversations.close_superseded_turns();
            // لغة نصّ الإشعار (ADR-042): إعداد اللغة إن اختاره المستخدم، وإلا لغة النظام عند الإقلاع.
            if let Some(p06) = &phase06 {
                let config = p06.config.clone();
                let system = if locale == crate::model::bootstrap::Locale::Ar { "ar" } else { "en" };
                p08.notifications.bind_locale(Arc::new(move || {
                    let chosen = config.code("language.locale", &crate::p06::config::ConfigScope::global());
                    if chosen.is_empty() || chosen == "SYSTEM" { system.to_string() } else { chosen.to_ascii_lowercase() }
                }));
            }
            if let Some(p04) = &phase04 {
                // قياس عقد المهمّة (Phase-08): ملفات المساحة وسجلّ البوابة، قراءة فقط.
                p03.bind_contract_probe(Arc::new(crate::p08::contract_probe::WorkspaceContractProbe { workspaces: p08.workspaces.clone(), phase04: p04.clone() }));
            }
            // صور المرفقات لنموذج يعلن الرؤية (مكافأة Manus 2026-10-19): قراءة فقط من inputs/ بعد إعادة فحص التوقيع.
            p03.bind_image_source(Arc::new(crate::p08::attachments::AttachmentImages { attachments: p08.attachments.clone(), workspaces: p08.workspaces.clone() }));
            p08.scheduler.bind_launcher(Arc::new(crate::p08::missions::Phase03Launcher { phase03: Arc::downgrade(p03), preferences: p08.preferences.clone(), conversations: Some(p08.conversations.clone()) }));
            // PHASE-14 (CP-14-4): تشغيل مجدول لم تبدأ مهمّته أو أُلغي لحاجة موافقة يُعلَن «يحتاج انتباهك».
            let notifications = p08.notifications.clone();
            p08.scheduler.bind_attention(Arc::new(move || {
                notifications.emit(crate::p08::notify::NotificationKind::MissionNeedsAttention);
            }));
        }
        Self {
            app_info: AppInfoService::new(),
            platform_info,
            runtime_status: RuntimeStatusService::new(),
            capability_availability: CapabilityAvailabilityService::new(),
            settings: SettingsFacade::new(Box::new(resolver)),
            locale,
            appearance,
            phase02,
            phase03,
            trusted_tests,
            probes,
            phase04,
            tool_evidence,
            phase05,
            phase06,
            phase08,
        }
    }

    /// Phase-08 إن كان جاهزًا.
    pub fn phase08(&self) -> Option<&Arc<Phase08>> {
        self.phase08.as_ref()
    }

    /// Phase-06 إن كان جاهزًا.
    pub fn phase06(&self) -> Option<&Arc<Phase06>> {
        self.phase06.as_ref()
    }

    /// يثبّت السياسة المُدارة (Phase-07) في مستوى تحكّم الإعدادات. بلا Phase-06 (المخزن
    /// غير متاح) لا إعدادات تُدار، ويعاد صفر. التثبيت يُدقَّق بمعرّف السياسة وخلاصتها.
    pub fn apply_managed_policy(&self, policy: &crate::p07::policy::LoadedPolicy) -> usize {
        let Some(p06) = &self.phase06 else { return 0 };
        let applied = p06.config.set_managed(policy.rows.clone());
        if policy.state != crate::p07::policy::PolicyState::NotConfigured {
            if let Phase02Slot::Ready(p02) = &self.phase02 {
                let outcome = match policy.state {
                    crate::p07::policy::PolicyState::Applied => crate::audit::AuditOutcome::Success,
                    _ => crate::audit::AuditOutcome::Denied,
                };
                let _ = p02.audit.append(&crate::audit::AuditRecord::new(
                    crate::audit::AuditEventType::ConfigChanged,
                    "managed-policy",
                    policy.policy_id.clone().unwrap_or_else(|| "invalid".into()),
                    outcome,
                    serde_json::json!({ "state": policy.state, "settings": applied, "sha256": policy.sha256, "reason": policy.reason_code }),
                ));
            }
        }
        applied
    }

    /// Phase-05 إن كان جاهزًا.
    pub fn phase05(&self) -> Option<&Arc<Phase05>> {
        self.phase05.as_ref()
    }

    /// Phase-03 إن كان جاهزًا.
    pub fn phase03(&self) -> Option<&Arc<Phase03>> {
        self.phase03.as_ref()
    }

    /// مصدر الأدلّة المقيسة، لتملأه أدوات التنفيذ الموثوقة. لا يعبر إلى العارض.
    pub fn trusted_tests(&self) -> &Arc<SharedTrustedTestEvidence> {
        &self.trusted_tests
    }

    /// مُشغّل المسابر، لتسجّل فيه الطبقةُ الأصلية الموثوقة مسابر مهمّة. لا عملية
    /// IPC تصل إليه: العارض يستطيع أن يطلب تشغيل مهمّة، ولا يستطيع أن يقرّر نتيجة قياس.
    pub fn probes(&self) -> &Arc<MissionProbeRunner> {
        &self.probes
    }

    /// Phase-04 إن كان جاهزًا.
    pub fn phase04(&self) -> Option<&Arc<Phase04>> {
        self.phase04.as_ref()
    }

    /// مصدر أدلّة الأدوات. للقراءة في طبقة القياس؛ لا عملية IPC تصل إليه.
    pub fn tool_evidence(&self) -> &Arc<ToolEvidenceSource> {
        &self.tool_evidence
    }

    /// Phase-02 إن كان جاهزًا.
    pub fn phase02(&self) -> Option<&Arc<Phase02>> {
        match &self.phase02 {
            Phase02Slot::Ready(p) => Some(p),
            Phase02Slot::Unavailable(_) => None,
        }
    }

    /// سبب عدم الجاهزية، للتشخيص على جانب المضيف فقط.
    pub fn phase02_failure(&self) -> Option<&str> {
        match &self.phase02 {
            Phase02Slot::Ready(_) => None,
            Phase02Slot::Unavailable(reason) => Some(reason),
        }
    }

    /// الحقائق التي تُحسب منها الإتاحة الآن.
    pub fn capability_facts(&self) -> CapabilityFacts {
        match &self.phase02 {
            Phase02Slot::Unavailable(_) => CapabilityFacts { phase02: Phase02State::StoreUnavailable, selectable_models: 0 },
            Phase02Slot::Ready(p) => {
                let selectable_models = list_views(&p.providers, &p.secrets, &p.models, &p.preferences, None)
                    .map(|views| views.iter().filter(|v| selectable(v)).count() as u64)
                    .unwrap_or(0);
                CapabilityFacts { phase02: Phase02State::Ready, selectable_models }
            }
        }
    }

    pub fn locale(&self) -> Locale {
        self.locale
    }

    pub fn appearance(&self) -> Appearance {
        self.appearance
    }

    /// ينفّذ عملية موجَّهة. الاستدعاء لا يحدث إلا بعد أن أثبتت البوابة التوجيه.
    pub fn handle(&self, operation: &str, payload: &Value) -> Result<Value, HostError> {
        self.handle_as(operation, payload, LOCAL_SESSION)
    }

    /// كالسابق، مع جلسة المستدعي كما ختمها النقل.
    pub fn handle_as(&self, operation: &str, payload: &Value, session: &str) -> Result<Value, HostError> {
        match operation {
            "desktop.bootstrap" => BootstrapService {
                app_info: &self.app_info,
                platform_info: &self.platform_info,
                runtime_status: &self.runtime_status,
            }
            .result_with(self.locale, self.appearance, &self.capability_facts()),
            "desktop.runtime.status" => Ok(self.runtime_status.result()),
            "desktop.capability.availability" => self.capability_availability.result_with(payload, &self.capability_facts()),
            "desktop.settings.describe" => self.settings.describe(payload),
            "desktop.settings.read" => self.settings.read(payload),
            "provider.list" | "provider.configure" | "provider.credential.set" | "provider.credential.clear" | "provider.refresh"
            | "model.list" | "model.configure" | "model.preferences.set" | "model.invoke" | "model.cancel" | "project.list"
            | "project.get" | "project.create" | "project.update" | "project.archive" | "context.add" | "context.remove"
            | "context.preview" | "context.assemble" | "provider.catalog" | "provider.credential.put" | "provider.custom.save"
            | "provider.custom.delete" => match &self.phase02 {
                Phase02Slot::Ready(p) => crate::p02::ipc::handle(p, operation, payload, session),
                Phase02Slot::Unavailable(reason) => Err(HostError::new(
                    crate::ipc::errors::DesktopErrorCategory::ConfigUnavailable,
                    "DEPENDENCY_UNAVAILABLE",
                    format!("phase-02 store is unavailable: {reason}"),
                )),
            },
            "mission.list" | "mission.get" | "mission.create" | "mission.start" | "mission.cancel" | "mission.resume"
            | "task.list" | "agent.list" | "claim.list" | "evidence.list" => match &self.phase03 {
                Some(p) => {
                    // حدّ المهامّ المتزامنة (Phase-06): إعداد مقصوص بحدّ الأمان، يُفحص قبل البدء.
                    // قِيس 2026-11-13: ثلاث مهامّ معًا والحدّ 2 ⇒ رُفضت الثالثة «CONFLICT» وأسقط العارض الرفض، فبقيت «يبدأ…» للأبد.
                    // الآن تنتظر الثالثة مكانًا (حتى تسع دقائق، دون مهلة البدء في العارض) وتبدأ وحدها حين يفرغ.
                    if operation == "mission.start" {
                        if let (Some(p06), Some(id)) = (&self.phase06, payload.get("mission_id").and_then(Value::as_str)) {
                            let limit = p06.config.uint("agents.max_concurrent_missions", &crate::p06::config::ConfigScope::global()) as usize;
                            let deadline = std::time::Instant::now() + MISSION_SLOT_WAIT;
                            while !p.cancellation.reserve(id, limit) {
                                if std::time::Instant::now() >= deadline {
                                    let running = p.cancellation.running_count();
                                    return Err(HostError::new(
                                        crate::ipc::errors::DesktopErrorCategory::ConfigUnavailable,
                                        "CONFLICT",
                                        format!("MAX_CONCURRENT_MISSIONS: {running} mission(s) are running and the limit is {limit}"),
                                    ));
                                }
                                std::thread::sleep(MISSION_SLOT_POLL);
                            }
                            let outcome = crate::p03::ipc::handle(p, operation, payload, session);
                            // بدء رُفض قبل أن يُسجَّل (مهمّة منتهية، سجلّ مكسور): الحجز لا يبقى محتجزًا.
                            p.cancellation.release(id);
                            return outcome;
                        }
                    }
                    crate::p03::ipc::handle(p, operation, payload, session)
                }
                None => Err(HostError::new(
                    crate::ipc::errors::DesktopErrorCategory::ConfigUnavailable,
                    "DEPENDENCY_UNAVAILABLE",
                    "phase-03 is unavailable because the local store is unavailable",
                )),
            },
            "skill.list" | "skill.get" | "skill.configure" | "tool.list" | "tool.get" | "tool.activity.list" | "mcp.list"
            | "mcp.register" | "mcp.configure" | "mcp.refresh" | "approval.list" | "tool.approval.respond" | "tool.approval.grants"
            | "tool.approval.grant.revoke" => match &self.phase04 {
                Some(p) => crate::p04::ipc::handle(p, operation, payload, session),
                None => Err(HostError::new(
                    crate::ipc::errors::DesktopErrorCategory::ConfigUnavailable,
                    "DEPENDENCY_UNAVAILABLE",
                    "phase-04 is unavailable because the local store is unavailable",
                )),
            },
            "memory.list" | "memory.get" | "memory.delete" | "browser.session.list" | "browser.session.get" | "browser.session.cancel"
            | "computer.session.list" | "computer.session.get" | "computer.session.cancel" | "computer.window.list"
            | "computer.target.grant" | "computer.target.revoke" => match &self.phase05 {
                Some(p) => crate::p05::ipc::handle(p, self.phase03.as_deref(), operation, payload, session),
                None => Err(HostError::new(
                    crate::ipc::errors::DesktopErrorCategory::ConfigUnavailable,
                    "DEPENDENCY_UNAVAILABLE",
                    "phase-05 is unavailable because the local store is unavailable",
                )),
            },
            "connector.list" | "connector.get" | "connector.register" | "connector.configure" | "connector.remove" | "connector.test"
            | "connector.credential.set" | "connector.credential.clear" | "connector.openapi.import" | "connector.openapi.approve" | "connector.preset.list" | "connector.preset.register"
            | "usage.summary" | "usage.list" | "budget.list" | "budget.set" | "budget.remove" | "pricing.list" | "pricing.set"
            | "pricing.remove" | "observability.health" | "observability.events" | "observability.metrics" | "observability.errors"
            | "observability.alerts" | "diagnostics.export" | "config.describe" | "config.effective" | "config.set" | "config.reset" => {
                match &self.phase06 {
                    Some(p) => crate::p06::ipc::handle(p, self.phase03.as_deref(), operation, payload, session),
                    None => Err(HostError::new(
                        crate::ipc::errors::DesktopErrorCategory::ConfigUnavailable,
                        "DEPENDENCY_UNAVAILABLE",
                        "phase-06 is unavailable because the local store is unavailable",
                    )),
                }
            }
            "workspace.list" | "workspace.preview" | "workspace.export" | "attachment.stage" | "attachment.discard" | "attachment.artifact.stage"
            | "attachment.list" | "attachment.bind" | "artifact.list" | "artifact.get" | "execution.status" | "execution.runs"
            | "execution.runtime.prepare" | "mission.model.set" | "schedule.list" | "schedule.save" | "schedule.enable"
            | "schedule.delete" | "schedule.run_now" | "oauth.list" | "oauth.connect" | "oauth.disconnect" | "voice.transcribe"
            | "share.list" | "share.set" | "publish.list" | "publish.propose" | "publish.decide" | "skill.package.list"
            | "skill.package.import" | "device.export" | "device.import" | "integration.settings.set" | "conversation.begin"
            | "conversation.continue" | "conversation.get" | "conversation.index" | "agent.catalog" | "mission.specialist.set" | "conversation.update" | "conversation.delete" | "project.delete" | "memory.remember" | "conversation.search" | "mission.trace" | "mcp.tool.accept_redefinition"
            | "web.search.status" | "web.search.credential.put" | "web.search.test" | "mission.rating.set" | "mission.note.add" | "memory.semantic.status" | "memory.semantic.set" | "memory.semantic.test"
            | "github.status" | "github.connect" | "github.disconnect" => match &self.phase08 {
                Some(p) => crate::p08::ipc::handle(p, operation, payload),
                None => Err(HostError::new(
                    crate::ipc::errors::DesktopErrorCategory::ConfigUnavailable,
                    "DEPENDENCY_UNAVAILABLE",
                    "phase-08 is unavailable because the local store is unavailable",
                )),
            },
            // ليس فرعًا عامًّا: الوصول إلى هنا يعني أن السجل أعلن عملية لا مالك لها
            // في هذا المضيف، وهو عيب بناء يُبلَّغ ولا يُعالَج بمنطق عام.
            other => Err(HostError::internal(format!(
                "routed operation {other} has no owning service in this host"
            ))),
        }
    }
}

impl Default for DesktopHost {
    fn default() -> Self {
        Self::new(PlatformInfoService::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::registry::DesktopIpcRegistry;

    #[test]
    fn every_phase04_operation_is_named_in_the_router_and_in_the_ipc_owner() {
        let source = include_str!("host.rs");
        for record in &DesktopIpcRegistry::phase04().operations {
            assert!(source.contains(&format!("\"{}\"", record.operation)), "{} is not routed", record.operation);
            assert!(crate::p04::ipc::OPERATIONS.contains(&record.operation.as_str()));
        }
        assert_eq!(crate::p04::ipc::OPERATIONS.len(), DesktopIpcRegistry::phase04().operations.len());
        // ولا اسم تنفيذ أداة في المُوجِّه أصلًا.
        for forbidden in crate::p04::ipc::FORBIDDEN_OPERATIONS {
            assert!(!source.contains(&format!("\"{forbidden}\"")), "{forbidden} appears in the router");
        }
    }

    #[test]
    fn every_phase05_operation_is_named_in_the_router_and_in_the_ipc_owner() {
        let source = include_str!("host.rs");
        for record in &DesktopIpcRegistry::phase05().operations {
            assert!(source.contains(&format!("\"{}\"", record.operation)), "{} is not routed", record.operation);
            assert!(crate::p05::ipc::OPERATIONS.contains(&record.operation.as_str()));
        }
        assert_eq!(crate::p05::ipc::OPERATIONS.len(), DesktopIpcRegistry::phase05().operations.len());
        for forbidden in crate::p05::ipc::FORBIDDEN_OPERATIONS {
            assert!(!source.contains(&format!("\"{forbidden}\"")), "{forbidden} appears in the router");
        }
        // تجهيزة سطح المكتب لا تُربط في تركيب المنتج أبدًا.
        assert!(!source.contains(&["Fixture", "Desktop"].concat()), "the test desktop fixture is wired into the host");
    }

    #[test]
    fn phase05_registers_its_tools_and_skills_in_the_phase04_registry_without_refusal() {
        let host = DesktopHost::default();
        let p05 = host.phase05().expect("phase-05 builds on the in-memory store");
        assert!(p05.refused_registrations.is_empty(), "the registry refused: {:?}", p05.refused_registrations);
        let p04 = host.phase04().unwrap();
        for tool in ["polaris.web.navigate", "polaris.desktop.click", "polaris.memory.propose"] {
            assert!(p04.gateway.state.lock().unwrap().tools.get(tool).is_some(), "{tool} is not registered");
        }
    }

    #[test]
    fn every_phase08_operation_is_named_in_the_router_and_in_the_ipc_owner() {
        let source = include_str!("host.rs");
        for record in &DesktopIpcRegistry::phase08().operations {
            assert!(source.contains(&format!("\"{}\"", record.operation)), "{} is not routed", record.operation);
            assert!(crate::p08::ipc::OPERATIONS.contains(&record.operation.as_str()));
        }
        assert_eq!(crate::p08::ipc::OPERATIONS.len(), DesktopIpcRegistry::phase08().operations.len());
        for forbidden in crate::p08::ipc::FORBIDDEN_OPERATIONS {
            assert!(!source.contains(&format!("\"{forbidden}\"")), "{forbidden} appears in the router");
        }
    }

    #[test]
    fn phase08_registers_its_tools_in_the_phase04_registry_without_refusal() {
        let host = DesktopHost::default();
        let p08 = host.phase08().expect("phase-08 builds on the in-memory store");
        assert!(p08.refused_registrations.is_empty(), "the registry refused: {:?}", p08.refused_registrations);
        let p04 = host.phase04().unwrap();
        for tool in ["polaris.execution.command", "polaris.execution.python", "polaris.artifact.document", "polaris.workspace.read"] {
            assert!(p04.gateway.state.lock().unwrap().tools.get(tool).is_some(), "{tool} is not registered");
        }
    }

    #[test]
    fn every_phase02_operation_is_named_in_the_router_and_in_the_ipc_owner() {
        let source = include_str!("host.rs");
        for record in &DesktopIpcRegistry::phase02().operations {
            assert!(source.contains(&format!("\"{}\"", record.operation)), "{} is not routed", record.operation);
            assert!(crate::p02::ipc::OPERATIONS.contains(&record.operation.as_str()));
        }
        assert_eq!(crate::p02::ipc::OPERATIONS.len(), DesktopIpcRegistry::phase02().operations.len());
    }

    #[test]
    fn every_routed_operation_in_the_registry_has_an_owning_service() {
        let host = DesktopHost::default();
        for operation in DesktopIpcRegistry::shared().routed_operations() {
            let payload = match operation {
                "desktop.capability.availability" => {
                    serde_json::json!({ "capability_ids": ["polaris.desktop.home"] })
                }
                "desktop.settings.read" => serde_json::json!({ "section_id": "general.appearance" }),
                _ => serde_json::json!({}),
            };
            assert!(
                host.handle(operation, &payload).is_ok(),
                "{operation} has no working owner"
            );
        }
    }
}
