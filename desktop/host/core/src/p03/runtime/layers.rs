// طبقات خطة 2026-10-07 (ADR-041) في زمن التشغيل: الامتدادات، وسجلّ الجلسة، وأحداث الأمن، وكشف التلاعب، والإثبات المقيس.
//
// لا شيء هنا يقرّر أداة أو يحسم مهمّة بقول النموذج. ما يُكتب في السجلّ هو ما رآه النموذج فعلًا وما قاسه المضيف، وما يرقّي
// الإثبات قياسٌ يخصّ المتطلَّب أو مصحِّح كود على المحتوى.

use serde_json::{json, Value};

use super::support::*;
use super::*;
use crate::p03::claim::ClaimSubject;
use crate::p03::mission::MissionRequirement;
use crate::p03::security::{self, SecurityEvent};
use crate::p03::truth;
use crate::p03::trust::probe;
use crate::p03::watch::session::{SessionDraft, SessionKind};
use crate::p03::watch::spans::{new_span_id, trace_id_of, SpanRecord};

impl MissionRuntime {
    // ——— الامتدادات

    /// يفتح امتداد `invoke_agent` لوكيل، وأبوه امتداد الوكيل الطالب إن وُجد. يصير الوكيل النشط.
    pub(super) fn open_agent_span(&mut self, agent_id: &str, parent_agent: Option<&str>, task_id: &str) {
        let parent = parent_agent.and_then(|a| self.agent_spans.get(a)).map(|s| s.span_id.clone());
        let span = SpanRecord {
            span_id: new_span_id(),
            trace_id: trace_id_of(&self.mission.mission_id),
            parent_span_id: parent,
            mission_id: self.mission.mission_id.clone(),
            name: "invoke_agent",
            agent_id: Some(agent_id.to_string()),
            task_id: Some(task_id.to_string()),
            model_id: None,
            provider_id: None,
            tool_id: None,
            invocation_id: None,
            input_tokens: None,
            output_tokens: None,
            latency_ms: None,
            cost_micros: None,
            status: "OK",
            gate_decision: None,
            started_at: self.clock.now(),
        };
        let failed = self.spans.as_ref().and_then(|sink| sink.record(&span).err());
        if let Some(detail) = failed {
            self.note_telemetry_failure(&detail);
        }
        self.agent_spans.insert(agent_id.to_string(), span);
        self.active_agent = Some(agent_id.to_string());
    }

    /// يغلق امتداد وكيل بزمنه ورموز نداءاته وحالته.
    pub(super) fn close_agent_span(&mut self, agent_id: &str, started: std::time::Instant, status: &'static str) {
        let mut failed = None;
        if let Some(span) = self.agent_spans.get_mut(agent_id) {
            span.latency_ms = Some(started.elapsed().as_millis() as u64);
            span.status = status;
            if let Some(sink) = &self.spans {
                failed = sink.record(span).err();
            }
        }
        if let Some(detail) = failed {
            self.note_telemetry_failure(&detail);
        }
    }

    fn active_parent(&self) -> Option<String> {
        self.active_agent.as_ref().and_then(|a| self.agent_spans.get(a)).map(|s| s.span_id.clone())
    }

    /// امتداد `chat` لمحاولة نداء واحدة، ينتظر حقائق المسار (`flush_chat_spans`).
    pub(super) fn record_chat_spans(&mut self, started_at: &str, latency_ms: u64, failure: Option<String>) {
        if self.spans.is_none() {
            return;
        }
        let span = SpanRecord {
            span_id: new_span_id(),
            trace_id: trace_id_of(&self.mission.mission_id),
            parent_span_id: self.active_parent(),
            mission_id: self.mission.mission_id.clone(),
            name: "chat",
            agent_id: self.active_agent.clone(),
            task_id: None,
            model_id: None,
            provider_id: None,
            tool_id: None,
            invocation_id: None,
            input_tokens: None,
            output_tokens: None,
            latency_ms: Some(latency_ms),
            cost_micros: None,
            status: match failure.as_deref() {
                None => "OK",
                Some("CANCELLED") => "CANCELLED",
                Some(_) => "ERROR",
            },
            gate_decision: failure,
            started_at: started_at.to_string(),
        };
        self.pending_chat.push(span);
    }

