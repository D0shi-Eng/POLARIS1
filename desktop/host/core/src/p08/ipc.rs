// طبقة IPC لـPhase-08: حمولة مُتحقَّق منها (بالمخطط في البوابة) إلى نداء خدمة، ونتيجة إلى JSON.
//
// القائمة مغلقة ومطابقة للسجل. وما ليس فيها هو الخاصيّة الأمنية: لا عملية تشغّل أمرًا أو
// Python أو تتصفّح أو تكتب في مساحة مهمّة أو تقرأ رمز OAuth أو ترسل بريدًا. العارض يرفق ملفات
// ويقرأ المساحة والمخرجات ويضبط الجداول والإعدادات ويقرّر ما ينتظر قراره؛ أما التنفيذ فمستدعيه
// الوحيد زمن تشغيل المهمّة الموثوق، ومساره الوحيد بوابة الأدوات.

use base64::Engine;
use serde_json::{json, Value};

use crate::ipc::errors::{DesktopErrorCategory, HostError};

use super::artifacts::extract::extract;
use super::execution::Runtime;
use super::integrations::settings::KEYS as SETTING_KEYS;
use super::oauth::{builtin_providers, ConnectionView};
use super::scheduler::model::{MissionTemplate, ScheduleSpec};
use super::scheduler::service::{ApprovalPolicy, RunTarget, ScheduleInput};
use super::service::Phase08;
use super::workspace::{Access, MAX_FILE_BYTES};

/// العمليات التي يملكها Phase-08. مغلقة ومطابقة للسجل.
pub const OPERATIONS: [&str; 63] = [
    "workspace.list",
    "workspace.preview",
    "workspace.export",
    "attachment.stage",
    "attachment.discard",
    "attachment.artifact.stage",
    "attachment.list",
    "attachment.bind",
    "artifact.list",
    "artifact.get",
    "execution.status",
    "execution.runs",
    "execution.runtime.prepare",
    "mission.model.set",
    "schedule.list",
    "schedule.save",
    "schedule.enable",
    "schedule.delete",
    "schedule.run_now",
    "oauth.list",
    "oauth.connect",
    "oauth.disconnect",
    "voice.transcribe",
    "share.list",
    "share.set",
    "publish.list",
    "publish.propose",
    "publish.decide",
    "skill.package.list",
    "skill.package.import",
    "device.export",
    "device.import",
    "integration.settings.set",
    "conversation.begin",
    "conversation.continue",
    "conversation.get",
    "conversation.index",
    "agent.catalog",
    "mission.specialist.set",
    "conversation.update",
    "conversation.delete",
    "project.delete",
    "memory.remember",
    "conversation.search",
    // خطة 2026-10-07 (ADR-041): عارض التتبّع لكل رسالة، وقبول تعريف أداة MCP أُعيد تعريفها.
    "mission.trace",
    "mcp.tool.accept_redefinition",
    // ADR-037: مسجّلة هنا، ومالكها طبقة المزوّدين (`p02::ipc::CATALOG_OPERATIONS`)؛ الموجّه يرسلها إليها.
    "provider.catalog",
    "provider.credential.put",
    "provider.custom.save",
    "provider.custom.delete",
    // ADR-042 (الإغلاق الوظيفي 2026-10-19). `tool.approval.*` مسجّلة هنا ومالكها بوابة الأدوات (Phase-04)؛ الموجّه يرسلها إليها.
    "web.search.status",
    "web.search.credential.put",
    "web.search.test",
    "mission.rating.set",
    "mission.note.add",
    "tool.approval.grants",
    "tool.approval.grant.revoke",
    "github.status",
    "github.connect",
    "github.disconnect",
    // PHASE-12 (قرار المالك): إعداد الاسترجاع الدلالي للذاكرة. لا عملية تقرأ ذاكرة ولا ترسلها: الفحص يضمّن نصًّا ثابتًا.
    "memory.semantic.status",
    "memory.semantic.set",
    "memory.semantic.test",
];

/// أسماء يحرسها هذا الملف بالاسم: وجود أحدها يعني أن للعارض مسارًا إلى أثر لا يمرّ بالبوابة.
pub const FORBIDDEN_OPERATIONS: [&str; 12] = [
    "execution.command",
    "execution.python",
    "execution.run",
    "workspace.write",
    "workspace.delete",
    "browser.execute",
    "browser.navigate",
    "oauth.token.get",
    "oauth.token",
    "email.send",
    "schedule.approve",
    "skill.package.trust",
];

/// أقصى حجم لملف واحد يُرفق من العارض.
pub const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
const PREVIEW_IMAGE_BYTES: u64 = 6 * 1024 * 1024;
const PREVIEW_TEXT_CHARS: usize = 40_000;

