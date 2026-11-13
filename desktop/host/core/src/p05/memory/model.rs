// نطاق الذاكرة: مدخل مهيكل، لا خريطة حرّة ولا سجل محادثة.
//
// القاعدة الحاكمة (البند 7): الذاكرة ليست حقيقة. وجود مدخل لا يعني صحّته، واسترجاعه
// لا يرفع ثقته. كل مدخل يحمل منشأه (من كتبه)، وتحقّقه (هل رُبط بدليل مقيس)، وتلوّثه،
// وسلالته — ويبقى في المُوجِّه بيانات غير موثوقة مهما كان منشؤه.

use serde::{Deserialize, Serialize};

use crate::p03::trust::Taint;

macro_rules! closed_vocabulary {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $code:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        pub enum $name {
            $(#[serde(rename = $code)] $variant),+
        }

        impl $name {
            pub const ALL: &'static [$name] = &[$(Self::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $code),+
                }
            }

            pub fn parse(code: &str) -> Option<Self> {
                match code {
                    $($code => Some(Self::$variant),)+
                    _ => None,
                }
            }
        }
    };
}

closed_vocabulary!(
    /// نوع الذاكرة.
    MemoryType {
        Working => "WORKING",
        Episodic => "EPISODIC",
        Semantic => "SEMANTIC",
        Preference => "PREFERENCE",
        Project => "PROJECT",
    }
);

closed_vocabulary!(
    /// نطاق الذاكرة. ذاكرة مهمّة لا تبلغ مهمّة أخرى إلا بترقية صريحة إلى نطاق أوسع.
    MemoryScope {
        Mission => "MISSION",
        Project => "PROJECT",
        User => "USER",
        System => "SYSTEM",
    }
);

closed_vocabulary!(
    /// حالة المدخل.
    MemoryStatus {
        Active => "ACTIVE",
        Superseded => "SUPERSEDED",
        Expired => "EXPIRED",
        Deleted => "DELETED",
    }
);

closed_vocabulary!(
    /// منشأ المحتوى: من كتب النصّ، لا من وافق على حفظه.
    MemoryTrustClass {
        SystemGenerated => "SYSTEM_GENERATED",
        ModelGenerated => "MODEL_GENERATED",
        UserDerived => "USER_DERIVED",
    }
);

closed_vocabulary!(
    /// هل رُبط المدخل بدليل مقيس؟ «مربوط» لا يعني «صحيح»: يعني أن ادّعاءً بهذا
    /// المضمون حقّقته قاعدة تحقّق في مهمّة سابقة، وأن ذلك لم يُعد فحصه عند الاسترجاع.
    MemoryVerification {
        Unverified => "UNVERIFIED",
        EvidenceLinked => "EVIDENCE_LINKED",
        Conflicted => "CONFLICTED",
    }
);

closed_vocabulary!(
    /// من أين جاءت الثقة المُعلنة في المدخل. ثقة النموذج بنفسه ليست مصدرًا يرفعه.
    ConfidenceSource {
        RuntimeEvidence => "RUNTIME_EVIDENCE",
        RuntimeObservation => "RUNTIME_OBSERVATION",
        ModelSelfReport => "MODEL_SELF_REPORT",
        UserApprovedWrite => "USER_APPROVED_WRITE",
        None => "NONE",
    }
);

closed_vocabulary!(
    /// حالة التعارض بين مدخلين. لا يُختار الأحدث حقيقةً تلقائيًّا؛ الاستثناء الوحيد `SUPERSEDED_BY_USER` (D2): قول المستخدم
    /// الأحدث عن موضوع سمّاه يحلّ محلّ قوله هو الأقدم، لا قول وكيل.
    ConflictState {
        NoConflict => "NO_CONFLICT",
        Conflict => "CONFLICT",
        SupersededByVerifiedSource => "SUPERSEDED_BY_VERIFIED_SOURCE",
        InsufficientEvidence => "INSUFFICIENT_EVIDENCE",
        SupersededByUser => "SUPERSEDED_BY_USER",
    }
);

closed_vocabulary!(
    /// نوع مرجع المصدر.
    SourceKind {
        Mission => "MISSION",
        Task => "TASK",
        Claim => "CLAIM",
        Evidence => "EVIDENCE",
        ToolInvocation => "TOOL_INVOCATION",
        Agent => "AGENT",
        User => "USER",
    }
);