    /// يكتب امتدادات النداءات المعلّقة بحقائق مسار الاستدعاء: كل حقيقة (نداء أُرسل فعلًا) امتداد، بترتيبها. منفذ بلا حقائق
    /// (تجهيزة) يبقى امتداده بما عرفه زمن التشغيل، ورموز الدور الأخير إن أُعطيت.
    pub(super) fn flush_chat_spans(&mut self, model: &dyn AgentModel, last_tokens: Option<(u64, u64)>) {
        let facts = model.take_call_facts();
        self.flush_chat_spans_with(facts, last_tokens);
    }

    /// كالسابق بحقائق أخذها المستدعي (G4: حقائق نداء فرع موازٍ كما أخذها خيطه، ثم ما جرى بعده على الخيط الرئيسي).
    pub(super) fn flush_chat_spans_with(&mut self, facts: Vec<crate::p03::port::CallFacts>, last_tokens: Option<(u64, u64)>) {
        let mut pending: Vec<SpanRecord> = std::mem::take(&mut self.pending_chat);
        if self.spans.is_none() {
            return;
        }
        let parent = self.active_parent();
        let mut written: Vec<SpanRecord> = Vec::new();
        let mut facts = facts.into_iter();
        for mut span in pending.drain(..) {
            if let Some(fact) = facts.next() {
                apply_facts(&mut span, &fact);
            }
            written.push(span);
        }
        // نداءات لم تمرّ بالنداء المحروس (العنوان مثلًا): امتداد لكلّ منها أيضًا.
        for fact in facts {
            let mut span = SpanRecord {
                span_id: new_span_id(),
                trace_id: trace_id_of(&self.mission.mission_id),
                parent_span_id: parent.clone(),
                mission_id: self.mission.mission_id.clone(),
                name: "chat",
                agent_id: self.active_agent.clone(),
                task_id: None,
                model_id: None,
                provider_id: None,
                tool_id: None,
                invocation_id: None,
                input_tokens: None,
                output_tokens: None,
                latency_ms: None,
                cost_micros: None,
                status: "OK",
                gate_decision: None,
                started_at: self.clock.now(),
            };
            apply_facts(&mut span, &fact);
            written.push(span);
        }
        if let (Some(last), Some((input, output))) = (written.last_mut(), last_tokens) {
            if last.status == "OK" && last.input_tokens.is_none() {
                last.input_tokens = Some(input);
                last.output_tokens = Some(output);
            }
        }
        let failed = self.spans.as_ref().and_then(|sink| written.iter().filter_map(|span| sink.record(span).err()).next());
        if let Some(detail) = failed {
            self.note_telemetry_failure(&detail);
        }
    }

    /// امتداد `execute_tool` بقرار البوابة وزمنه.
    pub(super) fn record_tool_span(&mut self, agent_id: &str, task_id: &str, decision: &ToolDecision, started_at: &str, latency_ms: u64) {
        let Some(sink) = self.spans.clone() else { return };
        let parent = self.agent_spans.get(agent_id).map(|s| s.span_id.clone()).or_else(|| self.active_parent());
        let status = match decision.status.as_str() {
            "SUCCEEDED" => "OK",
            "DENIED" => "DENIED",
            "AWAITING_APPROVAL" => "AWAITING_APPROVAL",
            "CANCELLED" => "CANCELLED",
            _ => "ERROR",
        };
        let written = sink.record(&SpanRecord {
            span_id: new_span_id(),
            trace_id: trace_id_of(&self.mission.mission_id),
            parent_span_id: parent,
            mission_id: self.mission.mission_id.clone(),
            name: "execute_tool",
            agent_id: Some(agent_id.to_string()),
            task_id: Some(task_id.to_string()),
            model_id: None,
            provider_id: None,
            tool_id: Some(decision.tool_id.clone()),
            invocation_id: Some(decision.invocation_id.clone()).filter(|i| !i.is_empty()),
            input_tokens: None,
            output_tokens: None,
            latency_ms: Some(latency_ms),
            cost_micros: None,
            status,
            gate_decision: Some(decision.denial_reason.clone().unwrap_or_else(|| decision.status.clone())),
            started_at: started_at.to_string(),
        });
        if let Err(detail) = written {
            self.note_telemetry_failure(&detail);
        }
    }

