// بوابة الأدوات: المسار الوحيد الذي يعبره كل أثر جانبي لأداة.
//
// الترتيب هنا قاعدة أمان لا تفضيل، وكل خطوة تسبق ما بعدها لأن ما بعدها لا يمكن
// التراجع عنه:
//   ١  الإلغاء          — مهمّة مُلغاة لا تبدأ نداءً جديدًا.
//   ٢  النطاق           — الطلب يخصّ هذه المهمّة، وإلا فهو عبور بين مهامّ.
//   ٣  المهارة          — معروفة ومفعّلة.
//   ٤  الأداة           — مسجَّلة، وتسمّيها المهارة، ومفعّلة، ولها محوّل. الاسم
//                          الحرّ ليس أداة، ويُقال ذلك بعينه بدل «مهارتك لا تسمح».
//   ٥  المخطط           — الحجج تجتاز عقد الأداة قبل أي تنفيذ.
//   ٦  القدرة           — كل أثر مُعلن داخل مِنحة زمن التشغيل الثابتة.
//   ٧  سياسة الشبكة     — الوجهة هي الحلقة المحلية أو لا وجهة.
//   ٨  حالة الخادم      — أداة MCP لا تُنفَّذ من خادم معطّل.
//   ٩  الميزانية        — حجزٌ قبل الإنفاق، لا محاسبة بعده.
//   ١٠ الموافقة         — مربوطة، وغير منتهية، ولم تُستهلك.
//   ١١ التنفيذ          — بمهلة مشتقّة من الميزانية وبرمز إلغاء حيّ.
//   ١٢ التسوية والتدقيق والدليل.
//
// ولا يوجد مسار ثانٍ: لا عملية IPC تنفّذ أداة، ولا محوّل يُستدعى من خارج هنا،
// ولا وكيل يملك مرجعًا إلى محوّل.

use std::sync::{Arc, Mutex};

use serde_json::Value;

use polaris_host_providers::net::CancelToken;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;

use super::activity::{ActivityLog, InvocationStatus, ToolInvocationRecord};
use super::adapter::{bounded, ToolAdapter, ToolAssessContext, ToolCallContext, ToolFailure};
use super::approval::{
    ApprovalBinding, ApprovalRecord, ApprovalRefusal, ApprovalStatus, ApprovalStore, DEFAULT_APPROVAL_TTL_MS,
};
use super::budget::{CallShape, ToolBudgetLedger};
use super::effect::{self, ToolEffect};
use super::evidence::{ToolEvidenceRecord, ToolEvidenceSource};
use super::mcp::model::McpServer;
use super::skill::SkillRegistry;
use super::tool::{NetworkPolicy, ToolDescriptor, ToolProvider, ToolRegistry, ToolTrustClass};

/// سبب رفض أو نهاية غير ناجحة. مغلق، ومطابق لمفردات العقد حرفًا بحرف.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DenialReason {
    UnknownTool,
    ToolDisabled,
    SkillDisabled,
    SkillDoesNotAllowTool,
    ArgumentsInvalid,
    CapabilityMissing,
    EffectNotPermitted,
    NetworkPolicyDenied,
    ApprovalRequired,
    ApprovalMissing,
    ApprovalMismatch,
    ApprovalExpired,
    ApprovalAlreadyUsed,
    ApprovalDenied,
    BudgetExhausted,
    CrossMissionDenied,
    ServerDisabled,
    ServerUnreachable,
    SchemaDrift,
    ResultTooLarge,
    ResultMalformed,
    SecretRequested,
    Cancelled,
}

impl DenialReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UnknownTool => "UNKNOWN_TOOL",
            Self::ToolDisabled => "TOOL_DISABLED",
            Self::SkillDisabled => "SKILL_DISABLED",
            Self::SkillDoesNotAllowTool => "SKILL_DOES_NOT_ALLOW_TOOL",
            Self::ArgumentsInvalid => "ARGUMENTS_INVALID",
            Self::CapabilityMissing => "CAPABILITY_MISSING",
            Self::EffectNotPermitted => "EFFECT_NOT_PERMITTED",
            Self::NetworkPolicyDenied => "NETWORK_POLICY_DENIED",
            Self::ApprovalRequired => "APPROVAL_REQUIRED",
            Self::ApprovalMissing => "APPROVAL_MISSING",
            Self::ApprovalMismatch => "APPROVAL_MISMATCH",
            Self::ApprovalExpired => "APPROVAL_EXPIRED",
            Self::ApprovalAlreadyUsed => "APPROVAL_ALREADY_USED",
            Self::ApprovalDenied => "APPROVAL_DENIED",
            Self::BudgetExhausted => "BUDGET_EXHAUSTED",
            Self::CrossMissionDenied => "CROSS_MISSION_DENIED",
            Self::ServerDisabled => "SERVER_DISABLED",
            Self::ServerUnreachable => "SERVER_UNREACHABLE",
            Self::SchemaDrift => "SCHEMA_DRIFT",
            Self::ResultTooLarge => "RESULT_TOO_LARGE",
            Self::ResultMalformed => "RESULT_MALFORMED",
            Self::SecretRequested => "SECRET_REQUESTED",
            Self::Cancelled => "CANCELLED",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Some(match code {
            "UNKNOWN_TOOL" => Self::UnknownTool,
            "TOOL_DISABLED" => Self::ToolDisabled,
            "SKILL_DISABLED" => Self::SkillDisabled,
            "SKILL_DOES_NOT_ALLOW_TOOL" => Self::SkillDoesNotAllowTool,
            "ARGUMENTS_INVALID" => Self::ArgumentsInvalid,
            "CAPABILITY_MISSING" => Self::CapabilityMissing,
            "EFFECT_NOT_PERMITTED" => Self::EffectNotPermitted,
            "NETWORK_POLICY_DENIED" => Self::NetworkPolicyDenied,
            "APPROVAL_REQUIRED" => Self::ApprovalRequired,
            "APPROVAL_MISSING" => Self::ApprovalMissing,
            "APPROVAL_MISMATCH" => Self::ApprovalMismatch,
            "APPROVAL_EXPIRED" => Self::ApprovalExpired,
            "APPROVAL_ALREADY_USED" => Self::ApprovalAlreadyUsed,
            "APPROVAL_DENIED" => Self::ApprovalDenied,
            "BUDGET_EXHAUSTED" => Self::BudgetExhausted,
            "CROSS_MISSION_DENIED" => Self::CrossMissionDenied,
            "SERVER_DISABLED" => Self::ServerDisabled,
            "SERVER_UNREACHABLE" => Self::ServerUnreachable,
            "SCHEMA_DRIFT" => Self::SchemaDrift,
            "RESULT_TOO_LARGE" => Self::ResultTooLarge,
            "RESULT_MALFORMED" => Self::ResultMalformed,
            "SECRET_REQUESTED" => Self::SecretRequested,
            "CANCELLED" => Self::Cancelled,
            _ => return None,
        })
    }

    /// كل الأسباب، بترتيب ثابت. يُستعمل في اختبار التطابق مع العقد.
    pub const ALL: [DenialReason; 23] = [
        Self::UnknownTool,
        Self::ToolDisabled,
        Self::SkillDisabled,
        Self::SkillDoesNotAllowTool,
        Self::ArgumentsInvalid,
        Self::CapabilityMissing,
        Self::EffectNotPermitted,
        Self::NetworkPolicyDenied,
        Self::ApprovalRequired,
        Self::ApprovalMissing,
        Self::ApprovalMismatch,
        Self::ApprovalExpired,
        Self::ApprovalAlreadyUsed,
        Self::ApprovalDenied,
        Self::BudgetExhausted,
        Self::CrossMissionDenied,
        Self::ServerDisabled,
        Self::ServerUnreachable,
        Self::SchemaDrift,
        Self::ResultTooLarge,
        Self::ResultMalformed,
        Self::SecretRequested,
        Self::Cancelled,
    ];
}

