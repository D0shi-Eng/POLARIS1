// استرجاع الذاكرة: حتمي ومحلي، معجمي (BM25) ودلالي اختياري من منفذ تضمين محلي، بلا خدمة خارجية.
//
// الترتيب (البند 10): المرشّحون ← الترتيب ← النطاق ← المنشأ ← الميزانية. النطاق يُفرض
// مرّتين: في استعلام المخزن (لا يُقرأ ما لا يجوز رؤيته أصلًا)، ثم هنا بفحص صريح لكل
// مدخل. والاسترجاع لا يرفع الثقة: الترتيب يقرأ الأهمية والحداثة والصلة، ولا يكافئ
// «مربوطًا بدليل» — فالذاكرة ليست حقيقة ولو كانت كذلك يومًا.

use std::collections::HashMap;

use super::analyzer;
use super::bm25::Bm25;
use super::fusion;
use super::model::{normalise, ConflictState, MemoryEntry, MemoryScope, MemoryType};
use super::store::MemoryConflict;

/// طلب استرجاع لمهمّة واحدة.
#[derive(Debug, Clone)]
pub struct MemoryQuery {
    pub mission_id: String,
    pub project_id: Option<String>,
    pub include_user: bool,
    pub include_system: bool,
    pub types: Vec<MemoryType>,
    pub subject: Option<String>,
    pub text: Option<String>,
    pub limit: usize,
    /// المهامّ الأخرى في المحادثة نفسها (كل رسالة في المحادثة مهمّة). ذاكرة نطاق المهمّة تُرى عبرها كلها، لا
    /// خارجها (قِيس 2026-10-05: الرسالة الثانية في المحادثة لم تكن ترى ما تعلّمته الأولى). يملؤها المخزن.
    pub thread_missions: Vec<String>,
}

impl MemoryQuery {
    pub fn for_mission(mission_id: impl Into<String>, project_id: Option<String>) -> Self {
        Self {
            mission_id: mission_id.into(),
            project_id,
            include_user: true,
            include_system: true,
            types: Vec::new(),
            subject: None,
            text: None,
            limit: 12,
            thread_missions: Vec::new(),
        }
    }
}

/// مدخل مسترجَع بترتيبه ودرجته.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievedMemory {
    pub entry: MemoryEntry,
    pub score: i64,
}

/// تعارض يراه الوكيل. مصدره سجلّ محفوظ، أو كشفٌ عند الاسترجاع بين مدخلين مرئيَّين.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictNotice {
    pub subject: String,
    pub memory_ids: Vec<String>,
    pub state: ConflictState,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Retrieval {
    pub items: Vec<RetrievedMemory>,
    pub conflicts: Vec<ConflictNotice>,
    /// مدخلات مرئية لم تدخل النتيجة لأنها تجاوزت الحدّ.
    pub omitted: usize,
}

/// هل يجوز لهذا الطلب أن يرى هذا المدخل؟ فحص ثانٍ مستقلّ عن استعلام المخزن.
pub fn visible(entry: &MemoryEntry, query: &MemoryQuery) -> bool {
    match entry.scope {
        MemoryScope::Mission => entry
            .mission_id
            .as_deref()
            .is_some_and(|m| m == query.mission_id || query.thread_missions.iter().any(|t| t == m)),
        MemoryScope::Project => query.project_id.is_some() && entry.project_id == query.project_id,
        MemoryScope::User => query.include_user,
        MemoryScope::System => query.include_system,
    }
}

fn scope_weight(scope: MemoryScope) -> i64 {
    match scope {
        MemoryScope::Mission => 20,
        MemoryScope::Project => 12,
        MemoryScope::User => 6,
        MemoryScope::System => 3,
    }
}

/// PHASE-08: تشابه جيب التمام بين نصّ الطلب وكل مدخل مرئي، من منفذ التضمين، وحدّه الأدنى للصلة. التشابه يقرّب في الترتيب
/// ويُدخل مدخلًا لا يشارك الطلب كلمة (إعادة صياغة)، ولا يرفع ثقة ولا يتجاوز النطاق: المرشّحون مرئيّون أصلًا.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SemanticScores {
    pub similarity: HashMap<String, f32>,
    pub min_similarity: f32,
}

