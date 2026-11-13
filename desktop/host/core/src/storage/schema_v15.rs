// مخطط v15 (جولة 2026-10-06، صفحة «تخصيص» كما في مانوس): أربعة مفاتيح إعداد للملف الشخصي، ولا صفّ يضيع.
//
// `p08_settings.setting_key` مقيّد بقائمة مغلقة، والقيمة بحدّ 2000. «تعليمات مخصّصة» تصل إلى 3000 حرف، فيرتفع الحدّ
// إلى 16000 (نصّ JSON بعلامات الهروب). SQLite لا يعدّل قيد CHECK في مكانه، فيُبنى الجدول من جديد بالأعمدة نفسها ويُنسخ
// كل صفّ، داخل معاملة الترحيل.

pub const V15: &str = r#"
CREATE TABLE p08_settings_v15 (
    setting_key TEXT PRIMARY KEY NOT NULL CHECK (setting_key IN ('voice.transcription_endpoint', 'voice.transcription_model', 'workspace.export_folder_label', 'browser.engine_enabled', 'web.search_endpoint', 'profile.nickname', 'profile.profession', 'profile.about', 'profile.instructions')),
    value_json  TEXT NOT NULL CHECK (length(value_json) <= 16000),
    updated_at  TEXT NOT NULL
) STRICT;
INSERT INTO p08_settings_v15 (setting_key, value_json, updated_at)
    SELECT setting_key, value_json, updated_at FROM p08_settings;
DROP TABLE p08_settings;
ALTER TABLE p08_settings_v15 RENAME TO p08_settings;
"#;
