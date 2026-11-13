// مخطط v10 («تذكّر هذا»، 2026-10-01، ADR-032): قيد واحد يتّسع، ولا صفّ يضيع.
//
// `memory_decisions.source` كان يقبل RUNTIME وAGENT وحدهما. ذاكرة يكتبها المستخدم بنفسه تُسجَّل بمصدرها الحقيقي
// USER، لا بمصدر مستعار. SQLite لا يعدّل قيد CHECK في مكانه، فيُبنى الجدول من جديد بالأعمدة نفسها ويُنسخ كل صفّ
// إليه ثم يأخذ اسمه، داخل معاملة الترحيل: فشل أي خطوة يرجع القاعدة كما كانت.

pub const V10: &str = r#"
CREATE TABLE memory_decisions_v10 (
    candidate_id   TEXT PRIMARY KEY NOT NULL,
    source         TEXT NOT NULL CHECK (source IN ('RUNTIME','AGENT','USER')),
    proposed_type  TEXT NOT NULL,
    proposed_scope TEXT NOT NULL,
    mission_id     TEXT NULL,
    decision       TEXT NOT NULL CHECK (decision IN ('PROMOTED','REJECTED','DUPLICATE','COALESCED')),
    reason_code    TEXT NOT NULL,
    memory_id      TEXT NULL,
    content_digest TEXT NOT NULL,
    decided_at     TEXT NOT NULL
) STRICT;
INSERT INTO memory_decisions_v10 (candidate_id, source, proposed_type, proposed_scope, mission_id, decision, reason_code, memory_id, content_digest, decided_at)
    SELECT candidate_id, source, proposed_type, proposed_scope, mission_id, decision, reason_code, memory_id, content_digest, decided_at FROM memory_decisions;
DROP TABLE memory_decisions;
ALTER TABLE memory_decisions_v10 RENAME TO memory_decisions;
CREATE INDEX memory_decisions_by_mission ON memory_decisions (mission_id, decided_at);
"#;