/// طلب استدعاء أداة كما يقدّمه زمن التشغيل الموثوق بعد أن تحقّق من اقتراح النموذج.
#[derive(Debug, Clone)]
pub struct ToolInvocationRequest {
    pub mission_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub skill_id: String,
    pub tool_id: String,
    pub arguments: Value,
    pub reason: String,
    /// قاعدة الاثنين (ADR-041): يضعه زمن التشغيل حين تجتمع [A] و[B] و[C]، فيحتاج الفعل موافقة بشرية مهما قالت سياسته.
    pub require_human: bool,
}

/// جلسة أدوات مهمّة واحدة: ميزانيتها، ونطاقها، ورمز إلغائها.
///
/// وجودها هو ما يجعل «عبر المهامّ» قابلًا للقياس: الطلب يحمل معرّف مهمّة، والجلسة
/// تحمل معرّف مهمّة، واختلافهما رفضٌ لا تصحيح.
pub struct MissionToolSession {
    pub mission_id: String,
    pub project_id: Option<String>,
    pub budget: ToolBudgetLedger,
    pub cancel: CancelToken,
}

impl MissionToolSession {
    pub fn new(mission_id: impl Into<String>, project_id: Option<String>, budget: ToolBudgetLedger, cancel: CancelToken) -> Self {
        Self { mission_id: mission_id.into(), project_id, budget, cancel }
    }
}

/// حالة البوابة المشتركة. قفل واحد: الكتابات قصيرة والقراءة متسقة.
#[derive(Default)]
pub struct GatewayState {
    pub skills: SkillRegistry,
    pub tools: ToolRegistry,
    pub servers: Vec<McpServer>,
    pub approvals: ApprovalStore,
    pub activity: ActivityLog,
    /// المحوّلات، بمعرّف الأداة. لا يوجد محوّل بلا واصف مسجَّل.
    pub adapters: Vec<(String, Arc<dyn ToolAdapter>)>,
    /// أدوات MCP أُعيد تعريفها ولم يقبل المستخدم تعريفها الجديد بعد (خطة 2026-10-07، ADR-041، ASI04).
    pub redefined: Vec<String>,
    /// منح «اسمح لهذه المهمّة» (ADR-042). في الذاكرة وحدها: إعادة التشغيل تُسقطها.
    pub mission_grants: crate::p04::mission_grant::MissionGrants,
}

impl GatewayState {
    pub fn adapter(&self, tool_id: &str) -> Option<Arc<dyn ToolAdapter>> {
        self.adapters.iter().find(|(id, _)| id == tool_id).map(|(_, a)| a.clone())
    }

    pub fn set_adapter(&mut self, tool_id: &str, adapter: Arc<dyn ToolAdapter>) {
        match self.adapters.iter_mut().find(|(id, _)| id == tool_id) {
            Some(slot) => slot.1 = adapter,
            None => self.adapters.push((tool_id.to_string(), adapter)),
        }
    }

    pub fn remove_server_adapters(&mut self, server_id: &str) {
        let ids: Vec<String> = self.tools.server_tools(server_id).iter().map(|t| t.tool_id.clone()).collect();
        self.adapters.retain(|(id, _)| !ids.contains(id));
    }

    pub fn server(&self, server_id: &str) -> Option<&McpServer> {
        self.servers.iter().find(|s| s.server_id == server_id)
    }
}

/// ما قرأته البوابة من السجل قبل أن تُفلت القفل.
struct Ready {
    descriptor: ToolDescriptor,
    adapter: Arc<dyn ToolAdapter>,
    /// حالة الخادم وسقفه، لأدوات MCP وحدها. `None` تعني أداة مدمجة.
    server_state: Option<Option<(super::mcp::model::McpServerState, Vec<ToolEffect>)>>,
}

