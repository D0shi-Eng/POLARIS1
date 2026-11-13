// حارس الحلقات: كشف عدم التقدّم وتكرار الاقتراحات.
//
// المبدأ (البند 64): لا حكم دلالي من النموذج وحده. نتتبّع بصمة حالة ذات معنى عبر
// دورات التنسيق؛ إذا تكرّرت البصمة نفسها أكثر من الحدّ المسموح توقّفنا بـNO_PROGRESS.
// نكشف أيضًا الخطط المكرّرة، وطلبات التفويض المكرّرة، وأسئلة الوكلاء الدائرة.

use std::collections::HashMap;

use crate::digest::sha256_hex;

/// نتيجة فحص التقدّم بعد دورة تنسيق.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Progress {
    /// تغيّرت الحالة: تقدّم حقيقي.
    Advanced,
    /// تكرّرت الحالة، لكن دون الحدّ.
    Repeated(u32),
    /// تكرّرت الحالة بما يتجاوز الحدّ: توقّف.
    NoProgress,
}

/// حارس يتتبّع بصمة الحالة وبصمات الاقتراحات المتكرّرة.
pub struct LoopGuard {
    max_repeats: u32,
    last_digest: Option<String>,
    repeats: u32,
    /// عدّاد لكل بصمة اقتراح (خطة/تفويض/سؤال)، لكشف التكرار الحرفي.
    proposal_counts: HashMap<String, u32>,
    proposal_limit: u32,
}

impl LoopGuard {
    pub fn new(max_repeats: u32, proposal_limit: u32) -> Self {
        Self { max_repeats, last_digest: None, repeats: 0, proposal_counts: HashMap::new(), proposal_limit }
    }

    /// إعداد افتراضي: بصمة حالة تتكرّر مرتين مسموح، والثالثة توقّف؛ واقتراح حرفي
    /// يتكرّر مرتين مسموح.
    pub fn conservative() -> Self {
        Self::new(2, 2)
    }

    /// يسجّل بصمة حالة المهمّة بعد دورة تنسيق. البصمة تُحسب من حالة ذات معنى
    /// (حالات المهام، الادّعاءات، الحاجز) لا من طابع زمني.
    pub fn observe_state(&mut self, meaningful_state: &str) -> Progress {
        let digest = sha256_hex(meaningful_state.as_bytes());
        match &self.last_digest {
            Some(prev) if *prev == digest => {
                self.repeats += 1;
                if self.repeats > self.max_repeats {
                    Progress::NoProgress
                } else {
                    Progress::Repeated(self.repeats)
                }
            }
            _ => {
                self.last_digest = Some(digest);
                self.repeats = 0;
                Progress::Advanced
            }
        }
    }

    /// يسجّل اقتراحًا حرفيًّا (خطة/تفويض/سؤال). يعيد false إذا تجاوز التكرار الحدّ.
    pub fn observe_proposal(&mut self, kind: &str, content: &str) -> bool {
        let digest = sha256_hex(format!("{kind}\u{0}{content}").as_bytes());
        let count = self.proposal_counts.entry(digest).or_insert(0);
        *count += 1;
        *count <= self.proposal_limit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_changing_state_always_advances() {
        let mut guard = LoopGuard::conservative();
        assert_eq!(guard.observe_state("state-1"), Progress::Advanced);
        assert_eq!(guard.observe_state("state-2"), Progress::Advanced);
        assert_eq!(guard.observe_state("state-3"), Progress::Advanced);
    }

    #[test]
    fn a_repeated_state_terminates_after_the_limit() {
        let mut guard = LoopGuard::new(2, 2);
        assert_eq!(guard.observe_state("stuck"), Progress::Advanced);
        assert_eq!(guard.observe_state("stuck"), Progress::Repeated(1));
        assert_eq!(guard.observe_state("stuck"), Progress::Repeated(2));
        assert_eq!(guard.observe_state("stuck"), Progress::NoProgress);
    }

    #[test]
    fn progress_resets_the_repeat_counter() {
        let mut guard = LoopGuard::new(2, 2);
        guard.observe_state("a");
        guard.observe_state("a");
        assert_eq!(guard.observe_state("b"), Progress::Advanced);
        // العودة إلى "a" تبدأ عدًّا جديدًا.
        assert_eq!(guard.observe_state("a"), Progress::Advanced);
    }

    #[test]
    fn a_repeated_proposal_is_refused_after_the_limit() {
        let mut guard = LoopGuard::new(2, 2);
        assert!(guard.observe_proposal("PLAN", "do X then Y"));
        assert!(guard.observe_proposal("PLAN", "do X then Y"));
        assert!(!guard.observe_proposal("PLAN", "do X then Y"), "an identical plan repeated past the limit");
        // اقتراح مختلف مسموح.
        assert!(guard.observe_proposal("PLAN", "do Z"));
    }

    #[test]
    fn different_proposal_kinds_are_counted_separately() {
        let mut guard = LoopGuard::new(2, 1);
        assert!(guard.observe_proposal("PLAN", "same"));
        assert!(guard.observe_proposal("DELEGATION", "same"), "different kinds must not collide");
    }
}
