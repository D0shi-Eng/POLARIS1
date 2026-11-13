// مخطط v7 (Phase-08، المحادثة): إضافة بحتة لجدولين، لا جدول قديم يُمسّ.
//
// `p08_conversation_turns`: كل رسالة من المستخدم دورٌ في محادثة، ولكل دور مهمّة Phase-03 عادية
// بإثباتها وحالتها. الدور الأول مهمّة المحادثة نفسها (thread_id = mission_id)، وما بعده متابعات.
// `p08_conversation_entries`: سرد المهمّة الحيّ كما يبلّغه زمن التشغيل (خطة، خطوة، فعل، ملاحظة).
// النصوص مخرجات نموذج أو عناوين من خطته: بيانات للعرض، محدودة الطول، ولا عمود يحمل سرًّا.

pub const V7: &str = r#"
CREATE TABLE p08_conversation_turns (
    mission_id TEXT PRIMARY KEY NOT NULL CHECK (length(mission_id) = 36),
    thread_id  TEXT NOT NULL CHECK (length(thread_id) = 36),
    seq        INTEGER NOT NULL CHECK (seq >= 0 AND seq <= 10000),
    message    TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 20000),
    created_at TEXT NOT NULL,
    UNIQUE (thread_id, seq)
) STRICT;

CREATE TABLE p08_conversation_entries (
    entry_id   INTEGER PRIMARY KEY,
    mission_id TEXT NOT NULL CHECK (length(mission_id) = 36),
    kind       TEXT NOT NULL CHECK (kind IN ('PLAN', 'STEP', 'ACTION', 'NOTE')),
    body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    detail     TEXT NULL CHECK (detail IS NULL OR length(detail) <= 200),
    created_at TEXT NOT NULL
) STRICT;

CREATE INDEX p08_conversation_entries_by_mission ON p08_conversation_entries (mission_id, entry_id);
"#;
