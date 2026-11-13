// مخطط v22 (PHASE-08، 2026-10-21): متجهات الذاكرة للاسترجاع الدلالي.
//
// متجه لكل مدخل ونموذج تضمين، ومعه بصمة المحتوى الذي حُسب منه: محتوى تغيّر = متجه قديم يُعاد حسابه، ومتجهان من نموذجين لا
// يُقارنان. الحذف يتبع المدخل (`ON DELETE CASCADE`، والمخزن يحذفه صراحةً حين يمحو المدخل): المتجه يحمل معنى النصّ، فلا يبقى بعده.
// إضافة بحتة: لا جدول قائم يتغيّر.

pub const V22: &str = r#"
CREATE TABLE memory_embeddings (
    memory_id      TEXT NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
    model_id       TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 200),
    content_digest TEXT NOT NULL CHECK (length(content_digest) BETWEEN 1 AND 128),
    dim            INTEGER NOT NULL CHECK (dim BETWEEN 1 AND 8192),
    vector         BLOB NOT NULL CHECK (length(vector) = dim * 4),
    created_at     TEXT NOT NULL,
    PRIMARY KEY (memory_id, model_id)
) STRICT;
"#;
