// محوّلات أدوات المتصفّح: الجسر الوحيد بين بوابة الأدوات وزمن تشغيل المتصفّح.
//
// كل محوّل هنا يفعل ثلاثة أشياء لا رابع لها: يتحقق من الحجج بعقد مغلق، ويُقيّم الطلب
// (نقطة قرار السياسة: هل الوجهة مسموحة؟ هل النقر إرسال؟ هل الحقل كلمة مرور؟)، ثم
// ينفّذ ما أذنت به البوابة. قرار الموافقة والميزانية العامّة والقدرة عند البوابة.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::p04::adapter::{
    bounded, EvidenceNoteStance, ToolAdapter, ToolAssessContext, ToolAssessment, ToolCallContext, ToolEvidenceNote, ToolFailure,
    ToolOutcome,
};
use crate::p04::approval::ApprovalContext;
use crate::p04::effect::ToolEffect;
use crate::p04::tool::{RiskClass, ToolDescriptor};
use crate::p05::tooling::{check_args, descriptor, int_arg, text_arg, ArgKind, ArgSpec, Phase05Capability};

use super::classify::ClickPlan;
use super::runtime::{BrowserActionContext, BrowserActionResult, BrowserFailure, BrowserRuntime};

pub const TOOL_NAVIGATE: &str = "polaris.web.navigate";
pub const TOOL_READ: &str = "polaris.web.read_page";
pub const TOOL_CLICK: &str = "polaris.web.click";
pub const TOOL_TYPE: &str = "polaris.web.type";
pub const TOOL_BACK: &str = "polaris.web.back";
pub const TOOL_FORWARD: &str = "polaris.web.forward";
pub const TOOL_RELOAD: &str = "polaris.web.reload";
pub const TOOL_DOWNLOAD: &str = "polaris.web.download";
pub const TOOL_UPLOAD: &str = "polaris.web.upload";

/// أي فعل يمثّله المحوّل.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebAction {
    Navigate,
    Read,
    Click,
    Type,
    Back,
    Forward,
    Reload,
    Download,
    Upload,
}

impl WebAction {
    pub const ALL: [WebAction; 9] =
        [Self::Navigate, Self::Read, Self::Click, Self::Type, Self::Back, Self::Forward, Self::Reload, Self::Download, Self::Upload];