/// نتيجة قراءة السجل: جاهز للتنفيذ، أو رفض بسببه. يعيش خارج نطاق القفل عمدًا.
///
/// الفرع الجاهز مُحتوى في صندوق: حجمه أكبر من فرع الرفض بكثير، وحمله في كل نداء
/// رفض إنفاقٌ بلا سبب.
enum Lookup {
    Ready(Box<Ready>),
    Deny(DenialReason, Vec<ToolEffect>, String),
}

/// نتيجة عبور البوابة: السجل دائمًا، والموافقة المعلّقة إن طُلبت.
#[derive(Debug, Clone)]
pub struct GatewayOutcome {
    pub record: ToolInvocationRecord,
    pub pending_approval: Option<ApprovalRecord>,
    /// ملاحظة الأداة للجولة التالية (Phase-08). لا تُحفظ في سجل الاستدعاء، ولا تُحسب دليلًا.
    pub observation: Option<String>,
}

impl GatewayOutcome {
    pub fn succeeded(&self) -> bool {
        self.record.status == InvocationStatus::Succeeded
    }
}

/// سياسة مركَّبة فوق البوابة (Phase-06: الخصوصية والإعدادات). تمنع ولا توسّع: حكمها
/// رفضٌ بسبب أو لا شيء، فلا طريق تُسقط منه موافقةً أو قدرةً أو ميزانية.
pub trait ToolPolicyOverlay: Send + Sync {
    fn check(&self, descriptor: &ToolDescriptor, context: &ToolAssessContext<'_>) -> Option<String>;
}

/// البوابة.
pub struct ToolGateway {
    pub state: Mutex<GatewayState>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
    evidence: Arc<ToolEvidenceSource>,
    /// غيابها يعني ترتيب Phase-04/05 كما أُغلق.
    overlay: std::sync::OnceLock<Arc<dyn ToolPolicyOverlay>>,
}

impl ToolGateway {
    pub fn new(state: GatewayState, audit: Arc<AuditLedger>, clock: RuntimeClock, evidence: Arc<ToolEvidenceSource>) -> Self {
        Self { state: Mutex::new(state), audit, clock, evidence, overlay: std::sync::OnceLock::new() }
    }

    /// يركّب السياسة المركَّبة مرّة واحدة. تركيب ثانٍ يُرفض.
    pub fn install_overlay(&self, overlay: Arc<dyn ToolPolicyOverlay>) -> bool {
        self.overlay.set(overlay).is_ok()
    }

    pub fn evidence(&self) -> &Arc<ToolEvidenceSource> {
        &self.evidence
    }

    fn record_audit(&self, event: AuditEventType, subject: &str, outcome: AuditOutcome, detail: Value) {
        let _ = self.audit.append(&AuditRecord::new(event, "tool", subject, outcome, detail));
    }

    /// يبني سجلًّا مرفوضًا. الرفض يُسجَّل كاملًا: من طلب، وماذا، ولماذا مُنع.
    #[allow(clippy::too_many_arguments)]
    fn denied(
        &self,
        request: &ToolInvocationRequest,
        invocation_id: String,
        reason: DenialReason,
        effects: Vec<ToolEffect>,
        arguments_digest: String,
        started_at: String,
        detail: String,
        approval_id: Option<String>,
    ) -> GatewayOutcome {
        let status = match reason {
            DenialReason::ApprovalRequired => InvocationStatus::AwaitingApproval,
            DenialReason::Cancelled => InvocationStatus::Cancelled,
            _ => InvocationStatus::Denied,
        };
        let record = ToolInvocationRecord {
            invocation_id: invocation_id.clone(),
            mission_id: request.mission_id.clone(),
            task_id: request.task_id.clone(),
            agent_id: request.agent_id.clone(),
            skill_id: request.skill_id.clone(),
            tool_id: request.tool_id.clone(),
            status,
            denial_reason: Some(reason.as_str().to_string()),
            effects,
            arguments_digest,
            result_digest: None,
            evidence_id: None,
            approval_id,
            // سبب الرفض مع إرشاده (B6)، ضمن حدّ العقد (2000).
            summary: bounded(&detail, DENIAL_SUMMARY_MAX_CHARS),
            started_at,
            duration_ms: 0,
        };
        self.record_audit(
            AuditEventType::ToolDenied,
            &invocation_id,
            if status == InvocationStatus::AwaitingApproval { AuditOutcome::Started } else { AuditOutcome::Denied },
            serde_json::json!({
                "mission_id": request.mission_id,
                "task_id": request.task_id,
                "tool_id": request.tool_id,
                "skill_id": request.skill_id,
                "reason": reason.as_str(),
                "arguments_digest": record.arguments_digest,
            }),
        );
        if let Ok(mut state) = self.state.lock() {
            state.activity.push(record.clone());
        }
        GatewayOutcome { record, pending_approval: None, observation: None }
    }

