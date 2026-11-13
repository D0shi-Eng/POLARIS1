// مخطط v17 (المرحلة 2، خطة 2026-10-07، ADR-041): طبقات الثقة والمراقبة والحقيقة والأمن. لا صفّ يضيع.
//
// - `session_events`: سجلّ الجلسة append-only، مصدر الحقيقة للمحادثة. سلسلة تجزئة لكل جلسة (`prev_hash`/`hash`) يحسبها
//   المضيف، فتعديل صفّ يُكشف عند الإقلاع.
// - `spans`: امتدادات بأسماء OpenTelemetry GenAI (`invoke_agent`/`chat`/`execute_tool`). نسخة الحقول في `semconv` لأن
//   المواصفة ما زالت Development.
// - `protected_files`: بصمات ما أرفقه المستخدم في inputs/ عند بدء المهمّة، خارج مساحة الوكيل.
// - حالة خطوة جديدة `UNVERIFIED_DONE`: قال الوكيل «تمّت» ولا قياس يخصّها. ونوعا دليل جديدان: `GRADER_RESULT` (مصحِّح كود)
//   و`MODEL_JUDGMENT` (حكم نموذج مستقلّ، يبقى صنفه ظاهرًا). وأنواع تنبيه جديدة.
// - `agent_messages` يُربط بجلسته وامتداده.
//
// SQLite لا يعدّل قيد CHECK في مكانه: الجداول الثلاثة تُبنى من جديد بأعمدتها نفسها وتُنسخ صفوفها كلها، داخل معاملة الترحيل.
// جدولا `task_dependencies` و`claim_evidence` يشيران إلى الجدولين المعاد بناؤهما: فحص المفاتيح الأجنبية يُؤجَّل إلى نهاية
// المعاملة، وحينها يشير كلٌّ إلى الجدول الجديد بالاسم نفسه وصفوفه نفسها.

pub const V17: &str = r#"
PRAGMA defer_foreign_keys = ON;

CREATE TABLE tasks_v17 (
    task_id           TEXT PRIMARY KEY NOT NULL,
    mission_id        TEXT NOT NULL REFERENCES missions (mission_id),
    parent_task_id    TEXT NULL,
    title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    objective         TEXT NOT NULL CHECK (length(objective) <= 4000),
    task_type         TEXT NOT NULL CHECK (task_type IN ('PLAN','DESIGN','BUILD','DEBUG','REVIEW','SECURITY_REVIEW','TEST','RESEARCH','SYNTHESIZE')),
    state             TEXT NOT NULL CHECK (state IN ('PENDING','READY','ASSIGNED','RUNNING','WAITING','REVIEW','SUCCEEDED','FAILED','CANCELLED','BLOCKED','INTERRUPTED','UNVERIFIED_DONE')),
    assigned_agent_id TEXT NULL,
    attempt           INTEGER NOT NULL CHECK (attempt >= 0),
    max_attempts      INTEGER NOT NULL CHECK (max_attempts >= 1),
    failure_reason    TEXT NULL,
    graph_revision    INTEGER NOT NULL CHECK (graph_revision >= 0),
    ordinal           INTEGER NOT NULL,
    version           INTEGER NOT NULL CHECK (version >= 1)
) STRICT;
INSERT INTO tasks_v17 SELECT * FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_v17 RENAME TO tasks;
CREATE INDEX tasks_by_mission ON tasks (mission_id, ordinal);

CREATE TABLE evidence_v17 (
    evidence_id      TEXT PRIMARY KEY NOT NULL,
    mission_id       TEXT NOT NULL REFERENCES missions (mission_id),
    evidence_type    TEXT NOT NULL CHECK (evidence_type IN ('USER_CONFIRMATION','RUNTIME_MEASUREMENT','TEST_RESULT','TOOL_RESULT','ARTIFACT','SOURCE_DOCUMENT','PROJECT_CONTEXT','PROVIDER_RESPONSE','POLICY_DECISION','AUDIT_EVENT','COMPLETION_PROOF','AGENT_OUTPUT','GRADER_RESULT','MODEL_JUDGMENT')),
    digest           TEXT NOT NULL,
    producer         TEXT NOT NULL,
    authority        TEXT NOT NULL,
    source_ref       TEXT NOT NULL,
    lineage_json     TEXT NOT NULL,
    measurement_kind TEXT NOT NULL CHECK (measurement_kind IN ('MEASURED', 'INFERRED')),
    taint_json       TEXT NOT NULL,
    summary          TEXT NOT NULL CHECK (length(summary) <= 4000),
    created_at       TEXT NOT NULL
) STRICT;
INSERT INTO evidence_v17 SELECT * FROM evidence;
DROP TABLE evidence;
ALTER TABLE evidence_v17 RENAME TO evidence;
CREATE INDEX evidence_by_mission ON evidence (mission_id, created_at);

