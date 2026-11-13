// مخطط v23 (2026-10-21، PHASE-12 بقرار المالك): إعداد الاسترجاع الدلالي للذاكرة في `p08_settings`.
//
// ستة مفاتيح جديدة في القائمة المغلقة: التفعيل، وعنوان خادم التضمين (على هذا الجهاز وحده، يفحصه المضيف)، والنموذج، والحدّ
// الأدنى للتشابه، وبادئتا المهمة. SQLite لا يعدّل قيد CHECK في مكانه، فيُبنى الجدول من جديد بالأعمدة نفسها ويُنسخ كل صفّ داخل
// معاملة الترحيل (النمط نفسه في v12 وv15 وv19).

pub const V23: &str = r#"
CREATE TABLE p08_settings_v23 (
    setting_key TEXT PRIMARY KEY NOT NULL CHECK (setting_key IN ('voice.transcription_endpoint', 'voice.transcription_model', 'workspace.export_folder_label', 'browser.engine_enabled', 'web.search_endpoint', 'profile.nickname', 'profile.profession', 'profile.about', 'profile.instructions', 'web.search_provider', 'notifications.enabled', 'notifications.sound', 'memory.semantic.enabled', 'memory.semantic.endpoint', 'memory.semantic.model', 'memory.semantic.min_similarity', 'memory.semantic.query_prefix', 'memory.semantic.document_prefix')),
    value_json  TEXT NOT NULL CHECK (length(value_json) <= 16000),
    updated_at  TEXT NOT NULL
) STRICT;
INSERT INTO p08_settings_v23 (setting_key, value_json, updated_at)
    SELECT setting_key, value_json, updated_at FROM p08_settings;
DROP TABLE p08_settings;
ALTER TABLE p08_settings_v23 RENAME TO p08_settings;
"#;
