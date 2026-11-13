// مخطط v24 (2026-10-23، PHASE-14): الأتمتة تقول ما حدث فعلًا.
//
// - `p08_schedule_runs.trigger_kind`: نوعان جديدان: CATCH_UP (موعد حلّ والتطبيق مغلق، فأُطلق مرّة واحدة عند فتحه متأخّرًا)، وRETRY
//   (محاولة ثانية واحدة بعد فشل الإطلاق أو فشل المهمّة). SQLite لا يعدّل قيد CHECK في مكانه، فيُبنى الجدول من جديد بالأعمدة نفسها
//   ويُنسخ كل صفّ ثم يُعاد فهرسه.
// - `p08_schedules.retry_pending`: محاولة إعادة مجدولة لهذا الجدول (0 أو 1). إضافة عمود بقيمة افتراضية لا تمسّ صفًّا قائمًا.

pub const V24: &str = r#"
CREATE TABLE p08_schedule_runs_v24 (
    run_id       TEXT PRIMARY KEY NOT NULL CHECK (length(run_id) = 36),
    schedule_id  TEXT NOT NULL CHECK (length(schedule_id) = 36),
    mission_id   TEXT NULL CHECK (mission_id IS NULL OR length(mission_id) = 36),
    trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('SCHEDULED', 'RUN_NOW', 'CATCH_UP', 'RETRY')),
    status       TEXT NOT NULL CHECK (length(status) BETWEEN 3 AND 40),
    detail       TEXT NOT NULL CHECK (length(detail) <= 1000),
    triggered_at TEXT NOT NULL
) STRICT;
INSERT INTO p08_schedule_runs_v24 (run_id, schedule_id, mission_id, trigger_kind, status, detail, triggered_at)
    SELECT run_id, schedule_id, mission_id, trigger_kind, status, detail, triggered_at FROM p08_schedule_runs;
DROP TABLE p08_schedule_runs;
ALTER TABLE p08_schedule_runs_v24 RENAME TO p08_schedule_runs;
CREATE INDEX p08_schedule_runs_by_schedule ON p08_schedule_runs (schedule_id, triggered_at);

ALTER TABLE p08_schedules ADD COLUMN retry_pending INTEGER NOT NULL DEFAULT 0 CHECK (retry_pending IN (0, 1));
"#;
