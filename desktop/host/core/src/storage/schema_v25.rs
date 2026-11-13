// مخطط v25 (2026-10-23، مكافأة الأتمتة مع Manus): تاريخ انتهاء الجدول، وأين يعمل كل تشغيل.
//
// - `p08_schedules.end_at`: آخر لحظة يعمل فيها الجدول (لحظة UTC)، أو NULL بلا انتهاء.
// - `p08_schedules.run_target`: SEPARATE_TASK (مهمّة لكل تشغيل، كما كان) أو SAME_TASK (الدور التالي في مهمّة التشغيل السابق).
// إضافة أعمدة بقيم افتراضية لا تمسّ صفًّا قائمًا: كل جدول قائم يبقى بلا انتهاء وبمهمّة منفصلة.

pub const V25: &str = r#"
ALTER TABLE p08_schedules ADD COLUMN end_at TEXT NULL CHECK (end_at IS NULL OR length(end_at) = 20);
ALTER TABLE p08_schedules ADD COLUMN run_target TEXT NOT NULL DEFAULT 'SEPARATE_TASK' CHECK (run_target IN ('SEPARATE_TASK', 'SAME_TASK'));
"#;
