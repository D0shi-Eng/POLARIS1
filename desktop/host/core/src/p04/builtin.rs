// الأدوات المدمجة: ثلاث أدوات محدودة، كلٌّ تفعل شيئًا واحدًا داخل نطاق مُعلن.
//
// ما لا يوجد هنا عمدًا: أداة تشغّل أمرًا، وأداة تقرأ مسارًا حرًّا، وأداة تكتب في
// أي مكان. الأدوات المحلّية كلها محصورة بمصادر السياق المسجَّلة لمشروع المهمّة —
// وهي موارد أذن بها المستخدم بنفسه في Phase-02 — فلا تتحوّل الأداة إلى ممرّ عامّ
// إلى نظام الملفات (البند 108).

use std::sync::Arc;

use serde_json::json;

use crate::audit::{AuditLedger, ChainVerification};
use crate::p02::context::model::SourceType;
use crate::p02::context::sources::AddSource;
use crate::p02::context::SourceService;

use super::adapter::{bounded, reject_unknown_fields, string_field, ToolAdapter, ToolCallContext, ToolFailure, ToolOutcome};
use super::effect::ToolEffect;
use super::tool::{NetworkPolicy, RiskClass, ToolDescriptor, ToolProvenance, ToolProvider, ToolTrustClass};

pub const TOOL_AUDIT_CHAIN: &str = "polaris.tool.audit.chain.verify";
pub const TOOL_CONTEXT_READ: &str = "polaris.tool.context.read";
pub const TOOL_PROJECT_NOTE: &str = "polaris.tool.project.note.append";

const REGISTERED_AT: &str = "2026-09-22T00:00:00Z";

fn base(tool_id: &str, name: &str, description: &str, effects: Vec<ToolEffect>) -> ToolDescriptor {
    ToolDescriptor {
        tool_id: tool_id.into(),
        provider: ToolProvider::BuiltIn,
        name: name.into(),
        description: description.into(),
        input_schema_ref: format!("{tool_id}.input.v1"),
        output_schema_ref: format!("{tool_id}.output.v1"),
        effects,
        required_capabilities: Vec::new(),
        risk: RiskClass::Low,
        requires_approval: false,
        network_policy: NetworkPolicy::None,
        enabled: true,
        trust_class: ToolTrustClass::TrustedRuntime,
        provenance: ToolProvenance {
            origin: "polaris.builtin".into(),
            server_id: None,
            server_name: None,
            declared_effects: Vec::new(),
            schema_digest: crate::digest::sha256_hex(tool_id.as_bytes()),
            registered_at: REGISTERED_AT.into(),
        },
    }
}

/// أداة تتحقق من سلامة سلسلة التدقيق. قياس حقيقي على القاعدة الحيّة.
pub struct AuditChainTool {
    pub audit: Arc<AuditLedger>,
}

impl ToolAdapter for AuditChainTool {
    fn tool_id(&self) -> &str {
        TOOL_AUDIT_CHAIN
    }

    fn descriptor(&self) -> ToolDescriptor {
        base(
            TOOL_AUDIT_CHAIN,
            "Verify the audit chain",
            "Verifies the local audit chain and reports the number of records it covered. It reads and changes nothing.",
            vec![ToolEffect::DatabaseRead],
        )
    }

    // CP-03-1 (2026-10-20): لا وسائط. المخطط يقول ذلك بدل كائن مفتوح يدعو النموذج إلى اختراع حقول ترفضها `validate`.
    fn input_schema(&self) -> Option<serde_json::Value> {
        Some(serde_json::json!({ "type": "object", "properties": {}, "additionalProperties": false }))
    }

