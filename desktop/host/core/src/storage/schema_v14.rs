// مخطط v14 (خطة 2026-10-05، D2، ADR-038): حالة تعارض جديدة، «استبدله المستخدم». لا صفّ يضيع.
//
// SQLite لا يعدّل قيد CHECK في مكانه، فيُبنى جدول التعارضات من جديد بالأعمدة نفسها ويُنسخ كل صفّ، داخل معاملة الترحيل.

pub const V14: &str = r#"
CREATE TABLE memory_conflicts_v14 (
    conflict_id TEXT PRIMARY KEY NOT NULL,
    memory_a    TEXT NOT NULL,
    memory_b    TEXT NOT NULL,
    subject     TEXT NOT NULL CHECK (length(subject) <= 120),
    state       TEXT NOT NULL CHECK (state IN ('NO_CONFLICT','CONFLICT','SUPERSEDED_BY_VERIFIED_SOURCE','INSUFFICIENT_EVIDENCE','SUPERSEDED_BY_USER')),
    detected_at TEXT NOT NULL
) STRICT;
INSERT INTO memory_conflicts_v14 (conflict_id, memory_a, memory_b, subject, state, detected_at)
    SELECT conflict_id, memory_a, memory_b, subject, state, detected_at FROM memory_conflicts;
DROP TABLE memory_conflicts;
ALTER TABLE memory_conflicts_v14 RENAME TO memory_conflicts;
CREATE INDEX memory_conflicts_by_memory ON memory_conflicts (memory_a, memory_b);
"#;