pub fn handle(p08: &Phase08, operation: &str, payload: &Value) -> Result<Value, HostError> {
    match operation {
        "workspace.list" => workspace_list(p08, payload),
        "workspace.preview" => workspace_preview(p08, payload),
        "workspace.export" => workspace_export(p08, payload),
        "attachment.stage" => {
            let name = text(payload, "file_name")?;
            let bytes = decode_base64(payload, "content_base64", MAX_ATTACHMENT_BYTES)?;
            let view = p08.attachments.stage(name, &bytes).map_err(|e| fail(e.to_string()))?;
            Ok(json!({ "attachment": view }))
        }
        "attachment.discard" => {
            let id = text(payload, "attachment_id")?;
            let discarded = p08.attachments.discard(id).map_err(|e| fail(e.to_string()))?;
            Ok(json!({ "attachment_id": id, "discarded": discarded }))
        }
        // «المكتبة» في قائمة «+» (مكافأة Manus 2026-10-20): نسخة من ملف مخرَج سابق تصير مرفقًا جديدًا. العارض يسمّي المخرَج بمعرّفه،
        // والمسار يأتي من سجلّ المخرجات وحده؛ الملف يمرّ بفحص التجهيز نفسه الذي يمرّ به أيّ مرفق.
        "attachment.artifact.stage" => {
            let id = text(payload, "artifact_id")?;
            let artifact = p08.artifacts.store.get(id).map_err(|e| fail(e.to_string()))?.ok_or_else(|| HostError::validation("no such artifact").at("/artifact_id"))?;
            if matches!(artifact.artifact_type.as_str(), "WEB_SITE" | "CODE_PROJECT") {
                return Err(HostError::validation("a folder artifact cannot be attached as one file").at("/artifact_id"));
            }
            if !p08.workspaces.exists(&artifact.mission_id) {
                return Err(HostError::validation("the task that produced this artifact no longer has its files").at("/artifact_id"));
            }
            let ws = p08.workspaces.for_mission(&artifact.mission_id).map_err(|e| fail(e.to_string()))?;
            let bytes = ws.read(&artifact.file_ref, MAX_ATTACHMENT_BYTES as u64).map_err(|e| HostError::validation(e.to_string()).at("/artifact_id"))?;
            let name = artifact.file_ref.rsplit('/').next().unwrap_or(&artifact.file_ref);
            let view = p08.attachments.stage(name, &bytes).map_err(|e| fail(e.to_string()))?;
            Ok(json!({ "attachment": view }))
        }
        "attachment.list" => {
            let list = p08.attachments.list(optional(payload, "mission_id")).map_err(|e| fail(e.to_string()))?;
            Ok(json!({ "attachments": list }))
        }
        "attachment.bind" => {
            let mission = text(payload, "mission_id")?;
            let ids: Vec<String> = payload.get("attachment_ids").and_then(Value::as_array).into_iter().flatten().filter_map(|v| v.as_str().map(str::to_string)).collect();
            let bound = p08.attachments.bind(mission, &ids).map_err(|e| fail(e.to_string()))?;
            Ok(json!({ "mission_id": mission, "attachments": bound }))
        }
        "artifact.list" => {
            let list = p08.artifacts.store.list(optional(payload, "mission_id"), 200).map_err(|e| fail(e.to_string()))?;
            Ok(json!({ "artifacts": list }))
        }
        "artifact.get" => {
            let id = text(payload, "artifact_id")?;
            let artifact = p08.artifacts.store.get(id).map_err(|e| fail(e.to_string()))?.ok_or_else(|| HostError::validation("no such artifact").at("/artifact_id"))?;
            let publications: Vec<Value> = p08.publish.list().unwrap_or_default().into_iter().filter(|p| p.artifact_id == artifact.artifact_id).map(|p| json!(p)).collect();
            Ok(json!({ "artifact": artifact, "publications": publications }))
        }
        "execution.status" => Ok(status(p08)),
        "conversation.begin" => {
            let mission = text(payload, "mission_id")?;
            let thread = p08.conversations.begin(mission).map_err(conversation_error)?;
            Ok(json!({ "thread_id": thread, "mission_id": mission }))
        }
        "conversation.continue" => {
            let mission = text(payload, "mission_id")?;
            let message = text(payload, "message")?;
            Ok(json!(p08.conversations.continue_thread(mission, message).map_err(conversation_error)?))
        }
        "conversation.get" => {
            let mission = text(payload, "mission_id")?;
            Ok(json!({ "conversation": p08.conversations.view(mission).map_err(conversation_error)? }))
        }
        // شجرة امتدادات رسالة واحدة بزمنها ورموزها وقرار البوابة، وأحداث الأمن فيها (ADR-041 §3.2). قراءة فقط. OTLP عند الطلب
        // وحده، ولا يُرسل إلى أيّ مكان.
        "mission.trace" => {
            use crate::p03::watch::session::{SessionKind, SessionLog};
            let mission = text(payload, "mission_id")?;
            if !crate::ids::is_uuid_v4(mission) {
                return Err(HostError::validation("mission_id is not valid").at("/payload/mission_id"));
            }
            // CP-10-1: صفحة محدودة، ومجاميع على كل الامتدادات. حدّ خارج المسموح يُرفض هنا كما يرفضه العقد.
            let after = payload.get("after").and_then(Value::as_u64).unwrap_or(0);
            let limit = match payload.get("limit") {
                None => crate::p03::watch::spans::TRACE_PAGE_DEFAULT,
                Some(v) => match v.as_u64().filter(|n| (1..=crate::p03::watch::spans::TRACE_PAGE_MAX as u64).contains(n)) {
                    Some(n) => n as usize,
                    None => return Err(HostError::validation("limit is outside 1..1000").at("/payload/limit")),
                },
            };
            let page = p08.spans.page_for_mission(mission, after, limit);
            let session = p08.conversations.thread_of_mission_id(mission).unwrap_or_else(|| mission.to_string());
            let events = p08.sessions.events(&session);
            let security: Vec<Value> = events
                .iter()
                .filter(|e| e.mission_id == mission && matches!(e.kind, SessionKind::InjectionFlagged | SessionKind::MonitorDecision | SessionKind::SecurityEvent))
                .take(100)
                .map(|e| json!({ "seq": e.seq, "kind": e.payload.get("kind").and_then(Value::as_str).unwrap_or(e.kind.as_str()), "detail": e.payload.get("detail").and_then(Value::as_str).unwrap_or("").chars().take(300).collect::<String>(), "created_at": e.created_at }))
                .collect();
            let chain = match p08.sessions.verify(&session) {
                crate::p03::watch::session::ChainCheck::Intact { events } => json!({ "state": "INTACT", "events": events }),
                crate::p03::watch::session::ChainCheck::Broken { at_seq, .. } => json!({ "state": "BROKEN", "at_seq": at_seq }),
            };
            let mut out = json!({
                "mission_id": mission,
                "semconv": crate::p03::watch::spans::SEMCONV,
                "spans": page.spans,
                "spans_total": page.total,
                "next_after": page.next_after,
                "totals": p08.spans.totals_for_mission(mission),
                "security_events": security,
                "session_events": events.iter().filter(|e| e.mission_id == mission).count(),
                "session_chain": chain,
            });
            if payload.get("include_otlp").and_then(Value::as_bool).unwrap_or(false) {
                // التصدير يطلبه المستخدم صراحةً، فيأخذ المهمّة كاملة لا الصفحة.
                out["otlp"] = crate::p03::watch::spans::to_otlp_json(&p08.spans.for_mission(mission));
            }
            Ok(out)
        }
        "mcp.tool.accept_redefinition" => {
            let tool_id = text(payload, "tool_id")?;
            let accepted = p08.phase04.accept_redefinition(tool_id)?;
            Ok(json!({ "tool_id": tool_id, "accepted": accepted, "pending": p08.phase04.pending_redefinitions() }))
        }
        // كتالوج الوكلاء المتخصّصين: بيانات مضمَّنة للعرض، بلا تعليماتهم (تلك للموجّه وحده).
        "agent.catalog" => {
            let catalog = crate::p03::specialist::SpecialistCatalog::builtin();
            // مكتبة المهارات تُعرض في معرض المهارات لا في دليل الوكلاء.
            let skills = crate::p03::specialist::SKILLS_DOMAIN;
            let domains: Vec<Value> = catalog
                .domains()
                .iter()
                .filter(|d| d.domain_id != skills)
                .map(|d| json!({ "domain_id": d.domain_id, "name_ar": d.name_ar, "name_en": d.name_en, "count": catalog.specialists().iter().filter(|s| s.domain_id == d.domain_id).count() }))
                .collect();
            // كل متخصّص بتعريف الوكيل الذي يفرضه المضيف حين يعمل (القسم 6). لا نتيجة قبول بنموذج حقيقي محمولة في البناء.
            let directory = crate::p03::agents::AgentDirectory::builtin();
            let specialists: Vec<Value> = catalog
                .specialists()
                .iter()
                .filter(|s| s.domain_id != skills)
                .map(|s| {
                    let mut view = serde_json::to_value(s).unwrap_or(Value::Null);
                    if let (Some(d), Some(map)) = (directory.for_specialist(&s.specialist_id), view.as_object_mut()) {
                        map.insert(
                            "agent".into(),
                            json!({
                                "agent_id": d.agent_id, "version": d.version, "tools": d.tools, "memory_namespace": d.memory_namespace,
                                "report_path": d.output.report_path, "max_turns": d.budget.max_turns, "max_tool_calls": d.budget.max_tool_calls,
                                "real_model_acceptance": "NOT_MEASURED",
                            }),
                        );
                    }
                    view
                })
                .collect();
            Ok(json!({ "domains": domains, "specialists": specialists }))
        }
        "mission.specialist.set" => {
            let mission = text(payload, "mission_id")?;
            let specialist = payload.get("specialist_id").and_then(Value::as_str);
            if specialist.is_some_and(|id| crate::p03::specialist::SpecialistCatalog::builtin().get(id).is_none()) {
                return Err(HostError::validation("specialist_id is not a known specialist").at("/specialist_id"));
            }
            p08.preferences.set_specialist(mission, specialist).map_err(fail)?;
            Ok(json!({ "mission_id": mission, "specialist_id": specialist }))
        }
        "conversation.index" => {
            let follow_ups: Vec<Value> = p08.conversations.follow_ups().into_iter().map(|(m, t)| json!({ "mission_id": m, "thread_id": t })).collect();
            Ok(json!({ "follow_ups": follow_ups, "threads": p08.threads.states() }))
        }
        // قائمة «⋯»: الحقل الغائب لا يتغيّر، و`project_id: null` يخرج المحادثة من مشروعها.
        "conversation.update" => {
            let thread = text(payload, "thread_id")?;
            let flag = |key: &str| payload.get(key).and_then(Value::as_bool);
            let changes = super::threads::ThreadChanges {
                title: optional(payload, "title").map(str::to_string),
                pinned: flag("pinned"),
                favorite: flag("favorite"),
                archived: flag("archived"),
                project: payload.get("project_id").map(|v| v.as_str().map(str::to_string)),
            };
            Ok(json!({ "thread": p08.threads.update(thread, changes).map_err(thread_error)? }))
        }
        "conversation.delete" => {
            let thread = text(payload, "thread_id")?;
            let report = p08.threads.delete(thread).map_err(thread_error)?;
            Ok(json!({ "thread_id": report.thread_id, "deleted": true, "turns": report.missions }))
        }
        // «تذكّر هذا» (ADR-032): نصّ المستخدم عنه أو عن مشروع. ليس `memory.write`: لا نوع حرّ ولا نطاق نظام ولا
        // ترقية ثقة؛ الذاكرة USER_DERIVED غير محقَّقة، وتمرّ بمرشّح الأسرار والتكرار كأي مرشّح.
        "memory.remember" => {
            let memory = p08.memory().ok_or_else(|| HostError::new(DesktopErrorCategory::ConfigUnavailable, "DEPENDENCY_UNAVAILABLE", "memory is unavailable on this host"))?;
            let text = text(payload, "text")?;
            let scope = match optional(payload, "scope") {
                Some("PROJECT") => crate::p05::memory::model::MemoryScope::Project,
                _ => crate::p05::memory::model::MemoryScope::User,
            };
            let project = optional(payload, "project_id");
            if scope == crate::p05::memory::model::MemoryScope::Project && !project.is_some_and(|p| p08.threads.project_is_active(p)) {
                return Err(HostError::validation("project memory needs an active project").at("/project_id"));
            }
            let decision = memory.remember(text, optional(payload, "topic"), scope, project, optional(payload, "mission_id")).map_err(|e| fail(e.to_string()))?;
            Ok(json!({ "decision": decision.code(), "memory_id": decision.memory_id(), "reason": decision.reason_code() }))
        }
        "conversation.search" => {
            let query = optional(payload, "query").unwrap_or("");
            let limit = payload.get("limit").and_then(Value::as_u64).unwrap_or(30) as usize;
            Ok(json!({ "results": p08.threads.search(query, limit) }))
        }
        "project.delete" => {
            let project = text(payload, "project_id")?;
            let report = p08.threads.delete_project(project).map_err(thread_error)?;
            Ok(json!({ "project_id": report.project_id, "deleted": true, "detached_missions": report.detached_missions }))
        }
        "execution.runs" => {
            let mission = text(payload, "mission_id")?;
            Ok(json!({ "mission_id": mission, "runs": p08.execution.runs(mission, 100) }))
        }
        "execution.runtime.prepare" => {
            let report = p08.execution.catalog().provision_python().map_err(fail)?;
            Ok(json!({ "runtime": "PYTHON", "available": p08.execution.available(Runtime::Python).is_ok(), "version": report.version, "files": report.files, "bytes": report.bytes, "reused": report.reused }))
        }
        "mission.model.set" => {
            let mission = text(payload, "mission_id")?;
            let model = payload.get("model_id").and_then(Value::as_str);
            p08.preferences.set(mission, model, None).map_err(fail)?;
            Ok(json!({ "mission_id": mission, "model_id": model }))
        }
        "schedule.list" => {
            let mut out = Vec::new();
            for s in p08.scheduler.list().map_err(fail)? {
                let runs = p08.scheduler.runs(&s.schedule_id, 10).unwrap_or_default();
                let mut v = json!(s);
                v["recent_runs"] = json!(runs);
                out.push(v);
            }
            Ok(json!({ "schedules": out }))
        }
        "schedule.save" => schedule_save(p08, payload),
        "schedule.enable" => {
            let id = text(payload, "schedule_id")?;
            let enabled = payload.get("enabled").and_then(Value::as_bool).unwrap_or(false);
            Ok(json!({ "schedule": p08.scheduler.set_enabled(id, enabled).map_err(fail)? }))
        }
        "schedule.delete" => {
            let id = text(payload, "schedule_id")?;
            Ok(json!({ "schedule_id": id, "deleted": p08.scheduler.delete(id).map_err(fail)? }))
        }
        "schedule.run_now" => {
            let id = text(payload, "schedule_id")?.to_string();
            p08.scheduler.get(&id).map_err(fail)?.ok_or_else(|| HostError::validation("no such schedule").at("/schedule_id"))?;
            // التشغيل قد يطول (مهمّة كاملة): يجري في خيط، ونتيجته تظهر في سجلّ الجدول.
            let scheduler = p08.scheduler.clone();
            let run_id = id.clone();
            std::thread::spawn(move || {
                let _ = scheduler.trigger(&run_id, "RUN_NOW");
            });
            Ok(json!({ "schedule_id": id, "started": true }))
        }
        "oauth.list" => {
            let providers: Vec<Value> = builtin_providers().into_iter().map(|p| json!({ "provider_id": p.provider_id, "display_name": p.display_name, "default_scopes": p.default_scopes })).collect();
            let connections: Vec<Value> = p08.oauth.list().map_err(fail)?.into_iter().map(connection_view).collect();
            Ok(json!({ "providers": providers, "connections": connections }))
        }
        "oauth.connect" => {
            let provider = text(payload, "provider_id")?;
            let client = text(payload, "client_id")?;
            let scopes: Vec<String> = payload.get("scopes").and_then(Value::as_array).into_iter().flatten().filter_map(|v| v.as_str().map(str::to_string)).collect();
            let begun = p08.oauth.begin(provider, client, &scopes).map_err(fail)?;
            Ok(json!({ "connection_id": begun.connection_id, "consent_url": begun.authorization_url, "redirect_uri": begun.redirect_uri, "opened_in_browser": begun.opened_in_browser }))
        }
        "oauth.disconnect" => {
            let id = text(payload, "connection_id")?;
            Ok(json!({ "connection_id": id, "revoked": p08.oauth.revoke(id).map_err(fail)? }))
        }
        "voice.transcribe" => {
            let wav = decode_base64(payload, "audio_base64", super::integrations::voice::MAX_AUDIO_BYTES)?;
            let facts = super::integrations::voice::inspect_wav(&wav).map_err(|e| HostError::validation(e).at("/audio_base64"))?;
            let text = p08.transcribe(&wav, optional(payload, "language")).map_err(fail)?;
            Ok(json!({ "text": text, "seconds": facts.seconds }))
        }
        "share.list" => {
            let grants = p08.share.list(text(payload, "object_type")?, text(payload, "object_id")?).map_err(fail)?;
            Ok(json!({ "grants": grants }))
        }
        "share.set" => {
            let (kind, object) = (text(payload, "object_type")?, text(payload, "object_id")?);
            let member = text(payload, "member")?;
            match payload.get("role").and_then(Value::as_str) {
                Some(role) => {
                    p08.share.set(kind, object, member, role).map_err(fail)?;
                }
                None => {
                    if let Some(g) = p08.share.list(kind, object).map_err(fail)?.into_iter().find(|g| g.member == member.trim()) {
                        p08.share.remove(&g.grant_id).map_err(fail)?;
                    }
                }
            }
            Ok(json!({ "grants": p08.share.list(kind, object).map_err(fail)? }))
        }
        "publish.list" => {
            let publishers: Vec<Value> = p08.publish.publishers().into_iter().map(|(id, leaves)| json!({ "publisher_id": id, "leaves_device": leaves })).collect();
            Ok(json!({ "publishers": publishers, "publications": p08.publish.list().map_err(fail)? }))
        }
        "publish.propose" => {
            let view = p08.publish.propose(&p08.artifacts.store, text(payload, "artifact_id")?, text(payload, "publisher_id")?).map_err(fail)?;
            Ok(json!({ "publication": view }))
        }
        "publish.decide" => {
            let grant = text(payload, "decision")? == "GRANT";
            let view = p08.publish.decide(&p08.artifacts.store, text(payload, "publication_id")?, grant).map_err(fail)?;
            Ok(json!({ "publication": view }))
        }
        "skill.package.list" => Ok(json!({ "packages": p08.packages.list().map_err(fail)? })),
        "skill.package.import" => Ok(json!({ "package": p08.packages.import(text(payload, "manifest_json")?).map_err(fail)? })),
        "device.export" => device_export(p08, payload),
        "device.import" => {
            let bundle = decode_base64(payload, "bundle_base64", 64 * 1024 * 1024)?;
            let (folder, files, summary) = p08.device.import_workspace(&bundle).map_err(fail)?;
            Ok(json!({ "import_folder": folder, "files": files, "source_device_id": summary.get("source_device_id"), "source_mission_id": summary.get("source_mission_id") }))
        }
        "web.search.status" => Ok(serde_json::to_value(p08.web_search.status()).map_err(|e| HostError::internal(e.to_string()))?),
        "web.search.credential.put" => {
            let key = payload.get("api_key").and_then(Value::as_str).map(str::to_string);
            let status = p08.web_search.put_brave_key(key).map_err(fail)?;
            Ok(serde_json::to_value(status).map_err(|e| HostError::internal(e.to_string()))?)
        }
        "web.search.test" => Ok(serde_json::to_value(p08.web_search.test()).map_err(|e| HostError::internal(e.to_string()))?),
        "mission.rating.set" => {
            let mission = text(payload, "mission_id")?;
            let rating = payload.get("rating").and_then(Value::as_u64).ok_or_else(|| HostError::validation("rating is required").at("/payload/rating"))?;
            let stored = p08.conversations.rate(mission, rating as u8).map_err(|e| fail(e.to_string()))?;
            Ok(serde_json::to_value(stored).map_err(|e| HostError::internal(e.to_string()))?)
        }
        "mission.note.add" => {
            let mission = text(payload, "mission_id")?;
            let note = p08.conversations.add_note(mission, text(payload, "text")?).map_err(|e| fail(e.to_string()))?;
            Ok(json!({ "note": note }))
        }
        "github.status" => Ok(serde_json::to_value(p08.github.status()).map_err(|e| HostError::internal(e.to_string()))?),
        "github.connect" => {
            let token = text(payload, "token")?.to_string();
            let status = p08.github.connect(token).map_err(fail)?;
            Ok(serde_json::to_value(status).map_err(|e| HostError::internal(e.to_string()))?)
        }
        "github.disconnect" => Ok(serde_json::to_value(p08.github.disconnect().map_err(fail)?).map_err(|e| HostError::internal(e.to_string()))?),
        "memory.semantic.status" => Ok(serde_json::to_value(super::semantic_memory::status(&p08.settings, p08.memory())).map_err(|e| HostError::internal(e.to_string()))?),
        "memory.semantic.set" => {
            let memory = p08.memory().ok_or_else(|| HostError::new(DesktopErrorCategory::ConfigUnavailable, "DEPENDENCY_UNAVAILABLE", "memory is unavailable on this host"))?;
            let input = super::semantic_memory::SemanticInput {
                enabled: payload.get("enabled").and_then(Value::as_bool).ok_or_else(|| HostError::validation("enabled is required").at("/payload/enabled"))?,
                endpoint: optional(payload, "endpoint").map(str::to_string),
                model: optional(payload, "model").map(str::to_string),
                min_similarity: payload.get("min_similarity").and_then(Value::as_f64),
                query_prefix: payload.get("query_prefix").and_then(Value::as_str).map(str::to_string),
                document_prefix: payload.get("document_prefix").and_then(Value::as_str).map(str::to_string),
            };
            super::semantic_memory::save(&p08.settings, &input, &crate::time::format_rfc3339_utc(unix_now())).map_err(fail)?;
            super::semantic_memory::apply(&p08.settings, memory, &p08.http);
            Ok(serde_json::to_value(super::semantic_memory::status(&p08.settings, Some(memory))).map_err(|e| HostError::internal(e.to_string()))?)
        }
        "memory.semantic.test" => Ok(serde_json::to_value(super::semantic_memory::test(&p08.settings, &p08.http)).map_err(|e| HostError::internal(e.to_string()))?),
        "integration.settings.set" => {
            let key = text(payload, "key")?;
            if !super::integrations::settings::generic(key) {
                return Err(HostError::validation("this setting is not set through integration.settings.set").at("/payload/key"));
            }
            let value = payload.get("value").cloned().unwrap_or(Value::Null);
            if key == "voice.transcription_endpoint" {
                if let Some(url) = value.as_str().filter(|s| !s.is_empty()) {
                    polaris_host_providers::net::endpoint::loopback(url).map_err(|_| HostError::permission_denied("the transcription server must be on this computer").at("/value"))?;
                }
            }
            // خادم البحث مثل خادم التفريغ: على الجهاز وحده. عنوان بعيد يُرفض عند الضبط، ثم عند كل استعمال.
            if key == super::web_search::SETTING_ENDPOINT {
                if let Some(url) = value.as_str().filter(|s| !s.is_empty()) {
                    polaris_host_providers::net::endpoint::loopback(url).map_err(|_| HostError::permission_denied("the search server must be on this computer").at("/value"))?;
                }
            }
            p08.settings.set(key, &value, &crate::time::format_rfc3339_utc(unix_now())).map_err(fail)?;
            Ok(json!({ "settings": p08.settings.all() }))
        }
        other => Err(HostError::internal(format!("routed operation {other} has no Phase-08 owner"))),
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// يحوّل خطأ خدمة إلى صنف حدّ. السبب الخاصّ يبقى في التفصيل الداخلي ولا يعبر.
fn fail(detail: impl Into<String>) -> HostError {
    let detail = detail.into();
    let lower = detail.to_ascii_lowercase();
    if detail.starts_with("POLICY") || lower.contains("not permitted") || lower.contains("refused") {
        HostError::permission_denied(detail)
    } else if lower.contains("not configured") || lower.contains("unavailable") || lower.contains("not found") || lower.contains("not been prepared") || lower.contains("no execution sandbox") || lower.contains("could not be reached") {
        HostError::feature_not_available(detail)
    } else if lower.contains("already") {
        HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", detail)
    } else {
        HostError::validation(detail)
    }
}

/// أخطاء المحادثة إلى المفردات المغلقة: مدخل غير صالح تحقّقٌ، وانشغال المحادثة تعارضٌ صريح.
fn thread_error(e: super::threads::ThreadError) -> HostError {
    use super::threads::ThreadError as E;
    match e {
        E::InvalidId | E::UnknownThread => HostError::validation(e.to_string()).at("/thread_id"),
        E::InvalidTitle => HostError::validation(e.to_string()).at("/title"),
        E::UnknownProject => HostError::validation(e.to_string()).at("/project_id"),
        E::StillRunning => HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", e.to_string()),
        E::Storage(_) => HostError::new(DesktopErrorCategory::ConfigUnavailable, "DEPENDENCY_UNAVAILABLE", e.to_string()),
    }
}

fn conversation_error(e: super::conversation::ConversationError) -> HostError {
    use super::conversation::ConversationError as E;
    match e {
        E::InvalidMission | E::EmptyMessage | E::MessageTooLong => HostError::validation(e.to_string()),
        E::UnknownMission => HostError::validation(e.to_string()).at("/mission_id"),
        E::StillRunning | E::AwaitingDecision => HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", e.to_string()),
        E::RuntimeGone | E::Storage(_) => HostError::new(DesktopErrorCategory::ConfigUnavailable, "DEPENDENCY_UNAVAILABLE", e.to_string()),
        E::Create(detail) => fail(detail),
    }
}

fn text<'a>(payload: &'a Value, key: &str) -> Result<&'a str, HostError> {
    payload.get(key).and_then(Value::as_str).ok_or_else(|| HostError::validation(format!("{key} is absent")).at(format!("/{key}")))
}