    pub fn tool_id(self) -> &'static str {
        match self {
            Self::Navigate => TOOL_NAVIGATE,
            Self::Read => TOOL_READ,
            Self::Click => TOOL_CLICK,
            Self::Type => TOOL_TYPE,
            Self::Back => TOOL_BACK,
            Self::Forward => TOOL_FORWARD,
            Self::Reload => TOOL_RELOAD,
            Self::Download => TOOL_DOWNLOAD,
            Self::Upload => TOOL_UPLOAD,
        }
    }

    pub fn capability(self) -> Phase05Capability {
        match self {
            Self::Navigate | Self::Back | Self::Forward | Self::Reload => Phase05Capability::BrowserNavigate,
            Self::Read => Phase05Capability::BrowserRead,
            Self::Click => Phase05Capability::BrowserClick,
            Self::Type => Phase05Capability::BrowserType,
            Self::Download => Phase05Capability::BrowserDownload,
            Self::Upload => Phase05Capability::BrowserUpload,
        }
    }

    /// الآثار المُعلنة. الإرسال الخارجي يُضاف بالتقييم حين يتبيّن، ولا يُحذف أبدًا.
    fn effects(self) -> Vec<ToolEffect> {
        match self {
            Self::Navigate | Self::Click | Self::Back | Self::Forward | Self::Reload => vec![ToolEffect::NetworkEgress],
            Self::Read | Self::Type => vec![ToolEffect::LocalCompute],
            // التنزيل يكتب ملفًّا في مجلّد المهمّة: كتابة محلية توجب موافقة.
            Self::Download => vec![ToolEffect::NetworkEgress, ToolEffect::WriteLocal],
            // الرفع يقرأ ملفًّا ويُعدّه للخروج من الجهاز: أثر خارجي يوجب موافقة.
            Self::Upload => vec![ToolEffect::ReadLocal, ToolEffect::ExternalSideEffect],
        }
    }

    fn spec(self) -> Vec<ArgSpec> {
        let element = || ArgSpec { name: "element", required: true, kind: ArgKind::Text { max: 80 } };
        match self {
            Self::Navigate => vec![ArgSpec { name: "url", required: true, kind: ArgKind::Text { max: 2048 } }],
            Self::Read => vec![ArgSpec { name: "offset", required: false, kind: ArgKind::Integer { min: 0, max: 1_000_000 } }],
            Self::Click | Self::Download => vec![element()],
            Self::Type => vec![element(), ArgSpec { name: "text", required: true, kind: ArgKind::Text { max: 500 } }],
            Self::Back | Self::Forward | Self::Reload => Vec::new(),
            Self::Upload => vec![element(), ArgSpec { name: "file_ref", required: true, kind: ArgKind::Text { max: 120 } }],
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Navigate => "Open a web page",
            Self::Read => "Read the loaded page",
            Self::Click => "Click an element on the page",
            Self::Type => "Type into a page field",
            Self::Back => "Go back",
            Self::Forward => "Go forward",
            Self::Reload => "Reload the page",
            Self::Download => "Download a linked file",
            Self::Upload => "Attach a brokered file to a form",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Navigate => "Fetches an http or https page through the navigation policy. The page content is WEB_UNTRUSTED data.",
            Self::Read => "Returns more of the loaded page's visible text. No network request is made.",
            Self::Click => "Follows a link or submits a form. A submission that may change something outside the device waits for approval.",
            Self::Type => "Fills a visible text field in the session's form state. Fields that hide what is typed are refused, and nothing is sent until a submit.",
            Self::Back => "Returns to the previous page by a new GET request.",
            Self::Forward => "Moves forward again by a new GET request.",
            Self::Reload => "Fetches the current address again by GET; a form is never re-posted.",
            Self::Download => "Saves a linked file into the mission's quarantine folder, never opening or running it. Always approved first.",
            Self::Upload => "Attaches a file the mission's broker holds to a file field. A free path is never accepted. Always approved first.",
        }
    }

    /// رمز الفعل في تاريخ الجلسة (مفردات جدول الأفعال).
    fn history_code(self) -> &'static str {
        match self {
            Self::Navigate => "NAVIGATE",
            Self::Read => "READ",
            Self::Click => "CLICK",
            Self::Type => "TYPE",
            Self::Back => "BACK",
            Self::Forward => "FORWARD",
            Self::Reload => "RELOAD",
            Self::Download => "DOWNLOAD",
            Self::Upload => "UPLOAD",
        }
    }

    fn code(self) -> &'static str {
        match self {
            Self::Navigate => "WEB_NAVIGATE",
            Self::Read => "WEB_READ",
            Self::Click => "WEB_CLICK",
            Self::Type => "WEB_TYPE",
            Self::Back => "WEB_BACK",
            Self::Forward => "WEB_FORWARD",
            Self::Reload => "WEB_RELOAD",
            Self::Download => "WEB_DOWNLOAD",
            Self::Upload => "WEB_UPLOAD",
        }
    }
}

/// يترجم فشل المتصفّح إلى مفردات البوابة المغلقة.
pub fn to_tool_failure(failure: BrowserFailure) -> ToolFailure {
    let detail = failure.detail();
    match failure {
        BrowserFailure::Navigation(_) => ToolFailure::Refused(detail),
        BrowserFailure::NotPermitted(_) => ToolFailure::NotPermitted(detail),
        BrowserFailure::InvalidTarget(_) => ToolFailure::ArgumentsInvalid(detail),
        BrowserFailure::SessionClosed("CANCELLED") => ToolFailure::Cancelled,
        BrowserFailure::SessionClosed(_) => ToolFailure::NotPermitted(detail),
        BrowserFailure::Budget(_) => ToolFailure::BudgetExhausted(detail),
        BrowserFailure::Cancelled => ToolFailure::Cancelled,
        BrowserFailure::Timeout => ToolFailure::TimedOut,
        BrowserFailure::TooLarge(n) => ToolFailure::ResultTooLarge(n),
        BrowserFailure::Malformed(_) => ToolFailure::ResultMalformed(detail),
        BrowserFailure::Unavailable(_) => ToolFailure::Unavailable(detail),
    }
}

fn outcome(result: BrowserActionResult) -> ToolOutcome {
    let stance = match result.observed_text {
        Some(text) => EvidenceNoteStance::Observed(text),
        None => EvidenceNoteStance::Neutral,
    };
    ToolOutcome {
        summary: bounded(&result.summary, 1000),
        measured_bytes: result.measured_bytes,
        // الأداة عملت وقاست؛ ما تؤيّده يقرّره موقف الملاحظة لا هذه الراية.
        supports: true,
        detail: result.detail,
        evidence: Some(ToolEvidenceNote { kind: result.kind, stance }),
        observation: None,
    }
}