    /// المسار الكامل.
    pub fn invoke(&self, session: &mut MissionToolSession, request: ToolInvocationRequest) -> GatewayOutcome {
        let invocation_id = self.clock.id();
        let started_at = self.clock.now();
        let now_ms = self.clock.now_millis();
        let arguments_digest = crate::digest::sha256_hex(canonical_arguments(&request.arguments).as_bytes());
        let deny = |reason: DenialReason, effects: Vec<ToolEffect>, detail: String| {
            self.denied(
                &request,
                invocation_id.clone(),
                reason,
                effects,
                arguments_digest.clone(),
                started_at.clone(),
                detail,
                None,
            )
        };

        // ١ — الإلغاء.
        if session.cancel.is_cancelled() {
            return deny(DenialReason::Cancelled, Vec::new(), "the mission was cancelled before this tool call started".into());
        }

        // ٢ — النطاق.
        if request.mission_id != session.mission_id {
            return deny(
                DenialReason::CrossMissionDenied,
                Vec::new(),
                "the request names a mission other than the one this session belongs to".into(),
            );
        }

        // ٣ / ٤ — المهارة والأداة، من الحالة المشتركة.
        //
        // القراءة كلها داخل نطاق واحد ينتهي قبل أي قرار رفض. السبب ليس أناقة:
        // القفل ليس معاد الدخول، ورفضٌ يُسجَّل بينما القفل مأخوذ يجمّد الخيط عند
        // كتابة سجل النشاط. قِيس فعلًا — عَلِق مسارا رفض كاملان — والإصلاح أن
        // ينتهي عمر الحارس قبل أن يُبلَّغ القرار، لا أن يُخفى بمهلة.
        let lookup = {
            let Ok(state) = self.state.lock() else {
                return deny(DenialReason::UnknownTool, Vec::new(), "the tool registry could not be read".into());
            };
            // الترتيب داخل هذه القراءة مقصود: وجود الأداة يُفحص قبل قائمة المهارة.
            // كلا الرفضين يسبق أي أثر، فلا فرق أمني بينهما؛ والفرق في صدق الجواب.
            // اسمٌ مخترع يستحقّ «لا أداة بهذا المعرّف»، لا «مهارتك لا تسمح بها» —
            // فالثاني يوحي بأن الأداة موجودة وأن التصريح وحده ناقص.
            match state.skills.get(&request.skill_id) {
                None => Lookup::Deny(DenialReason::SkillDisabled, Vec::new(), "no such skill is known to this host".into()),
                Some(skill) if !skill.enabled => {
                    Lookup::Deny(DenialReason::SkillDisabled, Vec::new(), "the skill is disabled".into())
                }
                Some(skill) => {
                    let allowed = skill.allows(&request.tool_id);
                    match state.tools.get(&request.tool_id).cloned() {
                        // اسم غير مسجَّل ليس أداة معطّلة: ليس أداة أصلًا.
                        None => {
                            Lookup::Deny(DenialReason::UnknownTool, Vec::new(), "no tool is registered under this identifier".into())
                        }
                        // أداة غيّر خادمها تعريفها بعد أن عُرفت: لا تُنفَّذ بتعريفها الجديد حتى يقبله المستخدم (ASI04).
                        Some(descriptor) if state.redefined.iter().any(|t| t == &request.tool_id) => Lookup::Deny(
                            DenialReason::SchemaDrift,
                            descriptor.effects.clone(),
                            "the server changed this tool's definition after it was discovered; the user must accept the new definition first".into(),
                        ),
                        Some(descriptor) if !allowed => Lookup::Deny(
                            DenialReason::SkillDoesNotAllowTool,
                            descriptor.effects.clone(),
                            "the skill does not name this tool among the ones it allows".into(),
                        ),
                        Some(descriptor) if !descriptor.enabled => {
                            Lookup::Deny(DenialReason::ToolDisabled, descriptor.effects.clone(), "the tool is disabled".into())
                        }
                        Some(descriptor) => match state.adapter(&request.tool_id) {
                            None => Lookup::Deny(
                                DenialReason::UnknownTool,
                                descriptor.effects.clone(),
                                "the registered tool has no adapter in this build".into(),
                            ),
                            Some(adapter) => {
                                let server_state = descriptor
                                    .provenance
                                    .server_id
                                    .as_ref()
                                    .map(|id| state.server(id).map(|s| (s.state, s.granted_effects.clone())));
                                Lookup::Ready(Box::new(Ready { descriptor, adapter, server_state }))
                            }
                        },
                    }
                }
            }
        };
        let (descriptor, adapter, server_state) = match lookup {
            Lookup::Deny(reason, effects, detail) => return deny(reason, effects, detail),
            Lookup::Ready(ready) => (ready.descriptor, ready.adapter, ready.server_state),
        };

        let mut effects = descriptor.effects.clone();

        // ٥ — المخطط.
        if let Err(failure) = adapter.validate(&request.arguments) {
            // خطة 2026-10-05، B6: رفض وسائط أداة لها مخطط يحمل موضع الخطأ والشكل المتوقَّع ومثالًا أدنى صالحًا من المخطط
            // نفسه، فيصلح الوكيل طلبه في جولة الإصلاح بدل أن يخمّن. القرار لا يتغيّر: الرفض رفض.
            let mut detail = describe(&failure);
            if matches!(failure, ToolFailure::ArgumentsInvalid(_)) {
                if let Some(guidance) = adapter.input_schema().and_then(|schema| super::guidance::argument_guidance(&schema, &request.arguments)) {
                    detail = format!("{}. {guidance}", detail.trim_end_matches('.'));
                }
            }
            return deny(DenialReason::ArgumentsInvalid, effects, detail);
        }

        // ٥أ — السياسة المركَّبة (Phase-06): إعداد الخصوصية أو الأمان يمنع الأداة كلها، فيُسأل
        // قبل نقطة قرار المحوّل التي تحكم على هدف بعينه: حكمٌ على الأداة كلها يسبق حكمًا على وجهتها.
        if let Some(overlay) = self.overlay.get() {
            let context = ToolAssessContext {
                mission_id: &request.mission_id,
                task_id: &request.task_id,
                agent_id: &request.agent_id,
                project_id: session.project_id.as_deref(),
                cancel: &session.cancel,
            };
            if let Some(reason) = overlay.check(&descriptor, &context) {
                return deny(DenialReason::EffectNotPermitted, effects, format!("a setting forbids this tool: {reason}"));
            }
        }

        // ٥ب — نقطة قرار السياسة (Phase-05). تُسأل قبل القدرة والميزانية والموافقة،
        // لأن حكمها قد يوسّع الآثار فيغيّر ما بعدها. الاتحاد وحده يُطبَّق: لا حكم
        // يُسقط أثرًا أعلنه الواصف.
        let assessment = match adapter.assess(
            &request.arguments,
            &ToolAssessContext {
                mission_id: &request.mission_id,
                task_id: &request.task_id,
                agent_id: &request.agent_id,
                project_id: session.project_id.as_deref(),
                cancel: &session.cancel,
            },
        ) {
            Ok(assessment) => assessment,
            Err(failure) => {
                let (_, reason) = failure_status(&failure);
                return deny(reason, effects, describe(&failure));
            }
        };
        effects = widen_effects(&effects, &assessment.extra_effects);
        let requires_approval = descriptor.requires_approval || effects.iter().any(|e| e.always_requires_approval()) || request.require_human;
        let external = effects.iter().any(|e| e.is_external());

        // ٦ — القدرة، على الآثار بعد التوسيع: أثر أضافه الحكم يحتاج قدرته كذلك.
        if let Some(missing) = effects.iter().map(|e| e.required_capability()).find(|c| !effect::runtime_holds(c)) {
            let reason = if missing.ends_with(".secret") { DenialReason::SecretRequested } else { DenialReason::CapabilityMissing };
            return deny(reason, effects, format!("this build grants no {missing}"));
        }

        // ٧ — سياسة الشبكة. الحلقة المحلية، أو سياسة التنقّل التي يملكها متصفّح
        // Phase-05 المدمج وحده: أداة MCP أو أداة غير موثوقة لا تحملها أبدًا.
        // وكذلك سياسة خروج الموصل (Phase-06): أداة موصل مدمجة موثوقة وحدها تحملها،
        // وبوابة الموصلات تحت المحوّل تفرض المضيف والقالب والأسلوب.
        let trusted_builtin = descriptor.provider == ToolProvider::BuiltIn && descriptor.trust_class == ToolTrustClass::TrustedRuntime;
        let web_policed = descriptor.network_policy == NetworkPolicy::WebNavigationPolicy && trusted_builtin;
        let connector_policed = descriptor.network_policy == NetworkPolicy::ConnectorEgressPolicy && trusted_builtin;
        // PHASE-06: سياسة MCP البعيد لأداة MCP غير موثوقة وحدها (الختم لا يبقيها لغيرها)، وأثرها الخارجي يوجب الموافقة في الخطوة ١٠.
        let mcp_remote = descriptor.network_policy == NetworkPolicy::McpRegisteredHttps && descriptor.provider == ToolProvider::Mcp && descriptor.trust_class == ToolTrustClass::McpUntrusted;
        if descriptor.is_network() && descriptor.network_policy != NetworkPolicy::LoopbackOnly && !web_policed && !connector_policed && !mcp_remote {
            return deny(DenialReason::NetworkPolicyDenied, effects, "the tool reaches the network without a loopback policy".into());
        }
        if !descriptor.is_network() && descriptor.network_policy != NetworkPolicy::None {
            return deny(DenialReason::NetworkPolicyDenied, effects, "the tool declares a network policy without a network effect".into());
        }

        // ٨ — حالة الخادم لأدوات MCP.
        if descriptor.provider == ToolProvider::Mcp {
            match server_state {
                Some(Some((state, granted))) => {
                    if !state.is_usable() {
                        return deny(DenialReason::ServerDisabled, effects, format!("the server is {}", state.as_str()));
                    }
                    // السقف يُفحص عند كل نداء، لا عند التسجيل وحده: تضييقه بعد
                    // الاكتشاف يجب أن يُلاحَظ فورًا.
                    if let Some(outside) = effects.iter().find(|e| !granted.contains(e)) {
                        return deny(
                            DenialReason::EffectNotPermitted,
                            effects.clone(),
                            format!("the server is no longer granted {}", outside.as_str()),
                        );
                    }
                }
                _ => return deny(DenialReason::ServerDisabled, effects, "the server that provided this tool is no longer registered".into()),
            }
        }

        // ٩ — الميزانية، حجزًا قبل أي أثر.
        let shape = CallShape { network: descriptor.is_network(), external };
        if let Err(denied) = session.budget.reserve(&request.task_id, shape) {
            return deny(
                DenialReason::BudgetExhausted,
                effects,
                format!("the {} budget is exhausted at {}", denied.dimension.as_str(), denied.limit),
            );
        }

        // ١٠ — الموافقة.
        let binding = ApprovalBinding::new(&request.mission_id, &request.task_id, &request.tool_id, &arguments_digest, &effects);
        let mut consumed_approval: Option<String> = None;
        if requires_approval {
            let Ok(mut state) = self.state.lock() else {
                return deny(DenialReason::ApprovalMissing, effects, "the approval store could not be read".into());
            };
            let granted = state.approvals.granted_for(&binding, now_ms).map(|r| r.approval_id.clone());
            match granted {
                Some(approval_id) => match state.approvals.consume(&approval_id, &binding, now_ms) {
                    Ok(record) => consumed_approval = Some(record.approval_id),
                    Err(refusal) => {
                        drop(state);
                        return deny(approval_denial(refusal), effects, format!("the approval was refused: {}", refusal.as_str()));
                    }
                },
                None => {
                    // R-24: الفعل نفسه رفضه المستخدم صراحةً: رفضٌ نهائي، لا طلب جديد.
                    if state.approvals.denied_for(&binding).is_some() {
                        drop(state);
                        return deny(DenialReason::ApprovalDenied, effects, "the user declined this exact action; it will not be asked again".into());
                    }
                    // ADR-042: منحة «اسمح لهذه المهمّة» تحلّ محلّ سؤال الإنسان وحده، بعد أن قيّمت الخطوات 1–9 السياسة لهذا النداء.
                    // نداء طلب فيه زمن التشغيل إنسانًا (قاعدة الاثنين) لا تغطّيه منحة أبدًا.
                    let resource = crate::p04::mission_grant::resource_of(&request.tool_id, &request.arguments, &arguments_digest, assessment.approval_context.as_ref());
                    let grant = (!request.require_human && crate::p04::mission_grant::eligible(&effects, assessment.approval_context.as_ref()))
                        .then(|| state.mission_grants.matching(&request.mission_id, &request.tool_id, &effects, &resource, now_ms).cloned())
                        .flatten();
                    if let Some(grant) = grant {
                        let record = ApprovalRecord {
                            approval_id: self.clock.id(),
                            binding: binding.clone(),
                            skill_id: request.skill_id.clone(),
                            arguments_preview: bounded(&canonical_arguments(&request.arguments), 400),
                            reason: bounded(&format!("covered by the mission grant {} for {}", grant.grant_id, grant.resource), 400),
                            status: ApprovalStatus::Granted,
                            requested_at_ms: now_ms,
                            requested_at: started_at.clone(),
                            decided_at: Some(started_at.clone()),
                            expires_at_ms: now_ms + DEFAULT_APPROVAL_TTL_MS,
                            expires_at: self.clock.at_millis(now_ms + DEFAULT_APPROVAL_TTL_MS),
                            context: None,
                        };
                        state.approvals.insert(record.clone());
                        let consumed = state.approvals.consume(&record.approval_id, &binding, now_ms);
                        drop(state);
                        match consumed {
                            Ok(used) => {
                                self.record_audit(
                                    AuditEventType::ToolApprovalDecided,
                                    &used.approval_id,
                                    AuditOutcome::Success,
                                    serde_json::json!({
                                        "mission_id": request.mission_id,
                                        "tool_id": request.tool_id,
                                        "binding_digest": binding.digest(),
                                        "status": "GRANTED",
                                        "decided_by": "MISSION_GRANT",
                                        "grant_id": grant.grant_id,
                                        "resource": grant.resource,
                                    }),
                                );
                                consumed_approval = Some(used.approval_id);
                            }
                            Err(refusal) => return deny(approval_denial(refusal), effects, format!("the mission grant could not be applied: {}", refusal.as_str())),
                        }
                    } else {
                    // لا موافقة صالحة: يُنشأ طلب مربوط، ويُعلن الانتظار. ولا يُنفَّذ شيء.
                    let pending = state.approvals.pending_for(&binding, now_ms).cloned();
                    let record = match pending {
                        Some(existing) => existing,
                        None => {
                            let record = ApprovalRecord {
                                approval_id: self.clock.id(),
                                binding: binding.clone(),
                                skill_id: request.skill_id.clone(),
                                arguments_preview: bounded(&canonical_arguments(&request.arguments), 400),
                                reason: bounded(&request.reason, 400),
                                status: ApprovalStatus::Pending,
                                requested_at_ms: now_ms,
                                requested_at: started_at.clone(),
                                decided_at: None,
                                expires_at_ms: now_ms + DEFAULT_APPROVAL_TTL_MS,
                                expires_at: self.clock.at_millis(now_ms + DEFAULT_APPROVAL_TTL_MS),
                                // هوية الوكيل تأتي من الطلب الموثوق لا من الحكم.
                                context: assessment.approval_context.clone().map(|mut c| {
                                    c.agent_id = request.agent_id.clone();
                                    c
                                }),
                            };
                            state.approvals.insert(record.clone());
                            record
                        }
                    };
                    drop(state);
                    self.record_audit(
                        AuditEventType::ToolApprovalRequested,
                        &record.approval_id,
                        AuditOutcome::Started,
                        serde_json::json!({
                            "mission_id": request.mission_id,
                            "task_id": request.task_id,
                            "tool_id": request.tool_id,
                            "binding_digest": binding.digest(),
                        }),
                    );
                    let mut outcome = self.denied(
                        &request,
                        invocation_id.clone(),
                        DenialReason::ApprovalRequired,
                        effects,
                        arguments_digest.clone(),
                        started_at.clone(),
                        "the tool changes state, so a human decision is required before it runs".into(),
                        Some(record.approval_id.clone()),
                    );
                    outcome.pending_approval = Some(record);
                    return outcome;
                    }
                }
            }
        }

        // ١١ — التنفيذ.
        let timeout_ms = session.budget.remaining_runtime_ms();
        let context = ToolCallContext {
            mission_id: &request.mission_id,
            task_id: &request.task_id,
            agent_id: &request.agent_id,
            project_id: session.project_id.as_deref(),
            timeout_ms,
            cancel: &session.cancel,
        };
        self.record_audit(
            AuditEventType::ToolInvoked,
            &invocation_id,
            AuditOutcome::Started,
            serde_json::json!({
                "mission_id": request.mission_id,
                "task_id": request.task_id,
                "tool_id": request.tool_id,
                "skill_id": request.skill_id,
                "effects": effects.iter().map(|e| e.as_str()).collect::<Vec<_>>(),
                "arguments_digest": arguments_digest,
                "approval_id": consumed_approval,
                "trust_class": descriptor.trust_class.as_str(),
            }),
        );
        let began = std::time::Instant::now();
        let outcome = adapter.execute(&request.arguments, &context);
        let elapsed = began.elapsed().as_millis() as u64;
        session.budget.settle(elapsed);

        // ١٢ — التسوية والدليل.
        match outcome {
            Ok(produced) => {
                let result_digest = crate::digest::sha256_hex(&produced.measured_bytes);
                let evidence_id = self.clock.id();
                let record = ToolInvocationRecord {
                    invocation_id: invocation_id.clone(),
                    mission_id: request.mission_id.clone(),
                    task_id: request.task_id.clone(),
                    agent_id: request.agent_id.clone(),
                    skill_id: request.skill_id.clone(),
                    tool_id: request.tool_id.clone(),
                    status: InvocationStatus::Succeeded,
                    denial_reason: None,
                    effects: effects.clone(),
                    arguments_digest: arguments_digest.clone(),
                    result_digest: Some(result_digest.clone()),
                    evidence_id: Some(evidence_id.clone()),
                    approval_id: consumed_approval.clone(),
                    summary: bounded(&produced.summary, 400),
                    started_at: started_at.clone(),
                    duration_ms: elapsed,
                };
                self.evidence.record(ToolEvidenceRecord {
                    invocation_id: invocation_id.clone(),
                    mission_id: request.mission_id.clone(),
                    task_id: request.task_id.clone(),
                    tool_id: request.tool_id.clone(),
                    arguments_digest: arguments_digest.clone(),
                    result_digest: result_digest.clone(),
                    effects: effects.iter().map(|e| e.as_str().to_string()).collect(),
                    status: "SUCCEEDED".into(),
                    summary: bounded(&produced.summary, 400),
                    measured_at: started_at.clone(),
                    supports: produced.supports,
                    trust_class: descriptor.trust_class.as_str().to_string(),
                    note: produced.evidence.clone(),
                });
                self.record_audit(
                    AuditEventType::ToolCompleted,
                    &invocation_id,
                    AuditOutcome::Success,
                    serde_json::json!({
                        "mission_id": request.mission_id,
                        "tool_id": request.tool_id,
                        "result_digest": result_digest,
                        "duration_ms": elapsed,
                        "supports": produced.supports,
                        "detail": bounded(&produced.detail, 300),
                    }),
                );
                if let Ok(mut state) = self.state.lock() {
                    state.activity.push(record.clone());
                }
                let observation = produced.observation.as_deref().map(|o| bounded(o, OBSERVATION_MAX_CHARS));
                GatewayOutcome { record, pending_approval: None, observation }
            }
            Err(failure) => {
                let (status, reason) = failure_status(&failure);
                let record = ToolInvocationRecord {
                    invocation_id: invocation_id.clone(),
                    mission_id: request.mission_id.clone(),
                    task_id: request.task_id.clone(),
                    agent_id: request.agent_id.clone(),
                    skill_id: request.skill_id.clone(),
                    tool_id: request.tool_id.clone(),
                    status,
                    denial_reason: Some(reason.as_str().to_string()),
                    effects: effects.clone(),
                    arguments_digest: arguments_digest.clone(),
                    result_digest: None,
                    evidence_id: None,
                    approval_id: consumed_approval.clone(),
                    summary: bounded(&describe(&failure), 400),
                    started_at: started_at.clone(),
                    duration_ms: elapsed,
                };
                self.record_audit(
                    AuditEventType::ToolFailed,
                    &invocation_id,
                    if status == InvocationStatus::Cancelled { AuditOutcome::Cancelled } else { AuditOutcome::Failure },
                    serde_json::json!({
                        "mission_id": request.mission_id,
                        "tool_id": request.tool_id,
                        "reason": reason.as_str(),
                        "duration_ms": elapsed,
                    }),
                );
                if let Ok(mut state) = self.state.lock() {
                    state.activity.push(record.clone());
                }
                GatewayOutcome { record, pending_approval: None, observation: None }
            }
        }
    }
}

/// أقصى ما تحمله ملاحظة أداة إلى النموذج، بالمحارف.
pub const OBSERVATION_MAX_CHARS: usize = 16_000;

/// نصّ الحجج بشكل قانوني: مفاتيح مرتّبة، فتكون البصمة واحدة لترتيبين.
pub fn canonical_arguments(arguments: &Value) -> String {
    fn canonical(value: &Value) -> Value {
        match value {
            Value::Object(map) => {
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort();
                let mut out = serde_json::Map::new();
                for key in keys {
                    out.insert(key.clone(), canonical(&map[key]));
                }
                Value::Object(out)
            }
            Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
            other => other.clone(),
        }
    }
    canonical(arguments).to_string()
}

fn approval_denial(refusal: ApprovalRefusal) -> DenialReason {
    match refusal {
        ApprovalRefusal::Missing => DenialReason::ApprovalMissing,
        ApprovalRefusal::Mismatch => DenialReason::ApprovalMismatch,
        ApprovalRefusal::Expired => DenialReason::ApprovalExpired,
        ApprovalRefusal::AlreadyUsed => DenialReason::ApprovalAlreadyUsed,
        ApprovalRefusal::Denied => DenialReason::ApprovalDenied,
        ApprovalRefusal::StillPending => DenialReason::ApprovalRequired,
    }
}

fn failure_status(failure: &ToolFailure) -> (InvocationStatus, DenialReason) {
    match failure {
        ToolFailure::ArgumentsInvalid(_) => (InvocationStatus::Denied, DenialReason::ArgumentsInvalid),
        ToolFailure::OutOfScope(_) => (InvocationStatus::Denied, DenialReason::CrossMissionDenied),
        ToolFailure::Unavailable(_) => (InvocationStatus::Failed, DenialReason::ServerUnreachable),
        ToolFailure::TimedOut => (InvocationStatus::TimedOut, DenialReason::ServerUnreachable),
        ToolFailure::Cancelled => (InvocationStatus::Cancelled, DenialReason::Cancelled),
        ToolFailure::ResultTooLarge(_) => (InvocationStatus::Failed, DenialReason::ResultTooLarge),
        ToolFailure::ResultMalformed(_) => (InvocationStatus::Failed, DenialReason::ResultMalformed),
        ToolFailure::Refused(_) => (InvocationStatus::Denied, DenialReason::NetworkPolicyDenied),
        ToolFailure::NotPermitted(_) => (InvocationStatus::Denied, DenialReason::EffectNotPermitted),
        ToolFailure::BudgetExhausted(_) => (InvocationStatus::Denied, DenialReason::BudgetExhausted),
        // ملاحظة لم تعد تطابق الهدف: الحجج التي بُني عليها الاقتراح لم تعد صالحة.
        ToolFailure::Stale(_) => (InvocationStatus::Denied, DenialReason::ArgumentsInvalid),
    }
}

/// سقف ملخّص الرفض المحفوظ والمعروض: يتّسع لسبب المحوّل وإرشاد المخطط، ودون حدّ `BoundedDescription` في العقد.
const DENIAL_SUMMARY_MAX_CHARS: usize = 1_200;

fn describe(failure: &ToolFailure) -> String {
    match failure {
        ToolFailure::ArgumentsInvalid(detail)
        | ToolFailure::OutOfScope(detail)
        | ToolFailure::Unavailable(detail)
        | ToolFailure::ResultMalformed(detail)
        | ToolFailure::Refused(detail)
        | ToolFailure::NotPermitted(detail)
        | ToolFailure::BudgetExhausted(detail)
        | ToolFailure::Stale(detail) => detail.clone(),
        ToolFailure::TimedOut => "the tool did not answer within the time its mission budget allowed".into(),
        ToolFailure::Cancelled => "the mission was cancelled while the tool was running".into(),
        ToolFailure::ResultTooLarge(bytes) => format!("the result exceeded {bytes} bytes"),
    }
}

/// هل يحمل هذا الواصف أثرًا يوجب الموافقة؟ يُستعمل في العرض وفي الاختبار.
pub fn requires_human_decision(descriptor: &ToolDescriptor) -> bool {
    descriptor.requires_approval || descriptor.effects.iter().any(|e| e.always_requires_approval())
}

/// صنف ثقة الأداة كما يُكتب في الدليل.
pub fn trust_label(descriptor: &ToolDescriptor) -> &'static str {
    match descriptor.trust_class {
        ToolTrustClass::TrustedRuntime => "TRUSTED_RUNTIME",
        ToolTrustClass::McpUntrusted => "MCP_UNTRUSTED",
    }
}