/// مدخل معجمي فقط (بلا موضوع ولا تشابه) تقلّ درجته BM25 عن هذا الكسر من أعلى درجة في الطلب لا يدخل النتيجة: مشاركة كلمة
/// شائعة وحدها (مثل اسم المشروع في كل مدخل) ليست صلة. اختير على مجموعة التطوير وحدها (2026-10-24): 0 ← دقّة 0.462، و0.25 ← 0.632،
/// و0.5 و0.75 ← 0.8، والاستدعاء 0.579 في الأربع؛ أُخذ الأصغر من المتعادلين حفظًا للاستدعاء.
const LEXICAL_RELATIVE_FLOOR: f64 = 0.5;

/// تحويل درجة RRF الكسرية إلى عدد صحيح يحفظ فروق المراكز (1/61 − 1/62 ≈ 2.6e-4).
const RELEVANCE_SCALE: f64 = 1e7;

/// الأهمية والنطاق والحداثة معًا أقلّ من 100 (30 + 20 + 20)، فتحسم التعادل ولا تتجاوز فرق صلة.
const PRIOR_SPAN: i64 = 100;

/// يرتّب المدخلات المرئية ويقصّها إلى الحدّ. حتمي: التعادل يُحسم بالمعرّف.
pub fn rank(entries: Vec<MemoryEntry>, query: &MemoryQuery, recorded_conflicts: &[MemoryConflict]) -> Retrieval {
    rank_with(entries, query, recorded_conflicts, None)
}

