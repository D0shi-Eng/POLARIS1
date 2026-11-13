// مخطط v16 (الجلسة 1، خطة 2026-10-07، ADR-040): لا خيار «محلي/بعيد» في المخزن، ولا مراجِع خفيّ.
//
// - تفضيل الموقع المخزّن (`preferences.locality_preference`) يُحذف: لم يعد في النظام ما يقرؤه.
// - سياسة سياق المشروع (`projects.context_policy`) عمود يُحذف. قيده CHECK يخصّه وحده، فيقبل SQLite حذفه في مكانه، ويعيد
//   بناء الجدول داخل معاملة الترحيل بصفوفه كلها.
// - مفتاحا الإعدادات `privacy.local_only` و`privacy.allow_remote_models` يُحذفان من كل الطبقات، ومنها طبقة السياسة المُدارة.
// - نموذج المراجعة المخزّن (`preferences.review_model_id`) يُحذف. السبب مقيس: الواجهة لم تعد تُظهره بعد 2026-10-06، فأرسلت
//   مهمّة على نموذج LM Studio محلي نداءً إلى Groq بسببه (قاعدة المالك، 2026-10-06 19:58). المراجِع يُختار صراحةً من جديد.
// - النموذج الافتراضي الذي اختاره المستخدم يبقى كما هو.

pub const V16: &str = r#"
DELETE FROM preferences WHERE key IN ('locality_preference', 'review_model_id');
ALTER TABLE projects DROP COLUMN context_policy;
DELETE FROM config_values WHERE setting_key IN ('privacy.local_only', 'privacy.allow_remote_models');
"#;
