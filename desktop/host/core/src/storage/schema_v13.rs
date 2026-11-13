// مخطط v13 (ADR-037): المزوّد المخصّص. جدول جديد، ولا صفّ قائم يُلمس.
//
// العنوان الأساسي والنماذج المعلَنة يكتبها المستخدم؛ المفتاح لا يُخزَّن هنا أبدًا بل في مخزن بيانات الاعتماد باسم المزوّد.
// المعرّف بشكل معرّف المزوّد في العقد، والنماذج مصفوفة JSON محدودة الطول.

pub const V13: &str = r#"
CREATE TABLE provider_custom (
    provider_id  TEXT PRIMARY KEY NOT NULL CHECK (length(provider_id) BETWEEN 2 AND 48 AND provider_id GLOB '[a-z]*' AND provider_id NOT GLOB '*[^a-z0-9-]*'),
    display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 64),
    base_url     TEXT NOT NULL CHECK (length(base_url) BETWEEN 8 AND 256),
    models_json  TEXT NOT NULL CHECK (json_valid(models_json) AND json_type(models_json) = 'array' AND length(models_json) <= 32000),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
) STRICT;
"#;