/// الترتيب الهجين: BM25 والتشابه الدلالي (إن وُجد) ومطابقة الموضوع مدموجة بـ RRF. بلا تشابه = المعجمي وحده.
pub fn rank_with(entries: Vec<MemoryEntry>, query: &MemoryQuery, recorded_conflicts: &[MemoryConflict], semantic: Option<&SemanticScores>) -> Retrieval {
    let similar = |id: &str| -> Option<f32> { semantic.and_then(|s| s.similarity.get(id).copied().filter(|v| *v >= s.min_similarity)) };
    let mut visible_entries: Vec<MemoryEntry> = entries
        .into_iter()
        .filter(|e| visible(e, query))
        .filter(|e| query.types.is_empty() || query.types.contains(&e.memory_type))
        .collect();
    // الأحدث أولًا لحساب مكافأة الحداثة؛ المعرّف يحسم تساوي الطوابع.
    visible_entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.memory_id.cmp(&b.memory_id)));
    let subject = query.subject.as_deref().map(normalise).filter(|s| !s.is_empty());
    let query_terms = query.text.as_deref().map(analyzer::term_set).unwrap_or_default();

    // نقل agentmemory (2026-10-24): ثلاثة تيّارات على المرئيّ وحده — BM25 على مصطلحات مجذّعة، والتشابه الدلالي فوق حدّه، ومطابقة
    // الموضوع — تُدمج بـ RRF. الأهمية والنطاق والحداثة تحسم التعادل فقط، فلا يسبق مدخلٌ مهمّ بلا صلة مدخلًا ذا صلة.
    let documents: Vec<Vec<String>> = visible_entries.iter().map(|e| analyzer::terms(&format!("{} {}", e.subject, e.content))).collect();
    let lexical = Bm25::new(&documents).scores(&query_terms);
    let lexical_floor = lexical.iter().copied().fold(0.0, f64::max) * LEXICAL_RELATIVE_FLOOR;
    let subject_hit: Vec<bool> = visible_entries.iter().map(|e| subject.as_ref().is_some_and(|s| normalise(&e.subject).contains(s.as_str()))).collect();
    let semantic_hit: Vec<Option<f32>> = visible_entries.iter().map(|e| similar(&e.memory_id)).collect();
    // الحدّ يقرّر الدخول لا الترتيب. ولا يُخفى تعارض: ما يشارك مدخلًا مقبولًا موضوعه يدخل معه (قِيس على المجموعة المحجوزة أن
    // الحدّ وحده أسقط القيمة العربية لموضوع له قيمة إنجليزية أقوى مطابقة).
    let admitted: Vec<bool> = (0..visible_entries.len()).map(|i| (lexical[i] > 0.0 && lexical[i] >= lexical_floor) || subject_hit[i] || semantic_hit[i].is_some()).collect();
    let admitted_subjects: std::collections::BTreeSet<String> =
        visible_entries.iter().zip(&admitted).filter(|(_, a)| **a).map(|(e, _)| normalise(&e.subject)).collect();
    let admitted: Vec<bool> = visible_entries.iter().zip(admitted).map(|(e, a)| a || admitted_subjects.contains(&normalise(&e.subject))).collect();
    let fused = fusion::fuse(
        &[
            fusion::ranks(&lexical.iter().map(|s| (*s > 0.0).then_some(*s)).collect::<Vec<_>>()),
            fusion::ranks(&semantic_hit.iter().map(|v| v.map(f64::from)).collect::<Vec<_>>()),
            fusion::ranks(&subject_hit.iter().map(|hit| hit.then_some(1.0)).collect::<Vec<_>>()),
        ],
        visible_entries.len(),
    );

    // R-14 (2026-10-12): حدّ أدنى للصلة. طلبٌ بنصّ أو موضوع لا يُدخل مدخلًا لا يشاركه مصطلحًا ولا يطابق موضوعه ولا يقاربه دلاليًّا،
    // مهما ارتفعت أهميته أو حداثته. التفضيلات (ما قاله المستخدم عن نفسه وطريقة عمله) تبقى مرئية دائمًا لأنها تخصّ كل طلب.
    let relevance_filter = !query_terms.is_empty() || subject.is_some();
    let mut scored: Vec<RetrievedMemory> = visible_entries
        .into_iter()
        .enumerate()
        .filter(|(i, entry)| !relevance_filter || entry.memory_type == MemoryType::Preference || admitted[*i])
        .map(|(recency_index, entry)| {
            let prior = i64::from(entry.importance) * 6 + scope_weight(entry.scope) + (20 - recency_index as i64).max(0);
            let relevance = (fused[recency_index] * RELEVANCE_SCALE).round() as i64;
            RetrievedMemory { entry, score: relevance * PRIOR_SPAN + prior }
        })
        .collect();
    scored.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.entry.memory_id.cmp(&b.entry.memory_id)));
    let limit = query.limit.max(1);
    let omitted = scored.len().saturating_sub(limit);
    scored.truncate(limit);

    // التعارضات: المحفوظة التي تمسّ ما استُرجع، ثم ما يُكشف الآن بين مدخلين مرئيَّين
    // بالموضوع نفسه وقيمتين مختلفتين. لا يُخفى تعارض، ولا يُحسم بالأحدث.
    let ids: Vec<&str> = scored.iter().map(|r| r.entry.memory_id.as_str()).collect();
    let mut conflicts: Vec<ConflictNotice> = Vec::new();
    for recorded in recorded_conflicts {
        if recorded.state == ConflictState::NoConflict {
            continue;
        }
        if ids.contains(&recorded.memory_a.as_str()) || ids.contains(&recorded.memory_b.as_str()) {
            let notice = ConflictNotice {
                subject: recorded.subject.clone(),
                memory_ids: vec![recorded.memory_a.clone(), recorded.memory_b.clone()],
                state: recorded.state,
            };
            if !conflicts.contains(&notice) {
                conflicts.push(notice);
            }
        }
    }
    for (i, a) in scored.iter().enumerate() {
        for b in scored.iter().skip(i + 1) {
            if normalise(&a.entry.subject) == normalise(&b.entry.subject) && a.entry.content_digest != b.entry.content_digest {
                let pair = vec![a.entry.memory_id.clone(), b.entry.memory_id.clone()];
                let known = conflicts.iter().any(|c| c.memory_ids.iter().all(|id| pair.contains(id)));
                if !known {
                    conflicts.push(ConflictNotice { subject: a.entry.subject.clone(), memory_ids: pair, state: ConflictState::Conflict });
                }
            }
        }
    }
    Retrieval { items: scored, conflicts, omitted }
}

