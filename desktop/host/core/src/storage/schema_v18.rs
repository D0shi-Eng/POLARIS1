// مخطط v18 (تكليف الإصلاح 2026-10-12): حالة التشغيل التراكمية ومرساة نهاية سجلّ الجلسة.
//
// - `mission_runtime_state` (R-07، R-03): الاستهلاك التراكمي للميزانية والزمن، وعدّادات الرفض، وأعلام قاعدة الاثنين، والإثبات
//   كما حُسم عند آخر إنهاء. صفّ واحد لكل مهمّة يُكتب في معاملة حفظ اللقطة نفسها، فلا تختلف الحالة عن اللقطة. يُحذف مع
//   مهمّته في مسار الحذف الحقيقي.
// - `session_heads`: آخر رقم وآخر تجزئة لكل جلسة، يُحدَّث في معاملة الإلحاق نفسها. سلسلة التجزئة وحدها تكشف تعديل صفّ أو
//   إدراجه، ولا تكشف حذف آخر الأحداث؛ المرساة تكشفه. حدّها المعلن: من يكتب في القاعدة نفسها يستطيع تعديل الاثنين معًا، فهي
//   تكشف القصّ العارض والحذف الساذج، لا مهاجمًا محليًّا يملك صلاحية الكتابة.
//   المرساة تُملأ عند الترحيل من الأحداث القائمة كما هي (ثقة عند أول ترحيل)، ثم تُفحص بعده.
// - `agent_memories` و`agent_memory_grants` (القسم 6، الوكلاء الـ300): ذاكرة بنطاق هوية الوكيل، ومنح قراءة صريحة لا تنتقل.
// - `agent_instances.definition_id/definition_version`: الهوية التنفيذية لمثيل وكيل تحمل تعريفه وإصداره حين يعمل بتعريف.

pub const V18: &str = r#"
CREATE TABLE mission_runtime_state (
    mission_id  TEXT PRIMARY KEY NOT NULL REFERENCES missions (mission_id),
    state_json  TEXT NOT NULL CHECK (length(state_json) <= 262144),
    updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE session_heads (
    session_id  TEXT PRIMARY KEY NOT NULL,
    last_seq    INTEGER NOT NULL CHECK (last_seq >= 1),
    last_hash   TEXT NOT NULL,
    updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE agent_memories (
    memory_id   TEXT PRIMARY KEY NOT NULL,
    agent_id    TEXT NOT NULL CHECK (length(agent_id) BETWEEN 7 AND 120),
    mission_id  TEXT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('EPISODE', 'NOTE')),
    text        TEXT NOT NULL CHECK (length(text) <= 2000),
    provenance  TEXT NOT NULL CHECK (provenance IN ('HOST_MEASURED')),
    created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX agent_memories_by_agent ON agent_memories (agent_id, created_at);

CREATE TABLE agent_memory_grants (
    memory_id   TEXT NOT NULL REFERENCES agent_memories (memory_id),
    to_agent_id TEXT NOT NULL,
    granted_at  TEXT NOT NULL,
    PRIMARY KEY (memory_id, to_agent_id)
) STRICT;

ALTER TABLE agent_instances ADD COLUMN definition_id TEXT NULL;
ALTER TABLE agent_instances ADD COLUMN definition_version TEXT NULL;

INSERT INTO session_heads (session_id, last_seq, last_hash, updated_at)
SELECT e.session_id, e.seq, e.hash, e.created_at
FROM session_events e
WHERE e.seq = (SELECT max(x.seq) FROM session_events x WHERE x.session_id = e.session_id);
"#;