fn optional<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str)
}

fn decode_base64(payload: &Value, key: &str, max: usize) -> Result<Vec<u8>, HostError> {
    let raw = text(payload, key)?;
    if raw.len() > max / 3 * 4 + 8 {
        return Err(HostError::validation(format!("{key} is larger than the limit")).at(format!("/{key}")));
    }
    base64::engine::general_purpose::STANDARD.decode(raw).map_err(|_| HostError::validation(format!("{key} is not base64")).at(format!("/{key}")))
}

/// ما يعبر من الاتصال: الحالة والنطاقات، ولا مرجع للسرّ ولا قيمته.
fn connection_view(c: ConnectionView) -> Value {
    json!({
        "connection_id": c.connection_id,
        "provider_id": c.provider_id,
        "display_name": c.display_name,
        "client_id": c.client_id,
        "scopes": c.scopes,
        "status": c.status,
        "stored_in_vault": c.token_ref.is_some(),
        "expires_at": c.expires_at,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
    })
}

fn workspace_list(p08: &Phase08, payload: &Value) -> Result<Value, HostError> {
    let mission = text(payload, "mission_id")?;
    if !p08.workspaces.exists(mission) {
        return Ok(json!({ "mission_id": mission, "entries": [], "used_bytes": 0 }));
    }
    let ws = p08.workspaces.for_mission(mission).map_err(|e| fail(e.to_string()))?;
    let depth = payload.get("depth").and_then(Value::as_u64).unwrap_or(4).min(6) as usize;
    let entries = ws.list(optional(payload, "path"), depth).map_err(|e| fail(e.to_string()))?;
    // ملف الطُعم (ADR-041 §3.4) يراه الوكيل في المساحة، ولا تعرضه قائمة المستخدم: ليس من ملفاته.
    let entries: Vec<Value> = entries
        .into_iter()
        .filter(|e| e.path != crate::p03::security::HONEYTOKEN_PATH)
        .take(2_000)
        .map(|e| json!({ "path": e.path, "is_dir": e.is_dir, "size_bytes": e.size_bytes }))
        .collect();
    Ok(json!({ "mission_id": mission, "entries": entries, "used_bytes": ws.used_bytes() }))
}