/// محوّل أداة متصفّح واحدة.
pub struct WebTool {
    action: WebAction,
    runtime: Arc<BrowserRuntime>,
}

impl WebTool {
    pub fn new(action: WebAction, runtime: Arc<BrowserRuntime>) -> Self {
        Self { action, runtime }
    }

    pub fn all(runtime: &Arc<BrowserRuntime>) -> Vec<Arc<dyn ToolAdapter>> {
        WebAction::ALL.iter().map(|a| Arc::new(WebTool::new(*a, runtime.clone())) as Arc<dyn ToolAdapter>).collect()
    }

    fn approval_context(&self, target: String, expected_effect: String, risk: RiskClass, arguments: &Value) -> ApprovalContext {
        ApprovalContext {
            agent_id: String::new(),
            action: self.action.code().into(),
            target: bounded(&target, 300),
            expected_effect,
            risk,
            arguments_summary: bounded(&crate::p04::gateway::canonical_arguments(arguments), 300),
        }
    }
}

impl ToolAdapter for WebTool {
    fn tool_id(&self) -> &str {
        self.action.tool_id()
    }

    fn descriptor(&self) -> ToolDescriptor {
        let schema = json!({ "tool": self.action.tool_id(), "capability": self.action.capability().as_str(), "fields": self.action.spec().iter().map(|s| s.name).collect::<Vec<_>>() });
        let web = self.action.effects().contains(&ToolEffect::NetworkEgress);
        descriptor(self.action.tool_id(), self.action.name(), self.action.description(), self.action.effects(), web, &schema)
    }

    // R-21: بلا مخطط تُعرض الأداة كائنًا فارغًا فيخمّن النموذج وسائطها (قِيس على أداة سياق المشروع).
    fn input_schema(&self) -> Option<Value> {
        Some(crate::p05::tooling::schema_of(&self.action.spec()))
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        check_args(arguments, &self.action.spec())
    }