    /// امتداد `chat` لنداء المراقب (R-05): منسوب إلى الوكيل والخطوة والأداة المحكوم عليها، بنموذجه ومزوّده ورموزه وقراره.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn record_monitor_span(&mut self, agent_id: &str, task_id: &str, tool_id: &str, verdict: &crate::p03::watch::monitor::MonitorVerdict, facts: &[CallFacts], started_at: &str, latency_ms: u64) {
        let Some(sink) = self.spans.clone() else { return };
        let parent = self.agent_spans.get(agent_id).map(|s| s.span_id.clone()).or_else(|| self.active_parent());
        let mut span = SpanRecord {
            span_id: new_span_id(),
            trace_id: trace_id_of(&self.mission.mission_id),
            parent_span_id: parent,
            mission_id: self.mission.mission_id.clone(),
            name: "chat",
            agent_id: Some(agent_id.to_string()).filter(|a| !a.is_empty()),
            task_id: Some(task_id.to_string()),
            model_id: None,
            provider_id: None,
            tool_id: Some(tool_id.to_string()),
            invocation_id: None,
            input_tokens: None,
            output_tokens: None,
            latency_ms: Some(latency_ms),
            cost_micros: None,
            status: "OK",
            gate_decision: None,
            started_at: started_at.to_string(),
        };
        if let Some(fact) = facts.last() {
            apply_facts(&mut span, fact);
        }
        span.gate_decision = Some(verdict.code().to_string());
        if let Err(detail) = sink.record(&span) {
            self.note_telemetry_failure(&detail);
        }
    }

    // ——— سجلّ الجلسة

    /// يُلحق حدثًا بجلسة (`sub` جلسة فرعية لوكيل مساعد: محادثته النظيفة لا تدخل محادثة الطالب). يعيد رقمه.
    ///
    /// R-06 (2026-10-12): سجلّ الجلسة مصدر الاستئناف، فتعذّر الإلحاق لا يُبتلع: يُسجَّل عطلًا يوقف المسار قبل النداء أو الأثر التالي.
    pub(super) fn log_event(&self, sub: Option<&str>, kind: SessionKind, authority: AuthorityClass, payload: Value) -> Option<i64> {
        let (log, session_id) = self.session.as_ref()?;
        let session_id = match sub {
            Some(agent) => format!("{}/{}", session_id.chars().take(36).collect::<String>(), agent.chars().take(12).collect::<String>()),
            None => session_id.clone(),
        };
        match log.append(SessionDraft { session_id, mission_id: self.mission.mission_id.clone(), kind, authority, payload, parent_seq: None }) {
            Ok(seq) => Some(seq),
            Err(detail) => {
                self.note_storage_fault("SESSION_LOG_WRITE_FAILED", &detail);
                None
            }
        }
    }

    // ——— الأمن

    /// يسجّل حدث أمن: في التشغيل، وعند المراقب (المضيف يكتبه حدث مراقبة وتنبيهًا)، وفي سجلّ الجلسة.
    pub(super) fn security(&mut self, kind: &'static str, task_id: Option<&str>, detail: String) {
        let event = SecurityEvent { kind, task_id: task_id.map(str::to_string), detail: bounded_preview(&detail, 300) };
        if let Some(observer) = &self.observer {
            observer.security_event(&self.mission.mission_id, &event);
        }
        let session_kind = match kind {
            "INJECTION_FLAGGED" => SessionKind::InjectionFlagged,
            "MONITOR_BLOCKED" | "MONITOR_ALLOWED" | "MONITOR_UNCLEAR" | "MONITOR_UNAVAILABLE" => SessionKind::MonitorDecision,
            _ => SessionKind::SecurityEvent,
        };
        self.log_event(None, session_kind, AuthorityClass::TrustedRuntimeFact, json!({ "kind": kind, "task_id": task_id, "detail": event.detail }));
        self.security_events.push(event);
    }

    /// مسبار الحقن على نصّ غير موثوق. يعيد التحذير المثبَّت إن وجد نمطًا، ويسجّله.
    pub(super) fn probe_untrusted(&mut self, text: &str, source: &str, task_id: Option<&str>) -> Option<String> {
        let finding = probe::scan(text)?;
        let families: Vec<&str> = finding.families.iter().map(|f| f.as_str()).collect();
        self.security("INJECTION_FLAGGED", task_id, format!("{source}: {} — {}", families.join(","), finding.excerpt));
        Some(probe::warning(&finding, &self.mission.objective))
    }

    /// كشف التلاعب قبل الحسم: الملفات المحميّة كما بُصمت عند البدء، مقابل المساحة الآن.
    pub(super) fn check_tamper(&mut self) -> Option<String> {
        let probe = self.probe.clone()?;
        let protected = probe.protected_files(&self.mission.mission_id);
        if protected.is_empty() {
            return None;
        }
        // ملف محميّ سمّاه المستخدم في طلبه يجوز تعديله؛ نسخة اختبار مرجعي لا (ADR-041 §3.4).
        let objective = self.mission.objective.to_lowercase();
        let protected: Vec<(String, String)> = protected
            .into_iter()
            .filter(|(path, _)| security::is_reference_check(path) || !objective.contains(&path.to_lowercase()) && !objective.contains(&path.rsplit('/').next().unwrap_or(path).to_lowercase()))
            .collect();
        let files = probe.workspace_files(&self.mission.mission_id);
        let changed = security::tampered(&protected, &files, |p| probe.file_digest(&self.mission.mission_id, p));
        if changed.is_empty() {
            return None;
        }
        let detail = changed.join("; ");
        self.security("TAMPER_DETECTED", None, detail.clone());
        Some(detail)
    }

    // ——— الحقيقة

    /// هل لهذه الخطوة قياس يخصّها: أداة نجحت عند البوابة نُسبت إليها، في هذا التشغيل أو في سجلّ البوابة.
    pub(super) fn step_measured(&self, task_id: &str) -> bool {
        let here = self.tool_decisions.iter().zip(&self.decision_tasks).any(|(d, t)| t == task_id && d.status == "SUCCEEDED");
        here || self.probe.as_ref().is_some_and(|p| p.tool_history(&self.mission.mission_id).iter().any(|r| r.task_id == task_id && r.status == "SUCCEEDED"))
    }

    /// متطلَّبات المهمّة من عقدها، كلٌّ بادّعاء يتحقّق بقياس المضيف وحده، والنصّ المطلوب حرفيًّا بمصحِّح كود (ADR-041 §3.3).
    /// متطلَّبات أعلنها المستخدم صراحةً تسود: لا يُضاف إليها شيء.
    pub(super) fn settle_measured_proof(&mut self) {
        let Some(probe) = self.probe.clone() else { return };
        // CP-09-1: متطلَّبات عقود الوكلاء (`AGENT-n`) يضيفها المضيف أثناء التشغيل، فليست متطلَّبات أعلنها المستخدم. قِيس في تشغيل
        // Bonsai 2 (2026-10-21) أن وجودها كان يُسقط قياس عقد الطلب، فسُجّلت مهمّتان PROVEN بتقريرَي الوكيلين وحدهما.
        let declared = self.mission.requirements.iter().any(|r| !r.requirement_id.starts_with(super::agents::AGENT_REQUIREMENT_PREFIX));
        if declared || self.contract.is_empty() {
            return;
        }
        let mission_id = self.mission.mission_id.clone();
        let checks = if self.contract_checks.is_empty() { fulfilment::evaluate(&self.contract, &mission_id, probe.as_ref()) } else { self.contract_checks.clone() };
        for check in &checks {
            let (property, value) = truth::requirement_property(&check.kind);
            let summary = if check.satisfied { format!("[POLARIS_MEASUREMENT] {property}: {value} — {}", check.detail) } else { format!("[POLARIS_MEASUREMENT] not satisfied — {}", check.detail) };
            let evidence = self.measured_evidence(crate::p03::evidence::EvidenceType::RuntimeMeasurement, "polaris.runtime/contract", &format!("contract:{}", check.id), &summary);
            let mut claim = Claim::from_agent(self.clock.id(), &mission_id, "polaris.runtime", &check.description, ClaimType::RequirementSatisfaction, Taint::clean(), self.clock.now());
            claim.subject = Some(ClaimSubject { subject: check.id.clone(), property: property.to_string(), value });
            if check.satisfied {
                claim.evidence_refs = vec![evidence];
            } else {
                claim.counterevidence_refs = vec![evidence];
            }
            let mut requirement = MissionRequirement::new(check.id.clone(), bounded_preview(&check.description, 400), "p03.rule.fact", true);
            requirement.claim_ref = Some(claim.claim_id.clone());
            self.claims.push(claim);
            self.mission.requirements.push(requirement);
        }
        // مصحِّح كود على المحتوى: ما سمّاه المستخدم عنوانًا أو اسمًا بين علامتي اقتباس يوجد حرفيًّا في مخرَج.
        let deliverables: Vec<String> = self
            .contract
            .requirements
            .iter()
            .filter_map(|r| match &r.kind {
                crate::p03::contract::RequirementKind::Artifact { path, .. } => Some(path.clone()),
                _ => None,
            })
            .collect();
        for (i, needle) in truth::required_texts(&self.mission.objective).iter().enumerate() {
            let texts: Vec<(String, String)> = deliverables.iter().filter_map(|p| probe.file_text(&mission_id, p).map(|t| (p.clone(), t))).collect();
            let statement = format!("the deliverable contains the requested text «{needle}»");
            let mut claim = Claim::from_agent(self.clock.id(), &mission_id, "polaris.runtime", &statement, ClaimType::RequirementSatisfaction, Taint::clean(), self.clock.now());
            if !texts.is_empty() {
                let found = texts.iter().find(|(_, t)| truth::contains_text(t, needle)).map(|(p, _)| p.clone());
                let summary = match &found {
                    Some(path) => format!("[CODE_GRADER] «{needle}» found in {path}"),
                    None => format!("[CODE_GRADER] «{needle}» not found in {}", texts.iter().map(|(p, _)| p.as_str()).collect::<Vec<_>>().join(", ")),
                };
                let evidence = self.measured_evidence(crate::p03::evidence::EvidenceType::GraderResult, "polaris.truth/required_text", &format!("grader:text:{i}"), &summary);
                if found.is_some() {
                    claim.evidence_refs = vec![evidence];
                } else {
                    claim.counterevidence_refs = vec![evidence];
                }
            }
            let mut requirement = MissionRequirement::new(format!("T{}", i + 1), bounded_preview(&statement, 400), "p03.rule.fact", true);
            requirement.claim_ref = Some(claim.claim_id.clone());
            self.claims.push(claim);
            self.mission.requirements.push(requirement);
        }
        // R-02 (2026-10-12): وجود الملف وصيغته الصالحة ونصوصه المقتبسة لا تثبت أن محتواه يفي بالطلب (إجمالي صحيح، أقسام مطلوبة،
        // معلومة صحيحة). لكل مخرَج متطلَّب محتوى إلزامي لا يستوفيه في هذا البناء إلا تحقّق محتوى صريح؛ لا مصحِّح عامّ للمحتوى
        // موجود، فيبقى UNVERIFIED وتبقى المهمّة غير مُثبَتة بدل أن تُثبَت بوجود ملف. الحدّ معلن في الإثبات نفسه.
        for (i, path) in deliverables.iter().enumerate() {
            let id = format!("C{}", i + 1);
            let statement = format!("the content of {path} meets the request (no automatic content check exists for this; existence and format alone do not prove it)");
            let mut claim = Claim::from_agent(self.clock.id(), &mission_id, "polaris.runtime", &statement, ClaimType::RequirementSatisfaction, Taint::clean(), self.clock.now());
            claim.subject = Some(ClaimSubject { subject: id.clone(), property: "content".into(), value: "meets the request".into() });
            let mut requirement = MissionRequirement::new(id, bounded_preview(&statement, 400), "p03.rule.fact", true);
            requirement.claim_ref = Some(claim.claim_id.clone());
            self.claims.push(claim);
            self.mission.requirements.push(requirement);
        }
        self.verify_new_claims();
        self.settle_requirements();
    }

    /// مصحِّح الاقتباسات على الردّ الحقيقي (تكليف 2026-10-12؛ كان `citation_grounded` مستعملًا في اختباره وحده): حين جُلبت صفحات
    /// ويب في هذه المهمّة وفي الردّ اقتباسات، يُطلب أن يوجد كل اقتباس حرفيًّا (بعد التطبيع) في صفحة جُلبت فعلًا. متطلَّب إلزامي
    /// بحكم مصحِّح: اقتباس لا أصل له فيما جُلب يُبقي المهمّة غير مُثبَتة. الحدّ: يقرأ المصحِّح نصّ الصفحة كما أعادته الأداة
    /// (قد يكون مقصوصًا)، فقد يعدّ اقتباسًا صحيحًا من الجزء المقصوص غير مؤصَّل — خطأ في اتجاه التحفّظ لا الادّعاء.
    pub(super) fn settle_citations(&mut self, answer: &str) {
        let fetched: Vec<String> = self
            .tool_decisions
            .iter()
            .filter(|d| d.status == "SUCCEEDED" && matches!(d.tool_id.as_str(), "polaris.web.read_page" | "polaris.web.search" | "polaris.browser.read"))
            .filter_map(|d| d.observation.clone())
            .collect();
        let quotes = truth::quotes_in(answer);
        if fetched.is_empty() || quotes.is_empty() {
            return;
        }
        let mission_id = self.mission.mission_id.clone();
        let ungrounded: Vec<&String> = quotes.iter().filter(|q| !truth::citation_grounded(q, &fetched)).collect();
        let summary = if ungrounded.is_empty() {
            format!("[CITATION_GRADER] {} quotation(s) in the reply appear in pages fetched during this task", quotes.len())
        } else {
            format!("[CITATION_GRADER] {} of {} quotation(s) do not appear in any page fetched during this task: {}", ungrounded.len(), quotes.len(), ungrounded.iter().map(|q| format!("«{}»", bounded_preview(q, 60))).collect::<Vec<_>>().join(", "))
        };
        let evidence = self.measured_evidence(crate::p03::evidence::EvidenceType::GraderResult, "polaris.truth/citation", "grader:citations", &summary);
        let statement = "every quotation in the reply appears in a page fetched during this task".to_string();
        let id = format!("Q{}", self.mission.requirements.iter().filter(|r| r.requirement_id.starts_with('Q')).count() + 1);
        let mut claim = Claim::from_agent(self.clock.id(), &mission_id, "polaris.runtime", &statement, ClaimType::RequirementSatisfaction, Taint::clean(), self.clock.now());
        claim.subject = Some(ClaimSubject { subject: id.clone(), property: "citations".into(), value: if ungrounded.is_empty() { "grounded".into() } else { "ungrounded".into() } });
        if ungrounded.is_empty() {
            claim.evidence_refs = vec![evidence];
        } else {
            claim.counterevidence_refs = vec![evidence];
            self.security("CITATION_UNGROUNDED", None, summary.clone());
        }
        let mut requirement = MissionRequirement::new(id, bounded_preview(&statement, 400), "p03.rule.fact", true);
        requirement.claim_ref = Some(claim.claim_id.clone());
        self.claims.push(claim);
        self.mission.requirements.push(requirement);
        self.verify_new_claims();
        self.settle_requirements();
    }

    /// PHASE-09 (صدق الوكيل): كل فعل يقول الردّ إنه جرى (بحث ويب، فتح صفحة، قراءة بريد، تشغيل كود، اختبارات ناجحة، موصل،
    /// عمل متوازٍ) يجب أن يقابله حدث تنفيذ في المهمّة: أداة نجحت عند البوابة، أو تشغيل اختبارات وسمه المحوّل الموثوق ناجحًا، أو
    /// جولة تفويض جرت فروعها معًا. ادّعاء بلا حدث = متطلَّب إلزامي غير مستوفى وحدث أمني، فلا تُثبَت المهمّة بقول.
    pub(super) fn settle_action_claims(&mut self, answer: &str) {
        let claims = truth::action_claims(answer);
        if claims.is_empty() {
            return;
        }
        let history = self.probe.as_ref().map(|p| p.tool_history(&self.mission.mission_id)).unwrap_or_default();
        let mut succeeded: Vec<String> = self.tool_decisions.iter().filter(|d| d.status == "SUCCEEDED").map(|d| d.tool_id.clone()).collect();
        succeeded.extend(history.iter().filter(|r| r.status == "SUCCEEDED").map(|r| r.tool_id.clone()));
        let tests_passed = self
            .tool_decisions
            .iter()
            .filter(|d| d.status == "SUCCEEDED" && crate::p03::fulfilment::TEST_CAPABLE_TOOLS.contains(&d.tool_id.as_str()))
            .map(|d| d.summary.as_str())
            .chain(history.iter().filter(|r| r.status == "SUCCEEDED" && crate::p03::fulfilment::TEST_CAPABLE_TOOLS.contains(&r.tool_id.as_str())).map(|r| r.summary.as_str()))
            .any(|s| s.contains(crate::p03::fulfilment::TESTS_PASSED_TAG));
        let done = truth::ExecutedActions { succeeded_tools: succeeded, tests_passed, parallel_rounds: self.parallel_rounds };
        let unbacked: Vec<&'static str> = claims.iter().filter(|c| !truth::action_backed(**c, &done)).map(|c| c.as_str()).collect();
        let said: Vec<&'static str> = claims.iter().map(|c| c.as_str()).collect();
        let summary = if unbacked.is_empty() {
            format!("[ACTION_GRADER] every action the reply reports has an executed event: {}", said.join(", "))
        } else {
            format!("[ACTION_GRADER] the reply reports {} of {} action(s) that no executed event backs: {}", unbacked.len(), said.len(), unbacked.join(", "))
        };
        let evidence = self.measured_evidence(crate::p03::evidence::EvidenceType::GraderResult, "polaris.truth/actions", "grader:actions", &summary);
        let mission_id = self.mission.mission_id.clone();
        let statement = "every action the reply reports was actually executed in this task".to_string();
        let id = format!("A{}", self.mission.requirements.iter().filter(|r| r.requirement_id.starts_with('A') && !r.requirement_id.starts_with(super::agents::AGENT_REQUIREMENT_PREFIX)).count() + 1);
        let mut claim = Claim::from_agent(self.clock.id(), &mission_id, "polaris.runtime", &statement, ClaimType::RequirementSatisfaction, Taint::clean(), self.clock.now());
        claim.subject = Some(ClaimSubject { subject: id.clone(), property: "actions".into(), value: if unbacked.is_empty() { "backed".into() } else { "unbacked".into() } });
        if unbacked.is_empty() {
            claim.evidence_refs = vec![evidence];
        } else {
            claim.counterevidence_refs = vec![evidence];
            self.security("ACTION_UNBACKED", None, summary.clone());
        }
        let mut requirement = MissionRequirement::new(id, bounded_preview(&statement, 400), "p03.rule.fact", true);
        requirement.claim_ref = Some(claim.claim_id.clone());
        self.claims.push(claim);
        self.mission.requirements.push(requirement);
        self.verify_new_claims();
        self.settle_requirements();
    }

    /// حكم مصحِّح الكود على ملاحظة مقيسة أظهرت قيمة ادّعاء حرفيًّا (ADR-041 §3.3). سلالته الملاحظة نفسها.
    pub(super) fn observed_value_grade(&mut self, observation_id: &str, value: &str) -> String {
        let summary = format!("[CODE_GRADER] the measured observation {observation_id} shows «{}» literally", bounded_preview(value, 300));
        let id = self.measured_evidence(crate::p03::evidence::EvidenceType::GraderResult, "polaris.truth/observed_value", &format!("observation:{observation_id}"), &summary);
        if let Some(item) = self.evidence.iter_mut().find(|e| e.evidence_id == id) {
            item.provenance.lineage.push(observation_id.to_string());
        }
        id
    }

    fn measured_evidence(&mut self, kind: crate::p03::evidence::EvidenceType, producer: &str, source: &str, summary: &str) -> String {
        let evidence_id = self.clock.id();
        self.evidence.push(EvidenceItem {
            evidence_id: evidence_id.clone(),
            mission_id: self.mission.mission_id.clone(),
            evidence_type: kind,
            created_at: self.clock.now(),
            digest: crate::digest::sha256_hex(summary.as_bytes()),
            provenance: Provenance { producer: producer.into(), authority: AuthorityClass::TrustedRuntimeFact, source_ref: source.into(), lineage: vec![source.into()], measurement_kind: MeasurementKind::Measured },
            taint: Taint::clean(),
            summary: bounded_preview(summary, 1_000),
        });
        evidence_id
    }
}

fn apply_facts(span: &mut SpanRecord, fact: &CallFacts) {
    span.invocation_id = Some(fact.invocation_id.clone());
    span.model_id = fact.model_id.clone();
    span.provider_id = fact.provider_id.clone();
    span.input_tokens = fact.input_tokens;
    span.output_tokens = fact.output_tokens;
    if fact.latency_ms.is_some() {
        span.latency_ms = fact.latency_ms;
    }
    span.status = fact.status;
    if fact.reason.is_some() {
        span.gate_decision = fact.reason.clone();
    }
}