fn image_mime(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    [(".png", "image/png"), (".jpg", "image/jpeg"), (".jpeg", "image/jpeg"), (".gif", "image/gif"), (".webp", "image/webp")].into_iter().find(|(ext, _)| lower.ends_with(ext)).map(|(_, m)| m)
}

/// معاينة ملف من المساحة. الصور تعود بيانات مضمَّنة (لا SVG: قد يحمل نصًّا برمجيًّا)،
/// والمستندات نصًّا مستخرَجًا، وHTML نصًّا يعرضه العارض في إطار معزول بلا نصوص برمجية.
fn workspace_preview(p08: &Phase08, payload: &Value) -> Result<Value, HostError> {
    let mission = text(payload, "mission_id")?;
    let rel = text(payload, "path")?;
    let ws = p08.workspaces.for_mission(mission).map_err(|e| fail(e.to_string()))?;
    let path = ws.resolve(rel, Access::Read).map_err(|e| HostError::permission_denied(e.to_string()).at("/path"))?;
    let size = std::fs::metadata(&path).map(|m| m.len()).map_err(|_| HostError::validation("the file does not exist").at("/path"))?;
    let max_chars = payload.get("max_chars").and_then(Value::as_u64).map(|n| n as usize).unwrap_or(PREVIEW_TEXT_CHARS).min(200_000);
    let lower = rel.to_ascii_lowercase();
    if let Some(mime) = image_mime(rel) {
        if size > PREVIEW_IMAGE_BYTES {
            return Ok(json!({ "path": rel, "kind": "BINARY", "mime_type": mime, "size_bytes": size, "truncated": true }));
        }
        let bytes = ws.read(rel, PREVIEW_IMAGE_BYTES).map_err(|e| fail(e.to_string()))?;
        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
        return Ok(json!({ "path": rel, "kind": "IMAGE", "mime_type": mime, "size_bytes": size, "data_url": format!("data:{mime};base64,{data}"), "truncated": false }));
    }
    let bytes = ws.read(rel, MAX_FILE_BYTES).map_err(|e| fail(e.to_string()))?;
    let (kind, mime, body) = if lower.ends_with(".html") || lower.ends_with(".htm") {
        ("HTML", "text/html", String::from_utf8_lossy(&bytes).into_owned())
    } else {
        match extract(rel, &bytes) {
            Ok(t) => {
                let kind = if [".docx", ".xlsx", ".pptx", ".pdf"].iter().any(|e| lower.ends_with(e)) { "DOCUMENT" } else { "TEXT" };
                (kind, if kind == "DOCUMENT" { "application/octet-stream" } else { "text/plain" }, t.text)
            }
            Err(_) => return Ok(json!({ "path": rel, "kind": "BINARY", "mime_type": "application/octet-stream", "size_bytes": size, "truncated": false })),
        }
    };
    let truncated = body.chars().count() > max_chars;
    let body: String = body.chars().take(max_chars).collect();
    Ok(json!({ "path": rel, "kind": kind, "mime_type": mime, "size_bytes": size, "text": body, "truncated": truncated }))
}