    fn assess(&self, arguments: &Value, context: &ToolAssessContext<'_>) -> Result<ToolAssessment, ToolFailure> {
        if let Some(state) = self.runtime.live_state(context.mission_id) {
            if state == "CANCELLED" {
                return Err(ToolFailure::Cancelled);
            }
            if state == "CLOSED" || state == "FAILED" {
                return Err(ToolFailure::NotPermitted(format!("the browser session for this mission is {state}")));
            }
        }
        let refuse = |failure: BrowserFailure, target: String| {
            self.runtime.record_assessed_refusal(context.mission_id, context.task_id, self.action.history_code(), &target, &failure);
            to_tool_failure(failure)
        };
        match self.action {
            WebAction::Navigate => {
                self.runtime.check_destination(&text_arg(arguments, "url")).map_err(|f| refuse(f, text_arg(arguments, "url")))?;
                Ok(ToolAssessment::default())
            }
            WebAction::Click => {
                let target = text_arg(arguments, "element");
                let plan = self.runtime.plan_click(context.mission_id, &target).map_err(|f| refuse(f, target.clone()))?;
                if !plan.is_external() {
                    return Ok(ToolAssessment::default());
                }
                let (where_to, what, reason) = match &plan {
                    ClickPlan::Submit { form_ref, method, url, reason, .. } => (
                        format!("{} — {target} in form {form_ref}", url.origin().ascii_serialization()),
                        format!("Sends form {form_ref} by {method} to {}. The site may record, send, publish, charge or delete something; POLARIS will not treat the click as proof that it succeeded.", bounded(url.as_str(), 160)),
                        *reason,
                    ),
                    ClickPlan::Follow { url, reason, .. } => (
                        format!("{} — link {target}", url.origin().ascii_serialization()),
                        format!("Opens {} by GET. The link's wording says it may change something on the site.", bounded(url.as_str(), 160)),
                        *reason,
                    ),
                    ClickPlan::NoAction(_) => unreachable!("plan_click never returns NoAction"),
                };
                Ok(ToolAssessment {
                    extra_effects: vec![ToolEffect::ExternalSideEffect],
                    approval_context: Some(self.approval_context(format!("{where_to} [{reason}]"), what, RiskClass::High, arguments)),
                })
            }
            WebAction::Type => {
                self.runtime
                    .check_type(context.mission_id, &text_arg(arguments, "element"), &text_arg(arguments, "text"))
                    .map_err(|f| refuse(f, text_arg(arguments, "element")))?;
                Ok(ToolAssessment::default())
            }
            WebAction::Download => {
                let url = self.runtime.plan_download(context.mission_id, &text_arg(arguments, "element")).map_err(|f| refuse(f, text_arg(arguments, "element")))?;
                Ok(ToolAssessment {
                    extra_effects: Vec::new(),
                    approval_context: Some(self.approval_context(
                        bounded(url.as_str(), 200),
                        "Downloads the file into this mission's quarantine folder under a neutral name. It is marked untrusted and is never opened or run.".into(),
                        RiskClass::Moderate,
                        arguments,
                    )),
                })
            }
            WebAction::Upload => {
                let (element, record) = self
                    .runtime
                    .check_upload(context.mission_id, &text_arg(arguments, "element"), &text_arg(arguments, "file_ref"))
                    .map_err(|f| refuse(f, text_arg(arguments, "element")))?;
                Ok(ToolAssessment {
                    extra_effects: Vec::new(),
                    approval_context: Some(self.approval_context(
                        format!("{element} ← download:{} ({} bytes)", record.download_id, record.byte_count),
                        "Attaches the brokered file to the form. It leaves the device only if a later submit is also approved.".into(),
                        RiskClass::High,
                        arguments,
                    )),
                })
            }
            WebAction::Read | WebAction::Back | WebAction::Forward | WebAction::Reload => Ok(ToolAssessment::default()),
        }
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        let ctx = BrowserActionContext {
            mission_id: context.mission_id,
            task_id: context.task_id,
            agent_id: context.agent_id,
            cancel: context.cancel,
            timeout_ms: context.timeout_ms.max(1),
        };
        let result = match self.action {
            WebAction::Navigate => self.runtime.navigate(&ctx, &text_arg(arguments, "url")),
            WebAction::Read => self.runtime.read(&ctx, int_arg(arguments, "offset").unwrap_or(0).max(0) as usize),
            WebAction::Click => self.runtime.click(&ctx, &text_arg(arguments, "element")),
            WebAction::Type => self.runtime.type_text(&ctx, &text_arg(arguments, "element"), &text_arg(arguments, "text")),
            WebAction::Back => self.runtime.history_move(&ctx, "BACK"),
            WebAction::Forward => self.runtime.history_move(&ctx, "FORWARD"),
            WebAction::Reload => self.runtime.history_move(&ctx, "RELOAD"),
            WebAction::Download => self.runtime.download(&ctx, &text_arg(arguments, "element")),
            WebAction::Upload => self.runtime.upload(&ctx, &text_arg(arguments, "element"), &text_arg(arguments, "file_ref")),
        };
        result.map(outcome).map_err(to_tool_failure)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p04::tool::NetworkPolicy;

    #[test]
    fn only_network_tools_carry_the_web_policy_and_writes_need_approval() {
        let db = std::sync::Arc::new(crate::storage::Database::in_memory().unwrap());
        let runtime = Arc::new(BrowserRuntime::new(
            super::super::engine::BrowserEngine::new(
                Arc::new(polaris_host_providers::net::HttpClient::new()),
                super::super::url_policy::NavigationPolicy::product(),
                Default::default(),
            ),
            super::super::store::BrowserStore::new(db.clone()),
            crate::p03::clock::RuntimeClock::deterministic(),
            Arc::new(crate::audit::AuditLedger::new(db)),
            Default::default(),
            None,
        ));
        for tool in WebTool::all(&runtime) {
            let sealed = tool.descriptor().sealed();
            if sealed.effects.contains(&ToolEffect::NetworkEgress) {
                assert_eq!(sealed.network_policy, NetworkPolicy::WebNavigationPolicy, "{}", sealed.tool_id);
            } else {
                assert_eq!(sealed.network_policy, NetworkPolicy::None, "{}", sealed.tool_id);
            }
            if sealed.tool_id == TOOL_DOWNLOAD || sealed.tool_id == TOOL_UPLOAD {
                assert!(sealed.requires_approval, "{} escaped approval", sealed.tool_id);
            }
            if sealed.tool_id == TOOL_NAVIGATE || sealed.tool_id == TOOL_READ {
                assert!(!sealed.requires_approval);
            }
        }
    }
}
