// أداة قياس استرجاع الذاكرة المشتركة (PHASE-08 ثم نقل agentmemory 2026-10-24): مجموعة مدخلات وأسئلة بإجاباتها الصحيحة، وتقييم
// واحد لكل نمط ترتيب: دقّة، واستدعاء، وإصابة الأوائل، وتسريب النطاق، وكشف التعارض، والزمن، ورموز السياق. TEST FIXTURE.
//
// مجموعتان: `dev` (مجموعة PHASE-08، عليها اختير حدّ التشابه 0.6 فهي مجموعة تطوير) و`heldout` (كُتبت قبل أي تعديل في الترتيب
// وثُبّتت بصمتها في وثيقة النقل، ولا يُضبط عليها شيء).

#![allow(dead_code)]

pub mod dev;
pub mod heldout;

use std::time::Instant;

use polaris_host_core::p03::trust::Taint;
use polaris_host_core::p05::memory::context::{self, MemoryContextBudget};
use polaris_host_core::p05::memory::model::*;
use polaris_host_core::p05::memory::retriever::{rank_with, MemoryQuery, Retrieval, SemanticScores};

#[allow(clippy::too_many_arguments)]
pub fn entry(id: &str, memory_type: MemoryType, scope: MemoryScope, mission: Option<&str>, project: Option<&str>, subject: &str, content: &str, minute: u32) -> MemoryEntry {
    let stamp = format!("2026-10-01T10:{minute:02}:00Z");
    MemoryEntry {
        memory_id: id.into(),
        memory_type,
        scope,
        mission_id: mission.map(str::to_string),
        project_id: project.map(str::to_string),
        subject: subject.into(),
        content: content.into(),
        summary: summarise(content),
        content_digest: content_digest(content),
        source_refs: Vec::new(),
        provenance: MemoryProvenance { producer: "fixture".into(), mission_id: mission.map(str::to_string), task_id: None, lineage: Vec::new(), recorded_at: stamp.clone() },
        trust_class: MemoryTrustClass::UserDerived,
        verification: MemoryVerification::Unverified,
        taint: Taint::clean(),
        confidence_source: ConfidenceSource::None,
        importance: 3,
        status: MemoryStatus::Active,
        version: 1,
        created_at: stamp.clone(),
        updated_at: stamp,
        last_accessed_at: None,
        expires_at: None,
        expires_at_ms: None,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Lexical,
    Paraphrase,
    Leak,
}

pub struct Case {
    pub label: &'static str,
    pub kind: Kind,
    pub project: &'static str,
    pub mission: &'static str,
    /// المهامّ الأخرى في محادثة الطلب نفسها.
    pub thread: &'static [&'static str],
    pub text: &'static str,
    pub relevant: &'static [&'static str],
    pub conflict: bool,
}

pub struct Dataset {
    pub name: &'static str,
    pub corpus: Vec<MemoryEntry>,
    pub cases: Vec<Case>,
}

/// شاهد مستقلّ عن `visible`: هل يحقّ لطلب من هذه المهمّة والمشروع والمحادثة أن يرى المدخل؟
pub fn allowed(entry: &MemoryEntry, case: &Case) -> bool {
    match entry.scope {
        MemoryScope::User | MemoryScope::System => true,
        MemoryScope::Project => entry.project_id.as_deref() == Some(case.project),
        MemoryScope::Mission => entry.mission_id.as_deref().is_some_and(|m| m == case.mission || case.thread.contains(&m)),
    }
}

pub fn query_for(case: &Case) -> MemoryQuery {
    let mut q = MemoryQuery::for_mission(case.mission, Some(case.project.to_string()));
    q.text = Some(case.text.to_string());
    q.thread_missions = case.thread.iter().map(|m| m.to_string()).collect();
    q
}

#[derive(Default, Debug)]
pub struct Totals {
    pub retrieved: usize,
    pub true_hits: usize,
    pub recall_sum: f64,
    pub recall_n: usize,
    pub top1: usize,
    pub top3: usize,
    pub hit_n: usize,
    pub leaks: usize,
    pub conflicts_ok: usize,
    pub conflicts_n: usize,
    pub tokens: usize,
    pub micros: u128,
}

impl Totals {
    pub fn precision(&self) -> f64 {
        if self.retrieved == 0 { 0.0 } else { self.true_hits as f64 / self.retrieved as f64 }
    }

    pub fn recall(&self) -> f64 {
        if self.recall_n == 0 { 0.0 } else { self.recall_sum / self.recall_n as f64 }
    }