CREATE TABLE obs_alerts_v17 (
    alert_id    TEXT PRIMARY KEY NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('BUDGET_NEAR_LIMIT', 'BUDGET_EXCEEDED', 'PROVIDER_UNHEALTHY', 'CONNECTOR_UNHEALTHY', 'ERROR_SPIKE', 'STORAGE_ISSUE', 'NO_PROGRESS_LOOP', 'TURNS_ABOVE_EXPECTED', 'MISSION_OVERTIME', 'INJECTION_DETECTED', 'TAMPER_DETECTED', 'HONEYTOKEN_READ')),
    severity    TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    subject     TEXT NOT NULL CHECK (length(subject) <= 200),
    reason_code TEXT NOT NULL CHECK (length(reason_code) <= 80),
    first_at    TEXT NOT NULL,
    last_at     TEXT NOT NULL,
    occurrences INTEGER NOT NULL CHECK (occurrences >= 1),
    state       TEXT NOT NULL CHECK (state IN ('OPEN', 'RESOLVED')),
    UNIQUE (kind, subject)
) STRICT;
INSERT INTO obs_alerts_v17 SELECT * FROM obs_alerts;
DROP TABLE obs_alerts;
ALTER TABLE obs_alerts_v17 RENAME TO obs_alerts;

CREATE TABLE session_events (
    session_id   TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 64),
    seq          INTEGER NOT NULL CHECK (seq >= 1),
    mission_id   TEXT NOT NULL CHECK (length(mission_id) BETWEEN 1 AND 64),
    kind         TEXT NOT NULL CHECK (kind IN ('USER_MESSAGE','ASSISTANT_MESSAGE','TOOL_RESULT','HOST_NOTE','SUMMARY','APPROVAL','INJECTION_FLAGGED','MONITOR_DECISION','SECURITY_EVENT')),
    authority    TEXT NOT NULL CHECK (authority IN ('SYSTEM_POLICY','DIRECT_USER_INSTRUCTION','TRUSTED_RUNTIME_FACT','AGENT_MESSAGE','MODEL_GENERATED','UNTRUSTED_CONTENT')),
    parent_seq   INTEGER NULL CHECK (parent_seq IS NULL OR parent_seq >= 1),
    payload_json TEXT NOT NULL CHECK (length(payload_json) <= 262144),
    created_at   TEXT NOT NULL,
    prev_hash    TEXT NOT NULL CHECK (length(prev_hash) = 64),
    hash         TEXT NOT NULL CHECK (length(hash) = 64),
    PRIMARY KEY (session_id, seq)
) STRICT;
CREATE INDEX session_events_by_mission ON session_events (mission_id, seq);

CREATE TABLE spans (
    span_id        TEXT PRIMARY KEY NOT NULL CHECK (length(span_id) = 16),
    trace_id       TEXT NOT NULL CHECK (length(trace_id) = 32),
    parent_span_id TEXT NULL CHECK (parent_span_id IS NULL OR length(parent_span_id) = 16),
    mission_id     TEXT NOT NULL,
    name           TEXT NOT NULL CHECK (name IN ('invoke_agent', 'chat', 'execute_tool')),
    agent_id       TEXT NULL,
    task_id        TEXT NULL,
    model_id       TEXT NULL CHECK (model_id IS NULL OR length(model_id) <= 200),
    provider_id    TEXT NULL CHECK (provider_id IS NULL OR length(provider_id) <= 80),
    tool_id        TEXT NULL CHECK (tool_id IS NULL OR length(tool_id) <= 200),
    invocation_id  TEXT NULL,
    input_tokens   INTEGER NULL CHECK (input_tokens IS NULL OR input_tokens >= 0),
    output_tokens  INTEGER NULL CHECK (output_tokens IS NULL OR output_tokens >= 0),
    latency_ms     INTEGER NULL CHECK (latency_ms IS NULL OR latency_ms >= 0),
    cost_micros    INTEGER NULL CHECK (cost_micros IS NULL OR cost_micros >= 0),
    status         TEXT NOT NULL CHECK (status IN ('OK', 'ERROR', 'DENIED', 'AWAITING_APPROVAL', 'CANCELLED')),
    gate_decision  TEXT NULL CHECK (gate_decision IS NULL OR length(gate_decision) <= 80),
    started_at     TEXT NOT NULL,
    semconv        TEXT NOT NULL CHECK (length(semconv) <= 40)
) STRICT;
CREATE INDEX spans_by_mission ON spans (mission_id, started_at);
CREATE INDEX spans_by_trace ON spans (trace_id);

CREATE TABLE protected_files (
    mission_id TEXT NOT NULL,
    path       TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 400),
    sha256     TEXT NOT NULL CHECK (length(sha256) = 64),
    taken_at   TEXT NOT NULL,
    PRIMARY KEY (mission_id, path)
) STRICT;

-- أدوات MCP أعاد خادمها تعريفها بعد الاكتشاف (ASI04): لا تُنفَّذ حتى يقبل المستخدم تعريفها الجديد.
CREATE TABLE mcp_redefinitions (
    tool_id     TEXT PRIMARY KEY NOT NULL CHECK (length(tool_id) <= 300),
    server_id   TEXT NOT NULL,
    detected_at TEXT NOT NULL
) STRICT;

ALTER TABLE agent_messages ADD COLUMN session_id TEXT NULL;
ALTER TABLE agent_messages ADD COLUMN span_id TEXT NULL;
"#;