/// اسم ملف لا يتصادم في مجلد التصدير: الاسم، ثم الاسم (2)…
fn unique_target(root: &std::path::Path, name: &str) -> std::path::PathBuf {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut candidate = root.join(name);
    let mut n = 2;
    while candidate.exists() && n < 1000 {
        candidate = root.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    candidate
}

/// تصدير يطلبه المستخدم من الواجهة: نسخة إلى مجلد التصدير، بلا استبدال لملف قائم.
fn workspace_export(p08: &Phase08, payload: &Value) -> Result<Value, HostError> {
    let root = p08.export_root.clone().ok_or_else(|| HostError::feature_not_available("no export folder is configured on this host"))?;
    let mission = text(payload, "mission_id")?;
    let rel = text(payload, "path")?;
    let ws = p08.workspaces.for_mission(mission).map_err(|e| fail(e.to_string()))?;
    let bytes = ws.read(rel, MAX_FILE_BYTES).map_err(|e| HostError::permission_denied(e.to_string()).at("/path"))?;
    std::fs::create_dir_all(&root).map_err(|e| HostError::internal(e.to_string()))?;
    let name = rel.rsplit('/').next().unwrap_or("export").to_string();
    let target = unique_target(&root, &name);
    std::fs::write(&target, &bytes).map_err(|e| HostError::internal(e.to_string()))?;
    let label = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(name);
    let _ = p08.audit_export(mission, rel, &label, bytes.len());
    Ok(json!({ "file_label": label, "size_bytes": bytes.len(), "sha256": crate::digest::sha256_hex(&bytes) }))
}

fn device_export(p08: &Phase08, payload: &Value) -> Result<Value, HostError> {
    let root = p08.export_root.clone().ok_or_else(|| HostError::feature_not_available("no export folder is configured on this host"))?;
    let mission = text(payload, "mission_id")?;
    let bundle = p08.device.export_workspace(mission).map_err(fail)?;
    std::fs::create_dir_all(&root).map_err(|e| HostError::internal(e.to_string()))?;
    let target = unique_target(&root, &format!("POLARIS-workspace-{}.zip", &mission[..8]));
    std::fs::write(&target, &bundle).map_err(|e| HostError::internal(e.to_string()))?;
    Ok(json!({ "file_label": target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), "size_bytes": bundle.len(), "sha256": crate::digest::sha256_hex(&bundle) }))
}

