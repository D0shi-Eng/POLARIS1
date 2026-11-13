// مخطط v12 (بحث الويب، خطة 2026-10-05 البند B5): مفتاح إعداد واحد يُضاف، ولا صفّ يضيع.
//
// `p08_settings.setting_key` مقيّد بقائمة مغلقة. خادم البحث المحلي (`web.search_endpoint`) يُضبط من الإعدادات كخادم
// التفريغ. SQLite لا يعدّل قيد CHECK في مكانه، فيُبنى الجدول من جديد بالأعمدة نفسها ويُنسخ كل صفّ، داخل معاملة الترحيل.

pub const V12: &str = r#"
CREATE TABLE p08_settings_v12 (
    setting_key TEXT PRIMARY KEY NOT NULL CHECK (setting_key IN ('voice.transcription_endpoint', 'voice.transcription_model', 'workspace.export_folder_label', 'browser.engine_enabled', 'web.search_endpoint')),
    value_json  TEXT NOT NULL CHECK (length(value_json) <= 2000),
    updated_at  TEXT NOT NULL
) STRICT;
INSERT INTO p08_settings_v12 (setting_key, value_json, updated_at)
    SELECT setting_key, value_json, updated_at FROM p08_settings;
DROP TABLE p08_settings;
ALTER TABLE p08_settings_v12 RENAME TO p08_settings;
"#;
