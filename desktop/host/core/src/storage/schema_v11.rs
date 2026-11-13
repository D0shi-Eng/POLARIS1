// مخطط v11 (أسئلة المتابعة، 2026-10-01): صنف واحد يُضاف إلى سرد المحادثة، ولا صفّ يضيع.
//
// `p08_conversation_entries.kind` كان يقبل PLAN وSTEP وACTION وNOTE. أسئلة المتابعة التي يقترحها ردّ المهمّة تُحفظ
// بصنفها الحقيقي SUGGESTION لا بصنف مستعار. SQLite لا يعدّل قيد CHECK في مكانه، فيُبنى الجدول من جديد بالأعمدة
// نفسها ويُنسخ كل صفّ بمعرّفه، داخل معاملة الترحيل.

pub const V11: &str = r#"
CREATE TABLE p08_conversation_entries_v11 (
    entry_id   INTEGER PRIMARY KEY,
    mission_id TEXT NOT NULL CHECK (length(mission_id) = 36),
    kind       TEXT NOT NULL CHECK (kind IN ('PLAN', 'STEP', 'ACTION', 'NOTE', 'SUGGESTION')),
    body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    detail     TEXT NULL CHECK (detail IS NULL OR length(detail) <= 200),
    created_at TEXT NOT NULL
) STRICT;
INSERT INTO p08_conversation_entries_v11 (entry_id, mission_id, kind, body, detail, created_at)
    SELECT entry_id, mission_id, kind, body, detail, created_at FROM p08_conversation_entries;
DROP TABLE p08_conversation_entries;
ALTER TABLE p08_conversation_entries_v11 RENAME TO p08_conversation_entries;
CREATE INDEX p08_conversation_entries_by_mission ON p08_conversation_entries (mission_id, entry_id);
"#;