    fn validate(&self, arguments: &serde_json::Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &[])
    }

    fn execute(&self, _arguments: &serde_json::Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        match self.audit.verify() {
            Ok(ChainVerification::Intact { records }) => Ok(ToolOutcome {
                summary: format!("the audit chain verified over {records} records"),
                measured_bytes: format!("AUDIT_CHAIN INTACT records={records}").into_bytes(),
                supports: true,
                detail: format!("records={records}"),
                evidence: None,
                observation: None,
            }),
            Ok(ChainVerification::Broken { at_seq, reason }) => Ok(ToolOutcome {
                summary: format!("the audit chain broke at record {at_seq}"),
                measured_bytes: format!("AUDIT_CHAIN BROKEN at={at_seq}").into_bytes(),
                // قياس ناجح لواقع سلبي: الأداة عملت، والقضيّة كاذبة.
                supports: false,
                detail: bounded(&reason, 200),
                evidence: None,
                observation: None,
            }),
            Err(error) => Err(ToolFailure::Unavailable(format!("the audit chain could not be read: {error}"))),
        }
    }
}

/// أداة تقرأ مصدر سياق مسجَّلًا في مشروع المهمّة.
///
/// النطاق هو الحدّ: المعرّف يُبحث عنه داخل مشروع هذه المهمّة وحده. مصدر مشروع آخر
/// لا «يُرفض بعد قراءته»؛ هو ببساطة غير موجود في هذا النطاق.
pub struct ContextReadTool {
    pub sources: Arc<SourceService>,
}

impl ToolAdapter for ContextReadTool {
    fn tool_id(&self) -> &str {
        TOOL_CONTEXT_READ
    }

    fn descriptor(&self) -> ToolDescriptor {
        base(
            TOOL_CONTEXT_READ,
            "Read a registered context source",
            "Reads one context source the user attached to this mission's project, and returns its text or its recorded state. Needs the \
source_id POLARIS listed for that source; a mission with no attached source has nothing to read.",
            vec![ToolEffect::ReadLocal, ToolEffect::DatabaseRead],
        )
    }

    // R-21 (قِيس 2026-10-13 على Bonsai): بلا مخطط عُرضت الأداة كائنًا فارغًا، فاستدعاها النموذج بلا `source_id` ثلاث مرّات
    // ورُفضت حتى توقّفت المهمّة بـ REPEATED_DENIALS. المخطط يقول ما يقوله `validate` نفسه.
    fn input_schema(&self) -> Option<serde_json::Value> {
        Some(serde_json::json!({
            "type": "object",
            "properties": {
                "source_id": { "type": "string", "description": "the identifier of a context source attached to this mission's project, as POLARIS listed it" }
            },
            "required": ["source_id"],
            "additionalProperties": false
        }))
    }

    fn validate(&self, arguments: &serde_json::Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["source_id"])?;
        let id = string_field(arguments, "source_id", 64)?;
        if !crate::ids::is_uuid_v4(&id) {
            return Err(ToolFailure::ArgumentsInvalid("source_id is not an identifier this host issues".into()));
        }
        Ok(())
    }

    fn execute(&self, arguments: &serde_json::Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        let Some(project_id) = context.project_id else {
            return Err(ToolFailure::OutOfScope("this mission has no project, so it has no context source to read".into()));
        };
        let source_id = string_field(arguments, "source_id", 64)?;
        let found = self
            .sources
            .get(project_id, &source_id)
            .map_err(|e| ToolFailure::Unavailable(format!("the context source could not be read: {e:?}")))?;
        let Some((source, active)) = found else {
            return Err(ToolFailure::OutOfScope("no such context source is attached to this mission's project".into()));
        };
        if !active {
            return Err(ToolFailure::OutOfScope("the context source was removed from this project".into()));
        }
        // النصّ المخزَّن يعود كما هو؛ المصادر المدعومة بملف تعود بحالتها المسجَّلة
        // لا بمحتواها: قراءة الملفات لها مسارها المُحاسَب في مُجمِّع السياق.
        let (body, kind) = match (&source.text_body, source.source_type) {
            (Some(text), SourceType::TextNote | SourceType::UserInstruction | SourceType::SystemContext) => (text.clone(), "TEXT"),
            _ => (
                format!(
                    "source_type={} availability={} bytes={} digest={}",
                    crate::p02::context::model::code(source.source_type),
                    crate::p02::context::model::code(source.availability),
                    source.byte_count.unwrap_or(0),
                    source.digest.clone().unwrap_or_default()
                ),
                "STATE",
            ),
        };
        Ok(ToolOutcome {
            summary: bounded(&body, 1000),
            measured_bytes: body.clone().into_bytes(),
            supports: true,
            detail: format!("{kind} source {} of project {}", source.display_name, project_id),
            evidence: None,
            observation: None,
        })
    }
}

