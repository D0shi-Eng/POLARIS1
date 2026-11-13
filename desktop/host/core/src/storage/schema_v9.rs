// مخطط v9 (إدارة المحادثات، 2026-10-01): جدول واحد يُضاف، لا جدول يُمسّ.
//
// `p08_conversation_state`: ما يقرّره المستخدم عن محادثة من قائمة «⋯»: تثبيتها أعلى القائمة، ووضعها في
// المفضّلة، وأرشفتها (تُخفى من القائمة ولا تُحذف)، ووقت إعادة تسميتها (عنوان سمّاه المستخدم لا يستبدله
// عنوان يقترحه المخطّط). صفّ لكل محادثة غُيّر فيها شيء؛ المحادثة بلا صفّ: غير مثبّتة ولا مفضّلة ولا مؤرشفة.

pub const V9: &str = r#"
CREATE TABLE p08_conversation_state (
    thread_id   TEXT PRIMARY KEY NOT NULL CHECK (length(thread_id) = 36),
    pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    favorite    INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    archived_at TEXT NULL,
    renamed_at  TEXT NULL,
    updated_at  TEXT NOT NULL
) STRICT;
"#;