fn schedule_save(p08: &Phase08, payload: &Value) -> Result<Value, HostError> {
    let template: MissionTemplate = serde_json::from_value(payload.get("mission_template").cloned().unwrap_or(Value::Null)).map_err(|e| HostError::validation(e.to_string()).at("/mission_template"))?;
    let spec: ScheduleSpec = serde_json::from_value(payload.get("schedule").cloned().unwrap_or(Value::Null)).map_err(|e| HostError::validation(e.to_string()).at("/schedule"))?;
    let policy = ApprovalPolicy::parse(text(payload, "approval_policy")?).ok_or_else(|| HostError::validation("approval_policy is not valid").at("/approval_policy"))?;
    let input = ScheduleInput {
        name: text(payload, "name")?.to_string(),
        template,
        timezone: text(payload, "timezone")?.to_string(),
        spec,
        enabled: payload.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        budget: payload.get("budget").cloned().unwrap_or_else(|| json!({})),
        approval_policy: policy,
        end_at: optional(payload, "end_at").map(str::to_string),
        run_target: match optional(payload, "run_target") {
            None => RunTarget::SeparateTask,
            Some(t) => RunTarget::parse(t).ok_or_else(|| HostError::validation("run_target is not valid").at("/run_target"))?,
        },
    };
    let view = match optional(payload, "schedule_id") {
        Some(id) => p08.scheduler.update(id, input),
        None => p08.scheduler.create(input),
    }
    .map_err(fail)?;
    Ok(json!({ "schedule": view }))
}