closed_vocabulary!(
    /// مَن قدّم المرشّح.
    CandidateSource {
        Runtime => "RUNTIME",
        Agent => "AGENT",
        // ما كتبه المستخدم بنفسه («تذكّر هذا»، ADR-032): نصّه، لا نصّ نموذج ولا ملخّص تشغيل.
        User => "USER",
    }
);

/// مرجع مصدر واحد: نوعه ومعرّفه. لا نصّ مصدر هنا.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SourceRef {
    pub kind: SourceKind,
    pub reference: String,
}

impl SourceRef {
    pub fn new(kind: SourceKind, reference: impl Into<String>) -> Self {
        Self { kind, reference: reference.into() }
    }

    pub fn label(&self) -> String {
        format!("{}:{}", self.kind.as_str().to_ascii_lowercase(), self.reference)
    }
}

/// منشأ المدخل كما سجّله زمن التشغيل.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryProvenance {
    /// ما أنتج المرشّح: خدمة تشغيل أو وكيل بمعرّفه.
    pub producer: String,
    pub mission_id: Option<String>,
    pub task_id: Option<String>,
    /// السلالة: من أي مصادر اشتُقّ. مصدران بسلالة واحدة ليسا مستقلّين.
    pub lineage: Vec<String>,
    pub recorded_at: String,
}

/// مدخل ذاكرة واحد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub memory_id: String,
    pub memory_type: MemoryType,
    pub scope: MemoryScope,
    pub mission_id: Option<String>,
    pub project_id: Option<String>,
    pub subject: String,
    pub content: String,
    pub summary: String,
    pub content_digest: String,
    pub source_refs: Vec<SourceRef>,
    pub provenance: MemoryProvenance,
    pub trust_class: MemoryTrustClass,
    pub verification: MemoryVerification,
    pub taint: Taint,
    pub confidence_source: ConfidenceSource,
    pub importance: u8,
    pub status: MemoryStatus,
    pub version: u32,
    pub created_at: String,
    pub updated_at: String,
    pub last_accessed_at: Option<String>,
    pub expires_at: Option<String>,
    pub expires_at_ms: Option<u64>,
}

/// مرشّح ذاكرة. هو اقتراح، لا كتابة: يمرّ بالتحقق والمنشأ والسياسة والتكرار والتعارض.
///
/// ما لا يستطيع المرشّح أن يقرّره عن نفسه: صنف ثقته، وتحقّقه. الأول يُشتق من
/// المصدر (مرشّح وكيل يبقى MODEL_GENERATED أيًّا كان ما يقوله)، والثاني من مراجع
/// أدلّة يفحصها زمن التشغيل لا من ثقة النموذج.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryCandidateV1 {
    pub candidate_id: String,
    pub source: CandidateSource,
    pub proposed_type: MemoryType,
    pub proposed_scope: MemoryScope,
    pub mission_id: Option<String>,
    pub project_id: Option<String>,
    pub subject: String,
    pub content: String,
    pub reason: String,
    pub source_refs: Vec<SourceRef>,
    pub taint: Taint,
    pub confidence_source: ConfidenceSource,
    /// ما أنتج المرشّح. للمصدر RUNTIME خدمة تشغيل؛ للمصدر AGENT معرّف الوكيل.
    pub producer: String,
    /// منشأ النصّ حين يقدّمه زمن التشغيل: ملخّص كتبه هو، أو نصّ ادّعاء كتبه نموذج.
    /// يُتجاهل لمرشّح الوكيل: نصّه نصّ نموذج دائمًا.
    pub content_origin: MemoryTrustClass,
    pub importance: u8,
    pub task_id: Option<String>,
}

/// نتيجة قرار السياسة على مرشّح.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "decision", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MemoryDecision {
    Promoted { memory_id: String, conflict: ConflictState },
    Rejected { reason: RejectReason },
    /// المحتوى نفسه محفوظ سلفًا في النطاق نفسه. لا صفّ ثانٍ.
    Duplicate { memory_id: String },
    /// الموضوع والقيمة نفسهما، أو السلالة نفسها، فدُمجت المراجع في المدخل القائم.
    Coalesced { memory_id: String },
}