/// يتحقق أن كل أثر في مجموعة داخل مِنحة زمن التشغيل. مُعين للاختبار والعرض.
pub fn all_effects_granted(effects: &[ToolEffect]) -> bool {
    effects.iter().all(|e| effect::runtime_holds(e.required_capability()))
}

/// اتحاد آثار الواصف بما أضافه حكم نقطة القرار. لا يُسقط أثرًا معلنًا أبدًا: الحكم يوسّع ولا يضيّق.
fn widen_effects(declared: &[ToolEffect], extra: &[ToolEffect]) -> Vec<ToolEffect> {
    if extra.iter().all(|e| declared.contains(e)) {
        return declared.to_vec();
    }
    let mut union = declared.to_vec();
    union.extend(extra.iter().copied());
    effect::normalise(&union)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_assessment_can_widen_the_effects_but_never_narrow_them() {
        let declared = vec![ToolEffect::NetworkEgress];
        // لا شيء إضافي: الآثار كما أعلنها الواصف، لا أقلّ.
        assert_eq!(widen_effects(&declared, &[]), declared);
        // إرسال نموذج: يُضاف الأثر الخارجي ويبقى الأثر المعلن.
        let widened = widen_effects(&declared, &[ToolEffect::ExternalSideEffect]);
        assert!(widened.contains(&ToolEffect::NetworkEgress) && widened.contains(&ToolEffect::ExternalSideEffect));
        assert!(widened.iter().any(|e| e.always_requires_approval() || e.is_external()), "a widened effect lost its weight");
        // حكمٌ يعيد أثرًا معلنًا وحده لا يُسقط غيره.
        let both = vec![ToolEffect::ReadLocal, ToolEffect::ExternalSideEffect];
        assert_eq!(widen_effects(&both, &[ToolEffect::ReadLocal]), both);
    }

    #[test]
    fn the_denial_vocabulary_is_closed_and_round_trips() {
        assert_eq!(DenialReason::ALL.len(), 23);
        for reason in DenialReason::ALL {
            assert_eq!(DenialReason::parse(reason.as_str()), Some(reason));
        }
        assert_eq!(DenialReason::parse("SOMETHING_ELSE"), None);
    }

    #[test]
    fn canonical_arguments_do_not_depend_on_key_order() {
        let a = serde_json::json!({ "b": 1, "a": { "d": 2, "c": 3 } });
        let b = serde_json::json!({ "a": { "c": 3, "d": 2 }, "b": 1 });
        assert_eq!(canonical_arguments(&a), canonical_arguments(&b));
        let different = serde_json::json!({ "a": { "c": 3, "d": 9 }, "b": 1 });
        assert_ne!(canonical_arguments(&a), canonical_arguments(&different));
    }

    #[test]
    fn every_approval_refusal_maps_to_a_denial_in_the_contract_vocabulary() {
        for refusal in [
            ApprovalRefusal::Missing,
            ApprovalRefusal::Mismatch,
            ApprovalRefusal::Expired,
            ApprovalRefusal::AlreadyUsed,
            ApprovalRefusal::Denied,
            ApprovalRefusal::StillPending,
        ] {
            let reason = approval_denial(refusal);
            assert!(DenialReason::parse(reason.as_str()).is_some());
        }
    }

    #[test]
    fn a_cancelled_tool_is_not_recorded_as_a_failure_of_the_tool() {
        let (status, reason) = failure_status(&ToolFailure::Cancelled);
        assert_eq!(status, InvocationStatus::Cancelled);
        assert_eq!(reason, DenialReason::Cancelled);
    }

    #[test]
    fn a_timed_out_tool_counts_as_executed_because_its_effect_may_have_happened() {
        let (status, _) = failure_status(&ToolFailure::TimedOut);
        assert!(status.executed(), "a timed-out call was treated as if nothing had happened");
    }
}
