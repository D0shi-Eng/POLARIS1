// كشف تعارض الادّعاءات.
//
// لا استدلال فلسفي عام عن الحقيقة (البند 53): نستعمل التهيكل الصريح حيث وُجد.
// ادّعاءان يتعارضان إذا اتّفقا في الموضوع والخاصية واختلفا في القيمة. حين يغيب
// التهيكل تكون النتيجة INSUFFICIENT_CONTEXT لا تخمينًا. لا يُختار أحدهما لأن صياغة
// النموذج أقوى (البند 54).

use serde::Serialize;

use super::claim::Claim;

/// نتيجة فحص التعارض بين ادّعاءين. مغلقة (البند 54).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConflictOutcome {
    NoConflict,
    Conflict,
    /// لا سياق كافٍ للحكم (أحدهما غير مهيكل).
    InsufficientContext,
}

/// يفحص تعارض ادّعاءين. يعتمد على التهيكل الصريح وحده.
pub fn detect(a: &Claim, b: &Claim) -> ConflictOutcome {
    match (&a.subject, &b.subject) {
        (Some(sa), Some(sb)) => {
            if sa.subject == sb.subject && sa.property == sb.property {
                if sa.value == sb.value {
                    ConflictOutcome::NoConflict
                } else {
                    ConflictOutcome::Conflict
                }
            } else {
                // موضوعان مختلفان: لا تعارض.
                ConflictOutcome::NoConflict
            }
        }
        // أحدهما أو كلاهما غير مهيكل: لا نخمّن.
        _ => ConflictOutcome::InsufficientContext,
    }
}

/// يجد كل أزواج الادّعاءات المتعارضة في مجموعة، بترتيب حتمي.
pub fn find_conflicts<'a>(claims: &'a [&'a Claim]) -> Vec<(&'a Claim, &'a Claim)> {
    let mut pairs = Vec::new();
    for i in 0..claims.len() {
        for j in (i + 1)..claims.len() {
            if detect(claims[i], claims[j]) == ConflictOutcome::Conflict {
                pairs.push((claims[i], claims[j]));
            }
        }
    }
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::claim::{ClaimSubject, ClaimType};
    use super::super::trust::Taint;

    fn structured(id: &str, subject: &str, property: &str, value: &str) -> Claim {
        Claim::from_agent(id, "m1", "ag1", "s", ClaimType::Fact, Taint::clean(), "t")
            .with_subject(ClaimSubject { subject: subject.into(), property: property.into(), value: value.into() })
    }

    #[test]
    fn same_subject_property_different_value_conflicts() {
        let a = structured("a", "build", "status", "PASS");
        let b = structured("b", "build", "status", "FAIL");
        assert_eq!(detect(&a, &b), ConflictOutcome::Conflict);
    }

    #[test]
    fn same_value_is_no_conflict() {
        let a = structured("a", "build", "status", "PASS");
        let b = structured("b", "build", "status", "PASS");
        assert_eq!(detect(&a, &b), ConflictOutcome::NoConflict);
    }

    #[test]
    fn different_property_is_no_conflict() {
        let a = structured("a", "build", "status", "PASS");
        let b = structured("b", "build", "duration_ms", "1200");
        assert_eq!(detect(&a, &b), ConflictOutcome::NoConflict);
    }

    #[test]
    fn an_unstructured_claim_yields_insufficient_context() {
        let a = structured("a", "build", "status", "PASS");
        let b = Claim::from_agent("b", "m1", "ag2", "the build failed", ClaimType::Fact, Taint::clean(), "t");
        assert_eq!(detect(&a, &b), ConflictOutcome::InsufficientContext);
    }

    #[test]
    fn find_conflicts_is_deterministic_and_finds_the_pair() {
        let a = structured("a", "build", "status", "PASS");
        let b = structured("b", "build", "status", "FAIL");
        let c = structured("c", "lint", "status", "PASS");
        let claims = [&a, &b, &c];
        let pairs = find_conflicts(&claims);
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0.claim_id, "a");
        assert_eq!(pairs[0].1.claim_id, "b");
    }
}