impl MemoryDecision {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Promoted { .. } => "PROMOTED",
            Self::Rejected { .. } => "REJECTED",
            Self::Duplicate { .. } => "DUPLICATE",
            Self::Coalesced { .. } => "COALESCED",
        }
    }

    pub fn memory_id(&self) -> Option<&str> {
        match self {
            Self::Promoted { memory_id, .. } | Self::Duplicate { memory_id } | Self::Coalesced { memory_id } => Some(memory_id),
            Self::Rejected { .. } => None,
        }
    }

    pub fn reason_code(&self) -> &'static str {
        match self {
            Self::Promoted { conflict, .. } => conflict.as_str(),
            Self::Rejected { reason } => reason.as_str(),
            Self::Duplicate { .. } => "EXACT_DUPLICATE",
            Self::Coalesced { .. } => "SAME_SUBJECT_VALUE_OR_LINEAGE",
        }
    }
}

closed_vocabulary!(
    /// لماذا رُفض مرشّح. مغلق.
    RejectReason {
        SubjectInvalid => "SUBJECT_INVALID",
        ContentEmpty => "CONTENT_EMPTY",
        ContentTooLarge => "CONTENT_TOO_LARGE",
        SecretLike => "SECRET_LIKE_CONTENT",
        RawReasoning => "RAW_REASONING",
        PageDump => "PAGE_DUMP",
        TypeScopeMismatch => "TYPE_SCOPE_MISMATCH",
        ScopeNotPermitted => "SCOPE_NOT_PERMITTED",
        BindingMissing => "SCOPE_BINDING_MISSING",
        ImportanceInvalid => "IMPORTANCE_INVALID",
    }
);

/// حدود المحتوى. ما يتجاوزها ليس ذاكرة بل مخرجات أداة ضخمة أو صفحة كاملة.
pub const MAX_SUBJECT_CHARS: usize = 120;
pub const MAX_CONTENT_CHARS: usize = 2000;
pub const MAX_SUMMARY_CHARS: usize = 240;
pub const MAX_SOURCE_REFS: usize = 24;

/// يوحّد نصًّا للمقارنة: المسافات وحالة الأحرف وحدها. لا تفسير.
pub fn normalise(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// بصمة المحتوى الموحّد. بها يُكشف التكرار الحرفي.
pub fn content_digest(content: &str) -> String {
    crate::digest::sha256_hex(normalise(content).as_bytes())
}

/// ملخّص محدود يُشتق من المحتوى، بلا كسر محرف متعدد البايتات.
pub fn summarise(content: &str) -> String {
    crate::p04::adapter::bounded(&content.split_whitespace().collect::<Vec<_>>().join(" "), MAX_SUMMARY_CHARS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_closed_vocabulary_round_trips_and_refuses_unknown_codes() {
        for t in MemoryType::ALL {
            assert_eq!(MemoryType::parse(t.as_str()), Some(*t));
        }
        for s in MemoryScope::ALL {
            assert_eq!(MemoryScope::parse(s.as_str()), Some(*s));
        }
        for c in ConflictState::ALL {
            assert_eq!(ConflictState::parse(c.as_str()), Some(*c));
        }
        assert_eq!(MemoryType::ALL.len(), 5);
        assert_eq!(MemoryScope::ALL.len(), 4);
        assert_eq!(MemoryStatus::ALL.len(), 4);
        assert_eq!(ConflictState::ALL.len(), 5);
        assert_eq!(MemoryTrustClass::parse("TRUSTED"), None, "a trust class the vocabulary does not have parsed");
        assert_eq!(MemoryVerification::parse("VERIFIED"), None, "memory has no VERIFIED state: it is never truth");
    }

    #[test]
    fn normalisation_ignores_spacing_and_case_only() {
        assert_eq!(normalise("  The  Title\nIS x "), "the title is x");
        assert_eq!(content_digest("A  b"), content_digest("a b"));
        assert_ne!(content_digest("a b"), content_digest("a c"));
    }

    #[test]
    fn a_summary_is_bounded_without_splitting_a_character() {
        let long = "ذاكرة ".repeat(200);
        let summary = summarise(&long);
        assert!(summary.chars().count() <= MAX_SUMMARY_CHARS);
    }
}
