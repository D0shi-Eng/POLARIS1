// مخطط v19 (تكليف الإغلاق الوظيفي 2026-10-19): ما تحتاجه وظائف صارت حقيقية بعد أن كانت واجهة فقط أو غائبة.
//
// - `p08_settings`: ثلاثة مفاتيح جديدة في القائمة المغلقة: مزوّد البحث (`web.search_provider`)، وإشعارات النظام وصوتها
//   (`notifications.enabled`، `notifications.sound`). SQLite لا يعدّل قيد CHECK في مكانه، فيُبنى الجدول من جديد بالأعمدة
//   نفسها ويُنسخ كل صفّ داخل معاملة الترحيل (النمط نفسه في v12 وv15). مفتاح API للبحث لا يُحفظ هنا أبدًا: مكانه مخزن الاعتماد.
// - `p08_mission_ratings` (E-5): تقييم المستخدم لنتيجة دور، كان في `localStorage` وحده فيضيع مع ملف WebView2. يبقى على الجهاز
//   ولا يُرسل إلى أحد، ولا يُدّعى أنه يحسّن نموذجًا.
// - `p08_turn_notes`: رسالة يكتبها المستخدم والمهمّة تعمل. تُحفظ بترتيبها وحالتها: QUEUED حتى يقرأها الوكيل عند حدّ آمن بين
//   خطوتين فتصير DELIVERED بوقتها، أو NOT_DELIVERED إن انتهت المهمّة قبل ذلك. لا تدخل تعليمات النظام ولا تغيّر الصلاحيات.

pub const V19: &str = r#"
CREATE TABLE p08_settings_v19 (
    setting_key TEXT PRIMARY KEY NOT NULL CHECK (setting_key IN ('voice.transcription_endpoint', 'voice.transcription_model', 'workspace.export_folder_label', 'browser.engine_enabled', 'web.search_endpoint', 'profile.nickname', 'profile.profession', 'profile.about', 'profile.instructions', 'web.search_provider', 'notifications.enabled', 'notifications.sound')),
    value_json  TEXT NOT NULL CHECK (length(value_json) <= 16000),
    updated_at  TEXT NOT NULL
) STRICT;
INSERT INTO p08_settings_v19 (setting_key, value_json, updated_at)
    SELECT setting_key, value_json, updated_at FROM p08_settings;
DROP TABLE p08_settings;
ALTER TABLE p08_settings_v19 RENAME TO p08_settings;

CREATE TABLE p08_mission_ratings (
    mission_id  TEXT PRIMARY KEY NOT NULL REFERENCES missions (mission_id),
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    rated_at    TEXT NOT NULL
) STRICT;

CREATE TABLE p08_turn_notes (
    note_id       TEXT PRIMARY KEY NOT NULL,
    mission_id    TEXT NOT NULL REFERENCES missions (mission_id),
    seq           INTEGER NOT NULL CHECK (seq >= 1),
    text          TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
    state         TEXT NOT NULL CHECK (state IN ('QUEUED', 'DELIVERED', 'NOT_DELIVERED')),
    created_at    TEXT NOT NULL,
    delivered_at  TEXT NULL,
    UNIQUE (mission_id, seq),
    CHECK ((state = 'DELIVERED') = (delivered_at IS NOT NULL))
) STRICT;
"#;