/// أداة تُلحق ملاحظة بمشروع المهمّة. كتابة حقيقية، فموافقتها إلزامية.
pub struct ProjectNoteTool {
    pub sources: Arc<SourceService>,
}

impl ToolAdapter for ProjectNoteTool {
    fn tool_id(&self) -> &str {
        TOOL_PROJECT_NOTE
    }

    fn descriptor(&self) -> ToolDescriptor {
        // `requires_approval` يُفرض في `sealed` من الأثر نفسه؛ إعلانه هنا توثيق لا اعتماد.
        let mut descriptor = base(
            TOOL_PROJECT_NOTE,
            "Append a note to the project",
            "Attaches a text note to this mission's project as a context source. It changes stored data.",
            vec![ToolEffect::WriteLocal, ToolEffect::DatabaseWrite],
        );
        descriptor.requires_approval = true;
        descriptor.risk = RiskClass::Moderate;
        descriptor
    }

    // CP-03-1 (2026-10-20): ما تطلبه `validate` نفسها.
    fn input_schema(&self) -> Option<serde_json::Value> {
        Some(serde_json::json!({
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "a short title, up to 120 characters" },
                "text": { "type": "string", "description": "the note, up to 4000 characters" }
            },
            "required": ["title", "text"],
            "additionalProperties": false
        }))
    }

    fn validate(&self, arguments: &serde_json::Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["title", "text"])?;
        string_field(arguments, "title", 120)?;
        string_field(arguments, "text", 4000)?;
        Ok(())
    }

    fn execute(&self, arguments: &serde_json::Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        let Some(project_id) = context.project_id else {
            return Err(ToolFailure::OutOfScope("this mission has no project to write a note into".into()));
        };
        let title = string_field(arguments, "title", 120)?;
        let text = string_field(arguments, "text", 4000)?;
        let added = self
            .sources
            .add(
                project_id,
                AddSource {
                    source_type: SourceType::TextNote,
                    reference: None,
                    text: Some(text.clone()),
                    display_name: Some(bounded(&title, 120)),
                },
            )
            .map_err(|e| ToolFailure::Unavailable(format!("the note could not be attached: {e:?}")))?;
        let measured = json!({ "source_id": added.source_id, "bytes": text.len() }).to_string();
        Ok(ToolOutcome {
            summary: format!("attached the note {title} to the project as source {}", added.source_id),
            measured_bytes: measured.into_bytes(),
            supports: true,
            detail: format!("source_id={}", added.source_id),
            evidence: None,
            observation: None,
        })
    }
}