#[cfg(test)]
mod tests {
    use super::super::model::*;
    use super::*;
    use super::super::analyzer::fold;
    use crate::p03::trust::Taint;

    pub(crate) fn entry(id: &str, scope: MemoryScope, mission: Option<&str>, project: Option<&str>, subject: &str, content: &str) -> MemoryEntry {
        MemoryEntry {
            memory_id: id.into(),
            memory_type: MemoryType::Semantic,
            scope,
            mission_id: mission.map(str::to_string),
            project_id: project.map(str::to_string),
            subject: subject.into(),
            content: content.into(),
            summary: summarise(content),
            content_digest: content_digest(content),
            source_refs: Vec::new(),
            provenance: MemoryProvenance { producer: "t".into(), mission_id: None, task_id: None, lineage: Vec::new(), recorded_at: "t".into() },
            trust_class: MemoryTrustClass::ModelGenerated,
            verification: MemoryVerification::Unverified,
            taint: Taint::clean(),
            confidence_source: ConfidenceSource::None,
            importance: 3,
            status: MemoryStatus::Active,
            version: 1,
            created_at: format!("2026-09-23T00:00:0{}Z", id.len() % 10),
            updated_at: format!("2026-09-23T00:00:0{}Z", id.len() % 10),
            last_accessed_at: None,
            expires_at: None,
            expires_at_ms: None,
        }
    }

    #[test]
    fn a_mission_never_sees_another_missions_memory() {
        let entries = vec![
            entry("a", MemoryScope::Mission, Some("m-a"), Some("p1"), "note", "mission A only"),
            entry("b", MemoryScope::Mission, Some("m-b"), Some("p1"), "note", "mission B only"),
        ];
        let out = rank(entries, &MemoryQuery::for_mission("m-b", Some("p1".into())), &[]);
        assert_eq!(out.items.len(), 1);
        assert_eq!(out.items[0].entry.memory_id, "b");
    }

    #[test]
    fn project_memory_is_visible_only_inside_its_project() {
        let entries = vec![entry("p", MemoryScope::Project, None, Some("p1"), "fact", "project one fact")];
        assert_eq!(rank(entries.clone(), &MemoryQuery::for_mission("m", Some("p1".into())), &[]).items.len(), 1);
        assert_eq!(rank(entries.clone(), &MemoryQuery::for_mission("m", Some("p2".into())), &[]).items.len(), 0);
        assert_eq!(rank(entries, &MemoryQuery::for_mission("m", None), &[]).items.len(), 0);
    }

    #[test]
    fn subject_and_text_relevance_rank_first_and_ties_are_deterministic() {
        let entries = vec![
            entry("x1", MemoryScope::Mission, Some("m"), None, "weather", "it rained"),
            entry("x2", MemoryScope::Mission, Some("m"), None, "fixture title", "the fixture page title is Normal"),
        ];
        let mut query = MemoryQuery::for_mission("m", None);
        query.subject = Some("fixture".into());
        query.text = Some("what is the page title".into());
        let out = rank(entries.clone(), &query, &[]);
        assert_eq!(out.items[0].entry.memory_id, "x2");
        assert_eq!(rank(entries, &query, &[]), out, "retrieval is not deterministic");
    }