    pub fn top1_rate(&self) -> f64 {
        if self.hit_n == 0 { 0.0 } else { self.top1 as f64 / self.hit_n as f64 }
    }
}

fn score(case: &Case, retrieval: &Retrieval, t: &mut Totals, misses: &mut Vec<String>) {
    let ids: Vec<&str> = retrieval.items.iter().filter(|r| r.entry.memory_type != MemoryType::Preference).map(|r| r.entry.memory_id.as_str()).collect();
    t.leaks += retrieval.items.iter().filter(|r| !allowed(&r.entry, case)).count();
    t.retrieved += ids.len();
    let hits = ids.iter().filter(|id| case.relevant.contains(id)).count();
    t.true_hits += hits;
    if !case.relevant.is_empty() {
        t.recall_n += 1;
        t.recall_sum += hits as f64 / case.relevant.len() as f64;
        t.hit_n += 1;
        if ids.first().is_some_and(|id| case.relevant.contains(id)) {
            t.top1 += 1;
        }
        if ids.iter().take(3).any(|id| case.relevant.contains(id)) {
            t.top3 += 1;
        } else {
            misses.push(case.label.to_string());
        }
    }
    if case.conflict {
        t.conflicts_n += 1;
        let both = case.relevant.iter().all(|id| ids.contains(id));
        if both && retrieval.conflicts.iter().any(|c| case.relevant.iter().all(|id| c.memory_ids.iter().any(|m| m == id))) {
            t.conflicts_ok += 1;
        }
    }
    t.tokens += context::build(retrieval, MemoryContextBudget::default()).estimated_tokens;
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn summary(dataset: &str, label: &str, kind: Option<Kind>, t: &Totals, cases: usize, misses: &[String]) -> serde_json::Value {
    let row = serde_json::json!({
        "dataset": dataset,
        "mode": label,
        "kind": kind.map(|k| format!("{k:?}")),
        "cases": cases,
        "precision": round3(t.precision()),
        "recall": if t.recall_n == 0 { serde_json::Value::Null } else { serde_json::json!(round3(t.recall())) },
        "top1_hit_rate": if t.hit_n == 0 { serde_json::Value::Null } else { serde_json::json!(round3(t.top1_rate())) },
        "top3_hit_rate": if t.hit_n == 0 { serde_json::Value::Null } else { serde_json::json!(round3(t.top3 as f64 / t.hit_n as f64)) },
        "scope_leaks": t.leaks,
        "conflicts_handled": format!("{}/{}", t.conflicts_ok, t.conflicts_n),
        "avg_context_tokens": t.tokens / cases.max(1),
        "avg_latency_micros": t.micros / cases.max(1) as u128,
        "top3_misses": misses,
    });
    println!("MEMBENCH {row}");
    row
}

/// يجري مجموعة كاملة بنمط واحد ويعيد الصفوف (الإجمالي ثم لكل صنف) والإجمالي.
pub fn run(dataset: &Dataset, label: &str, semantic: &dyn Fn(&Case) -> (Option<SemanticScores>, u128)) -> (Vec<serde_json::Value>, Totals) {
    let mut rows = Vec::new();
    let mut grand = Totals::default();
    for kind in [None, Some(Kind::Lexical), Some(Kind::Paraphrase), Some(Kind::Leak)] {
        let mut t = Totals::default();
        let mut misses = Vec::new();
        let chosen: Vec<&Case> = dataset.cases.iter().filter(|c| kind.is_none_or(|k| c.kind == k)).collect();
        for case in &chosen {
            let (scores, embed_micros) = semantic(case);
            let began = Instant::now();
            let retrieval = rank_with(dataset.corpus.clone(), &query_for(case), &[], scores.as_ref());
            t.micros += began.elapsed().as_micros() + embed_micros;
            score(case, &retrieval, &mut t, &mut misses);
        }
        rows.push(summary(dataset.name, label, kind, &t, chosen.len(), &misses));
        if kind.is_none() {
            grand = t;
        }
    }
    (rows, grand)
}

/// يكتب الصفوف JSON في المجلد `MEMBENCH_REPORT` (أو `CP08_REPORT` القديم) إن ضُبط؛ مكانه `_local` ولا يُرفع.
pub fn write_report(name: &str, rows: &[serde_json::Value]) {
    if let Ok(dir) = std::env::var("MEMBENCH_REPORT").or_else(|_| std::env::var("CP08_REPORT")) {
        let path = std::path::Path::new(&dir).join(name);
        std::fs::write(path, serde_json::to_string_pretty(&rows).expect("json")).expect("write the report");
    }
}