/// حالة بيئة العمل: العزل، والبيئات، والمتصفّح، والصوت، والإعدادات. لا مسار ملف يعبر.
fn status(p08: &Phase08) -> Value {
    let runtime = |r: Runtime| match p08.execution.available(r) {
        Ok(()) => json!({ "available": true, "detail": "" }),
        Err(e) => json!({ "available": false, "detail": e }),
    };
    let python_version = p08.execution.catalog().python().map(|p| p.version);
    let device = p08.device.identity().map(|(id, _)| id).unwrap_or_default();
    let settings = p08.settings.all();
    json!({
        "isolation": p08.execution.isolation(),
        "powershell": runtime(Runtime::Powershell),
        "python": runtime(Runtime::Python),
        "python_version": python_version,
        "python_source_found": p08.execution.catalog().python_source.as_ref().is_some_and(|p| p.is_dir()),
        "pdf_font_available": p08.pdf_font_available,
        "export_folder_configured": p08.export_root.is_some(),
        "voice_configured": settings.get("voice.transcription_endpoint").and_then(Value::as_str).is_some_and(|s| !s.is_empty()),
        "device_id": device,
        "setting_keys": SETTING_KEYS.iter().filter(|k| super::integrations::settings::generic(k)).collect::<Vec<_>>(),
        "settings": settings,
    })
}