    #[test]
    fn an_entry_sharing_nothing_with_the_request_is_left_out_but_a_preference_stays() {
        let mut loud = entry("loud", MemoryScope::Mission, Some("m"), None, "vendor contract", "the vendor contract renews in March");
        loud.importance = 5;
        let mut pref = entry("pref", MemoryScope::User, None, None, "language", "answer in Arabic");
        pref.memory_type = MemoryType::Preference;
        let near = entry("near", MemoryScope::Mission, Some("m"), None, "rainfall", "rainfall in Riyadh last week");
        let query = MemoryQuery { text: Some("how much rainfall fell".into()), ..MemoryQuery::for_mission("m", None) };
        let ids: Vec<String> = rank(vec![loud, pref, near], &query, &[]).items.into_iter().map(|r| r.entry.memory_id).collect();
        assert!(ids.contains(&"near".to_string()) && ids.contains(&"pref".to_string()));
        assert!(!ids.contains(&"loud".to_string()), "an unrelated high-importance entry entered the context: {ids:?}");
    }

    #[test]
    fn two_visible_values_for_one_subject_surface_as_a_conflict() {
        let entries = vec![
            entry("c1", MemoryScope::Mission, Some("m"), None, "release day", "Monday"),
            entry("c2", MemoryScope::Mission, Some("m"), None, "release day", "Friday"),
        ];
        let out = rank(entries, &MemoryQuery::for_mission("m", None), &[]);
        assert_eq!(out.items.len(), 2, "one side of a conflict was hidden");
        assert_eq!(out.conflicts.len(), 1);
        assert_eq!(out.conflicts[0].state, ConflictState::Conflict);
    }
    #[test]
    fn arabic_spellings_and_the_definite_article_meet_in_retrieval() {
        // «الرياض» في الذاكرة و«رياض» في الطلب، و«أفضّل» بالهمزة والتشكيل و«افضل» بدونهما، و«مدينة» و«مدينه».
        assert_eq!(fold("\u{0627}\u{0644}\u{0631}\u{064A}\u{0627}\u{0636}"), fold("\u{0631}\u{064A}\u{0627}\u{0636}"));
        assert_eq!(fold("\u{0623}\u{0641}\u{0636}\u{0651}\u{0644}"), fold("\u{0627}\u{0641}\u{0636}\u{0644}"));
        assert_eq!(fold("\u{0645}\u{062F}\u{064A}\u{0646}\u{0629}"), fold("\u{0645}\u{062F}\u{064A}\u{0646}\u{0647}"));
        // كلمة قصيرة تبدأ بـ«ال» لا تُقصّ إلى حرف واحد.
        assert_eq!(fold("\u{0627}\u{0644}\u{0645}"), "\u{0627}\u{0644}\u{0645}");
        let query = MemoryQuery { text: Some("\u{0645}\u{0627} \u{0627}\u{0644}\u{0637}\u{0642}\u{0633} \u{0641}\u{064A} \u{0631}\u{064A}\u{0627}\u{0636}".into()), ..MemoryQuery::for_mission("m", None) };
        let near = entry("a", MemoryScope::User, None, None, "home", "\u{0623}\u{0639}\u{064A}\u{0634} \u{0641}\u{064A} \u{0627}\u{0644}\u{0631}\u{064A}\u{0627}\u{0636}");
        let far = entry("b", MemoryScope::User, None, None, "taste", "\u{0623}\u{062D}\u{0628} \u{0627}\u{0644}\u{0642}\u{0647}\u{0648}\u{0629}");
        let out = rank(vec![far, near], &query, &[]);
        assert_eq!(out.items[0].entry.memory_id, "a", "the matching memory did not rank first");
    }

    fn ids_for(entries: Vec<MemoryEntry>, text: &str) -> Vec<String> {
        let query = MemoryQuery { text: Some(text.into()), ..MemoryQuery::for_mission("m", None) };
        rank(entries, &query, &[]).items.into_iter().map(|r| r.entry.memory_id).collect()
    }