/// الأدوات المدمجة، بترتيب ثابت.
pub fn builtin_adapters(audit: Arc<AuditLedger>, sources: Arc<SourceService>) -> Vec<Arc<dyn ToolAdapter>> {
    vec![
        Arc::new(AuditChainTool { audit }),
        Arc::new(ContextReadTool { sources: sources.clone() }),
        Arc::new(ProjectNoteTool { sources }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use polaris_host_providers::net::CancelToken;

    fn context<'a>(cancel: &'a CancelToken, project: Option<&'a str>) -> ToolCallContext<'a> {
        ToolCallContext { mission_id: "m1", task_id: "t1", agent_id: "a1", project_id: project, timeout_ms: 1000, cancel }
    }

    fn audit_tool() -> AuditChainTool {
        let db = Arc::new(crate::storage::Database::in_memory().expect("an in-memory database"));
        AuditChainTool { audit: Arc::new(AuditLedger::new(db)) }
    }

    #[test]
    fn every_builtin_tool_declares_an_effect_and_a_bounded_identifier() {
        let db = Arc::new(crate::storage::Database::in_memory().expect("an in-memory database"));
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let projects = Arc::new(crate::p02::projects::ProjectService::new(db.clone(), audit.clone()));
        let sources = Arc::new(SourceService::new(db, projects, audit.clone()));
        let adapters = builtin_adapters(audit, sources);
        assert_eq!(adapters.len(), 3);
        for adapter in adapters {
            let descriptor = adapter.descriptor().sealed();
            assert!(!descriptor.effects.is_empty(), "{} declares no effect", descriptor.tool_id);
            assert!(super::super::tool::is_valid_tool_id(&descriptor.tool_id));
            assert!(descriptor.capabilities_are_granted(), "{} asks for an ungranted capability", descriptor.tool_id);
        }
    }

    #[test]
    fn the_write_tool_cannot_declare_itself_approval_free() {
        let db = Arc::new(crate::storage::Database::in_memory().expect("an in-memory database"));
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let projects = Arc::new(crate::p02::projects::ProjectService::new(db.clone(), audit.clone()));
        let sources = Arc::new(SourceService::new(db, projects, audit));
        let tool = ProjectNoteTool { sources };
        let mut descriptor = tool.descriptor();
        descriptor.requires_approval = false;
        assert!(descriptor.sealed().requires_approval, "a write tool escaped approval by declaring it away");
    }

    #[test]
    fn the_audit_chain_tool_takes_no_arguments_at_all() {
        let tool = audit_tool();
        assert!(tool.validate(&json!({})).is_ok());
        assert!(matches!(tool.validate(&json!({ "path": "C:/" })), Err(ToolFailure::ArgumentsInvalid(_))));
    }

    #[test]
    fn the_audit_chain_tool_reports_what_it_measured() {
        let tool = audit_tool();
        let cancel = CancelToken::new();
        let outcome = tool.execute(&json!({}), &context(&cancel, None)).expect("the chain is readable");
        assert!(outcome.supports);
        assert!(String::from_utf8_lossy(&outcome.measured_bytes).contains("INTACT"));
    }

    #[test]
    fn a_cancelled_mission_stops_a_tool_before_it_does_anything() {
        let tool = audit_tool();
        let cancel = CancelToken::new();
        cancel.cancel();
        assert_eq!(tool.execute(&json!({}), &context(&cancel, None)), Err(ToolFailure::Cancelled));
    }

    #[test]
    fn the_context_tool_refuses_anything_that_is_not_an_identifier_this_host_issued() {
        let db = Arc::new(crate::storage::Database::in_memory().expect("an in-memory database"));
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let projects = Arc::new(crate::p02::projects::ProjectService::new(db.clone(), audit.clone()));
        let sources = Arc::new(SourceService::new(db, projects, audit));
        let tool = ContextReadTool { sources };
        for bad in ["../../secrets.txt", "C:/Windows/System32/config", "*", "00000000-0000-0000-0000-000000000000"] {
            assert!(
                matches!(tool.validate(&json!({ "source_id": bad })), Err(ToolFailure::ArgumentsInvalid(_))),
                "{bad} was accepted as a source identifier"
            );
        }
        assert!(tool.validate(&json!({ "source_id": crate::ids::new_uuid_v4() })).is_ok());
    }

    #[test]
    fn a_mission_without_a_project_has_no_local_resource_in_scope() {
        let db = Arc::new(crate::storage::Database::in_memory().expect("an in-memory database"));
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let projects = Arc::new(crate::p02::projects::ProjectService::new(db.clone(), audit.clone()));
        let sources = Arc::new(SourceService::new(db, projects, audit));
        let tool = ContextReadTool { sources };
        let cancel = CancelToken::new();
        let outcome = tool.execute(&json!({ "source_id": crate::ids::new_uuid_v4() }), &context(&cancel, None));
        assert!(matches!(outcome, Err(ToolFailure::OutOfScope(_))));
    }
}