    #[test]
    fn an_english_plural_meets_its_singular() {
        // نقل agentmemory: قبل التجذيع كان «reminder … appointments» لا يلقى «appointment reminders» (المجموعة المحجوزة).
        let near = entry("n", MemoryScope::Mission, Some("m"), None, "noor", "The app sends appointment reminders by SMS");
        let far = entry("f", MemoryScope::Mission, Some("m"), None, "fleet", "Sahm operates delivery trucks");
        assert_eq!(ids_for(vec![far, near], "reminder messages for appointments"), vec!["n".to_string()]);
    }

    #[test]
    fn an_arabic_word_with_an_attached_prefix_or_suffix_meets_its_bare_form() {
        // «بالتقسيط» في الذاكرة و«التقسيط» في الطلب، و«قررنا» و«قررناه»: طيّ «ال» وحده لم يكفِ.
        let near = entry("n", MemoryScope::Mission, Some("m"), None, "decision", "\u{0642}\u{0631}\u{0631}\u{0646}\u{0627} \u{062A}\u{0623}\u{062C}\u{064A}\u{0644} \u{0627}\u{0644}\u{062F}\u{0641}\u{0639} \u{0628}\u{0627}\u{0644}\u{062A}\u{0642}\u{0633}\u{064A}\u{0637}");
        let far = entry("f", MemoryScope::Mission, Some("m"), None, "fleet", "Sahm operates delivery trucks");
        let query = "\u{0645}\u{0627} \u{0627}\u{0644}\u{0630}\u{064A} \u{0642}\u{0631}\u{0631}\u{0646}\u{0627}\u{0647} \u{0628}\u{0634}\u{0623}\u{0646} \u{0627}\u{0644}\u{062A}\u{0642}\u{0633}\u{064A}\u{0637}";
        assert_eq!(ids_for(vec![far, near], query), vec!["n".to_string()]);
    }

    #[test]
    fn a_rare_shared_word_outranks_a_word_every_entry_has() {
        // IDF: «noor» في كل مدخل لا يميّز شيئًا، و«moyasar» في مدخل واحد يميّزه. قبل BM25 تعادلت الكلمتان وحسمت الحداثة.
        let mut entries: Vec<MemoryEntry> = ["reminders by SMS", "doctors registered", "first release in December", "interface in Arabic"]
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let mut e = entry(&format!("c{i}"), MemoryScope::Mission, Some("m"), None, "noor", c);
                e.updated_at = format!("2026-09-23T00:00:2{i}Z");
                e
            })
            .collect();
        let mut rare = entry("rare", MemoryScope::Mission, Some("m"), None, "gateway", "payments go through Moyasar");
        rare.updated_at = "2026-09-23T00:00:00Z".into();
        entries.push(rare);
        assert_eq!(ids_for(entries, "noor moyasar").first().map(String::as_str), Some("rare"));
    }

    #[test]
    fn the_lexical_floor_never_hides_one_side_of_a_conflict() {
        // المجموعة المحجوزة (2026-10-24): الحدّ النسبي أسقط القيمة العربية لموضوع «noor deadline» لأن الإنجليزية طابقت الطلب أقوى،
        // فظهرت قيمة واحدة بلا تعارض. ما يشارك مدخلًا مقبولًا موضوعه يُقبل معه.
        let english = entry("en", MemoryScope::Mission, Some("m"), None, "noor deadline", "The first Noor release is due on 10 December");
        let arabic = entry("ar", MemoryScope::Mission, Some("m"), None, "noor deadline", "\u{062A}\u{0633}\u{0644}\u{064A}\u{0645} \u{0646}\u{0648}\u{0631} \u{0646}\u{0647}\u{0627}\u{064A}\u{0629} \u{0646}\u{0648}\u{0641}\u{0645}\u{0628}\u{0631}");
        let query = MemoryQuery { text: Some("when is the Noor release deadline".into()), ..MemoryQuery::for_mission("m", None) };
        let out = rank(vec![english, arabic], &query, &[]);
        assert_eq!(out.items.len(), 2, "one side of a conflict was hidden: {:?}", out.items.iter().map(|r| &r.entry.memory_id).collect::<Vec<_>>());
        assert_eq!(out.conflicts.len(), 1);
    }
}
