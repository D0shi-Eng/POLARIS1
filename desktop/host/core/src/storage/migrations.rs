// الترحيلات: قائمة مرتّبة، كل عنصر ينقل المخطط خطوة واحدة داخل معاملة.
//
// لا ترحيل يحذف بيانات. عنصر فاشل يُرجع المعاملة كلها، فلا تبقى القاعدة في
// منتصف خطوة.

use rusqlite::Connection;

use super::db::StorageError;

/// المخطط الذي يفهمه هذا البناء. v2 أضافت جداول Phase-03 (المهام والوكلاء
/// والادّعاءات والأدلّة) دون المساس بجداول v1، وv3 أضافت جداول Phase-04
/// (المهارات، وخوادم MCP، وأدواتها، وسجل الاستدعاءات، والموافقات) وأعادت بناء
/// جدول الأدلّة لإدخال نوع `TOOL_RESULT` في قيده المغلق. v4 أضافت جداول Phase-05،
/// وv5 أضافت جداول Phase-06 (الموصلات، والاستعمال والكلفة، والميزانيات، والرصد،
/// وطبقات الإعدادات) إضافةً بحتة، وv6 أضافت جداول Phase-08 (بيئة التنفيذ والمخرجات
/// والمرفقات والمجدول وOAuth والمشاركة والنشر وحزم المهارات وهوية الجهاز) إضافةً بحتة.
/// وv7 أضافت جدولي المحادثة (أدوار المستخدم وسرد المهمّة الحيّ) إضافةً بحتة، وv8 عمود المتخصّص
/// المثبَّت في تفضيلات المهمّة، وv9 جدول حالة المحادثة (تثبيت، مفضّلة، أرشفة، إعادة تسمية)، وv10 مصدر
/// USER في قرارات الذاكرة («تذكّر هذا»؛ إعادة بناء جدول واحد بنسخ كل صفوفه)، وv11 صنف SUGGESTION في سرد
/// المحادثة (أسئلة المتابعة؛ إعادة بناء بالطريقة نفسها).
/// وv20 (2026-10-19) أعمدة فحص المرفق (العائلة والنوع ومطابقة التوقيع وطريق وصوله إلى النموذج) إضافةً بحتة.
/// وv21 (2026-10-21، PHASE-06) نقل REMOTE_HTTPS لخوادم MCP (إعادة بناء `mcp_servers` بنسخ كل صفوفه).
/// وv22 (2026-10-21، PHASE-08) متجهات الذاكرة للاسترجاع الدلالي (جدول جديد، إضافة بحتة).
/// وv23 (2026-10-21، PHASE-12) مفاتيح إعداد الاسترجاع الدلالي للذاكرة في `p08_settings` (إعادة بناء بنسخ كل صفوفه).
/// وv24 (2026-10-23، PHASE-14) نوعا تشغيل مجدول جديدان (CATCH_UP، RETRY) وعمود محاولة الإعادة.
pub const SUPPORTED_VERSION: i64 = 25;

const V1: &str = r#"
CREATE TABLE projects (
    project_id       TEXT PRIMARY KEY NOT NULL,
    name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    description      TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    status           TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    language         TEXT NOT NULL,
    workspace_root   TEXT NULL,
    default_model_id TEXT NULL,
    context_policy   TEXT NOT NULL CHECK (context_policy IN ('LOCAL_ONLY', 'ALLOW_REMOTE')),
    version          INTEGER NOT NULL CHECK (version >= 1),
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
) STRICT;

CREATE TABLE context_sources (
    source_id     TEXT PRIMARY KEY NOT NULL,
    project_id    TEXT NOT NULL REFERENCES projects (project_id),
    source_type   TEXT NOT NULL CHECK (source_type IN ('WORKSPACE_ROOT', 'FILE', 'FOLDER', 'TEXT_NOTE', 'SYSTEM_CONTEXT', 'USER_INSTRUCTION')),
    reference     TEXT NOT NULL,
    text_body     TEXT NULL,
    display_name  TEXT NOT NULL,
    trust_class   TEXT NOT NULL,
    content_class TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REMOVED')),
    added_at      TEXT NOT NULL,
    last_seen_at  TEXT NULL,
    availability  TEXT NOT NULL,
    digest        TEXT NULL,
    byte_count    INTEGER NULL
) STRICT;
CREATE INDEX context_sources_by_project ON context_sources (project_id, status);

CREATE TABLE provider_config (
    provider_id TEXT PRIMARY KEY NOT NULL,
    enabled     INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    endpoint    TEXT NULL,
    updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE provider_health (
    provider_id  TEXT PRIMARY KEY NOT NULL,
    state        TEXT NOT NULL,
    reason_code  TEXT NOT NULL,
    checked_at   TEXT NOT NULL,
    latency_ms   INTEGER NULL,
    installation TEXT NOT NULL,
    runtime      TEXT NOT NULL
) STRICT;

CREATE TABLE models (
    model_id          TEXT PRIMARY KEY NOT NULL,
    provider_id       TEXT NOT NULL,
    provider_model_id TEXT NOT NULL,
    facts_json        TEXT NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    availability      TEXT NOT NULL,
    first_seen_at     TEXT NOT NULL,
    last_seen_at      TEXT NOT NULL,
    last_refresh_at   TEXT NOT NULL,
    UNIQUE (provider_id, provider_model_id)
) STRICT;

CREATE TABLE preferences (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) STRICT;

CREATE TABLE audit_events (
    seq            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id       TEXT NOT NULL UNIQUE,
    event_type     TEXT NOT NULL,
    occurred_at    TEXT NOT NULL,
    subject_kind   TEXT NOT NULL,
    subject_id     TEXT NOT NULL,
    outcome        TEXT NOT NULL,
    detail_json    TEXT NOT NULL,
    prev_hash      TEXT NOT NULL,
    hash           TEXT NOT NULL
);
"#;

/// Phase-03: المهمّات ورسوم مهامها ووكلاؤها وادّعاءاتها وأدلّتها.
///
/// لا سرّ يُخزَّن هنا، ولا سياق مشروع كامل: مراجع وبصمات وملخّصات محدودة الطول
/// (البند 72/153). القيود المُعلنة تعكس المفردات المغلقة في `p03` نفسها، فلا تُكتب
/// حالة لا تعرفها آلة الحالة.
const V2: &str = r#"
CREATE TABLE missions (
    mission_id              TEXT PRIMARY KEY NOT NULL,
    project_id              TEXT NULL REFERENCES projects (project_id),
    title                   TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    title_authority         TEXT NOT NULL,
    objective               TEXT NOT NULL CHECK (length(objective) <= 8000),
    origin                  TEXT NOT NULL CHECK (origin IN ('USER', 'SYSTEM')),
    execution_mode          TEXT NOT NULL CHECK (execution_mode IN ('SINGLE_AGENT', 'COORDINATED_MULTI_AGENT')),
    priority                TEXT NOT NULL CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
    state                   TEXT NOT NULL CHECK (state IN ('CREATED','PLANNING','READY','RUNNING','WAITING_FOR_APPROVAL','WAITING_FOR_USER','BLOCKED','VERIFYING','COMPLETED','FAILED','CANCELLED','STOPPED')),
    completion_proof_status TEXT NOT NULL CHECK (completion_proof_status IN ('NOT_EVALUATED', 'NOT_PROVEN', 'PROVEN')),
    current_revision        INTEGER NOT NULL CHECK (current_revision >= 1),
    root_task_id            TEXT NULL,
    budget_json             TEXT NOT NULL,
    result_summary          TEXT NULL CHECK (result_summary IS NULL OR length(result_summary) <= 4000),
    failure_reason          TEXT NULL,
    created_at              TEXT NOT NULL,
    started_at              TEXT NULL,
    completed_at            TEXT NULL,
    version                 INTEGER NOT NULL CHECK (version >= 1)
) STRICT;
CREATE INDEX missions_by_state ON missions (state, created_at);
CREATE INDEX missions_by_project ON missions (project_id);

CREATE TABLE mission_requirements (
    requirement_id       TEXT NOT NULL,
    mission_id           TEXT NOT NULL REFERENCES missions (mission_id),
    text                 TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
    verification_rule_id TEXT NOT NULL,
    mandatory            INTEGER NOT NULL CHECK (mandatory IN (0, 1)),
    status               TEXT NOT NULL CHECK (status IN ('PENDING','SATISFIED','UNSATISFIED','UNVERIFIED','BLOCKED')),
    claim_ref            TEXT NULL,
    ordinal              INTEGER NOT NULL,
    -- المتطلَّب محصور بمهمّته: معرّفه محلّي لا عالمي، فمهمّتان قد تحملان "req-1".
    PRIMARY KEY (mission_id, requirement_id)
) STRICT;
CREATE INDEX mission_requirements_by_mission ON mission_requirements (mission_id, ordinal);

CREATE TABLE tasks (
    task_id           TEXT PRIMARY KEY NOT NULL,
    mission_id        TEXT NOT NULL REFERENCES missions (mission_id),
    parent_task_id    TEXT NULL,
    title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    objective         TEXT NOT NULL CHECK (length(objective) <= 4000),
    task_type         TEXT NOT NULL CHECK (task_type IN ('PLAN','DESIGN','BUILD','DEBUG','REVIEW','SECURITY_REVIEW','TEST','RESEARCH','SYNTHESIZE')),
    state             TEXT NOT NULL CHECK (state IN ('PENDING','READY','ASSIGNED','RUNNING','WAITING','REVIEW','SUCCEEDED','FAILED','CANCELLED','BLOCKED','INTERRUPTED')),
    assigned_agent_id TEXT NULL,
    attempt           INTEGER NOT NULL CHECK (attempt >= 0),
    max_attempts      INTEGER NOT NULL CHECK (max_attempts >= 1),
    failure_reason    TEXT NULL,
    graph_revision    INTEGER NOT NULL CHECK (graph_revision >= 0),
    ordinal           INTEGER NOT NULL,
    version           INTEGER NOT NULL CHECK (version >= 1)
) STRICT;
CREATE INDEX tasks_by_mission ON tasks (mission_id, ordinal);

CREATE TABLE task_dependencies (
    mission_id    TEXT NOT NULL REFERENCES missions (mission_id),
    task_id       TEXT NOT NULL REFERENCES tasks (task_id),
    depends_on    TEXT NOT NULL REFERENCES tasks (task_id),
    kind          TEXT NOT NULL CHECK (kind IN ('REQUIRES_SUCCESS', 'REQUIRES_COMPLETION')),
    PRIMARY KEY (task_id, depends_on),
    CHECK (task_id <> depends_on)
) STRICT;

CREATE TABLE agent_instances (
    agent_id         TEXT PRIMARY KEY NOT NULL,
    mission_id       TEXT NOT NULL REFERENCES missions (mission_id),
    role             TEXT NOT NULL CHECK (role IN ('COORDINATOR','PLANNER','ARCHITECT','BUILDER','DEBUGGER','REVIEWER','SECURITY_REVIEWER','TEST_ENGINEER','RESEARCHER')),
    model_id         TEXT NULL,
    state            TEXT NOT NULL CHECK (state IN ('CREATED','IDLE','WORKING','WAITING','REVIEWING','BLOCKED','COMPLETED','FAILED','CANCELLED','STOPPED')),
    delegation_depth INTEGER NOT NULL CHECK (delegation_depth >= 0),
    parent_agent_id  TEXT NULL,
    current_task_id  TEXT NULL,
    created_at       TEXT NOT NULL,
    last_active_at   TEXT NOT NULL
) STRICT;
CREATE INDEX agent_instances_by_mission ON agent_instances (mission_id);

CREATE TABLE agent_messages (
    message_id      TEXT PRIMARY KEY NOT NULL,
    mission_id      TEXT NOT NULL REFERENCES missions (mission_id),
    sender_agent_id TEXT NOT NULL,
    recipient_kind  TEXT NOT NULL CHECK (recipient_kind IN ('AGENT', 'COORDINATOR')),
    recipient_id    TEXT NULL,
    message_type    TEXT NOT NULL CHECK (message_type IN ('TASK_ASSIGNMENT','TASK_UPDATE','QUESTION','ANSWER','PROPOSAL','CLAIM','EVIDENCE_REFERENCE','REVIEW_REQUEST','REVIEW_RESULT','BLOCKED_NOTICE','DELEGATION_REQUEST','DELEGATION_RESULT','COMPLETION_NOTICE')),
    causation_id    TEXT NULL,
    correlation_id  TEXT NULL,
    payload         TEXT NOT NULL CHECK (length(payload) <= 16384),
    taint_json      TEXT NOT NULL,
    authority       TEXT NOT NULL CHECK (authority IN ('AGENT_MESSAGE', 'MODEL_GENERATED')),
    created_at      TEXT NOT NULL
) STRICT;
CREATE INDEX agent_messages_by_mission ON agent_messages (mission_id, created_at);

CREATE TABLE evidence (
    evidence_id      TEXT PRIMARY KEY NOT NULL,
    mission_id       TEXT NOT NULL REFERENCES missions (mission_id),
    evidence_type    TEXT NOT NULL CHECK (evidence_type IN ('USER_CONFIRMATION','RUNTIME_MEASUREMENT','TEST_RESULT','ARTIFACT','SOURCE_DOCUMENT','PROJECT_CONTEXT','PROVIDER_RESPONSE','POLICY_DECISION','AUDIT_EVENT','COMPLETION_PROOF','AGENT_OUTPUT')),
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
CREATE INDEX evidence_by_mission ON evidence (mission_id, created_at);

CREATE TABLE claims (
    claim_id              TEXT PRIMARY KEY NOT NULL,
    mission_id            TEXT NOT NULL REFERENCES missions (mission_id),
    task_id               TEXT NULL,
    agent_id              TEXT NOT NULL,
    statement             TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 4000),
    claim_type            TEXT NOT NULL CHECK (claim_type IN ('FACT','RESULT','COMPLETION','REQUIREMENT_SATISFACTION','ASSUMPTION','RISK','OBSERVATION')),
    status                TEXT NOT NULL CHECK (status IN ('UNVERIFIED','SUPPORTED','VERIFIED','REFUTED','CONFLICTED','UNKNOWN')),
    subject               TEXT NULL,
    property              TEXT NULL,
    value                 TEXT NULL,
    taint_json            TEXT NOT NULL,
    verification_required INTEGER NOT NULL CHECK (verification_required IN (0, 1)),
    revision              INTEGER NOT NULL CHECK (revision >= 1),
    created_at            TEXT NOT NULL
) STRICT;
CREATE INDEX claims_by_mission ON claims (mission_id, created_at);

CREATE TABLE claim_evidence (
    claim_id    TEXT NOT NULL REFERENCES claims (claim_id),
    evidence_id TEXT NOT NULL REFERENCES evidence (evidence_id),
    stance      TEXT NOT NULL CHECK (stance IN ('SUPPORTS', 'COUNTERS')),
    PRIMARY KEY (claim_id, evidence_id, stance)
) STRICT;

CREATE TABLE reviews (
    review_id       TEXT PRIMARY KEY NOT NULL,
    mission_id      TEXT NOT NULL REFERENCES missions (mission_id),
    task_id         TEXT NOT NULL,
    reviewer_agent  TEXT NOT NULL,
    verdict         TEXT NOT NULL CHECK (verdict IN ('ACCEPT', 'REVISE', 'REJECT', 'BLOCKED')),
    independence    TEXT NOT NULL CHECK (independence IN ('SAME_MODEL_REVIEW', 'INDEPENDENT_MODEL_REVIEW')),
    round           INTEGER NOT NULL CHECK (round >= 1),
    notes           TEXT NOT NULL CHECK (length(notes) <= 4000),
    created_at      TEXT NOT NULL
) STRICT;
CREATE INDEX reviews_by_mission ON reviews (mission_id, created_at);

CREATE TABLE mission_events (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    TEXT NOT NULL UNIQUE,
    mission_id  TEXT NOT NULL REFERENCES missions (mission_id),
    event_type  TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    subject_id  TEXT NOT NULL,
    detail_json TEXT NOT NULL CHECK (length(detail_json) <= 8192)
);
CREATE INDEX mission_events_by_mission ON mission_events (mission_id, seq);

CREATE TABLE orchestration_checkpoints (
    mission_id     TEXT PRIMARY KEY NOT NULL REFERENCES missions (mission_id),
    graph_revision INTEGER NOT NULL CHECK (graph_revision >= 0),
    state_digest   TEXT NOT NULL,
    budget_json    TEXT NOT NULL,
    owner_token    TEXT NOT NULL,
    lease_until    TEXT NOT NULL,
    written_at     TEXT NOT NULL
) STRICT;
"#;

/// v3 — Phase-04.
///
/// إعادة بناء جدول الأدلّة مقصودة: قيد `CHECK` في SQLite لا يُعدَّل في مكانه،
/// وإضافة نوع دليل جديد دون تعديل القيد تعني إمّا رفض الكتابة وقت التشغيل وإمّا
/// إسقاط القيد كلّه. الأول عيب، والثاني إضعاف. فالجدول يُعاد بناؤه بالقيد الجديد
/// وتُنقل كل صفوفه كما هي.
const V3: &str = r#"
CREATE TABLE evidence_v3 (
    evidence_id      TEXT PRIMARY KEY NOT NULL,
    mission_id       TEXT NOT NULL REFERENCES missions (mission_id),
    evidence_type    TEXT NOT NULL CHECK (evidence_type IN ('USER_CONFIRMATION','RUNTIME_MEASUREMENT','TEST_RESULT','TOOL_RESULT','ARTIFACT','SOURCE_DOCUMENT','PROJECT_CONTEXT','PROVIDER_RESPONSE','POLICY_DECISION','AUDIT_EVENT','COMPLETION_PROOF','AGENT_OUTPUT')),
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
INSERT INTO evidence_v3 SELECT * FROM evidence;
DROP TABLE evidence;
ALTER TABLE evidence_v3 RENAME TO evidence;
CREATE INDEX evidence_by_mission ON evidence (mission_id, created_at);

CREATE TABLE skill_state (
    skill_id   TEXT PRIMARY KEY NOT NULL,
    enabled    INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE mcp_servers (
    server_id           TEXT PRIMARY KEY NOT NULL,
    name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    -- الحلقة المحلية وحدها. القيد هنا حارس ثانٍ فوق تحقق المضيف، لا بديل عنه.
    endpoint            TEXT NOT NULL CHECK (length(endpoint) <= 300 AND (endpoint LIKE 'http://127.0.0.1%' OR endpoint LIKE 'http://localhost%' OR endpoint LIKE 'http://[::1]%')),
    transport           TEXT NOT NULL CHECK (transport IN ('LOOPBACK_HTTP')),
    state               TEXT NOT NULL CHECK (state IN ('REGISTERED','ENABLED','DISABLED','UNREACHABLE')),
    granted_effects     TEXT NOT NULL,
    tool_count          INTEGER NOT NULL CHECK (tool_count >= 0),
    rejected_tool_count INTEGER NOT NULL CHECK (rejected_tool_count >= 0),
    last_error          TEXT NULL,
    last_refresh_at     TEXT NULL,
    registered_at       TEXT NOT NULL
) STRICT;

CREATE TABLE mcp_tools (
    tool_id        TEXT PRIMARY KEY NOT NULL,
    server_id      TEXT NOT NULL REFERENCES mcp_servers (server_id),
    declared_name  TEXT NOT NULL CHECK (length(declared_name) BETWEEN 1 AND 64),
    descriptor_json TEXT NOT NULL,
    input_schema   TEXT NOT NULL CHECK (length(input_schema) <= 16384),
    schema_digest  TEXT NOT NULL,
    discovered_at  TEXT NOT NULL
) STRICT;
CREATE INDEX mcp_tools_by_server ON mcp_tools (server_id);

CREATE TABLE tool_invocations (
    invocation_id    TEXT PRIMARY KEY NOT NULL,
    mission_id       TEXT NOT NULL,
    task_id          TEXT NOT NULL,
    agent_id         TEXT NOT NULL,
    skill_id         TEXT NOT NULL,
    tool_id          TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('SUCCEEDED','FAILED','DENIED','TIMED_OUT','CANCELLED','AWAITING_APPROVAL')),
    denial_reason    TEXT NULL,
    effects_json     TEXT NOT NULL,
    arguments_digest TEXT NOT NULL,
    result_digest    TEXT NULL,
    evidence_id      TEXT NULL,
    approval_id      TEXT NULL,
    summary          TEXT NOT NULL CHECK (length(summary) <= 4000),
    started_at       TEXT NOT NULL,
    duration_ms      INTEGER NOT NULL CHECK (duration_ms >= 0)
) STRICT;
CREATE INDEX tool_invocations_by_mission ON tool_invocations (mission_id, started_at);

CREATE TABLE tool_approvals (
    approval_id       TEXT PRIMARY KEY NOT NULL,
    mission_id        TEXT NOT NULL,
    task_id           TEXT NOT NULL,
    tool_id           TEXT NOT NULL,
    skill_id          TEXT NOT NULL,
    arguments_digest  TEXT NOT NULL,
    effects_json      TEXT NOT NULL,
    binding_digest    TEXT NOT NULL,
    arguments_preview TEXT NOT NULL CHECK (length(arguments_preview) <= 2000),
    reason            TEXT NOT NULL CHECK (length(reason) <= 2000),
    status            TEXT NOT NULL CHECK (status IN ('PENDING','GRANTED','DENIED','EXPIRED','CONSUMED')),
    requested_at_ms   INTEGER NOT NULL CHECK (requested_at_ms >= 0),
    requested_at      TEXT NOT NULL,
    decided_at        TEXT NULL,
    expires_at_ms     INTEGER NOT NULL CHECK (expires_at_ms >= 0),
    expires_at        TEXT NOT NULL
) STRICT;
CREATE INDEX tool_approvals_by_mission ON tool_approvals (mission_id, requested_at);
"#;

/// Phase-05: الذاكرة، وجلسات المتصفّح، وجلسات التحكّم بسطح المكتب، والملخّص
/// الموثوق لطلب الموافقة. إضافة بحتة: لا جدول سابق يُعاد بناؤه، ولا صفّ يُحذف.
const V4: &str = r#"
ALTER TABLE tool_approvals ADD COLUMN context_json TEXT NULL CHECK (context_json IS NULL OR length(context_json) <= 4000);

CREATE TABLE memories (
    memory_id         TEXT PRIMARY KEY NOT NULL,
    memory_type       TEXT NOT NULL CHECK (memory_type IN ('WORKING','EPISODIC','SEMANTIC','PREFERENCE','PROJECT')),
    scope             TEXT NOT NULL CHECK (scope IN ('MISSION','PROJECT','USER','SYSTEM')),
    mission_id        TEXT NULL,
    project_id        TEXT NULL,
    subject           TEXT NOT NULL CHECK (length(subject) <= 120),
    content           TEXT NOT NULL CHECK (length(content) <= 2000),
    summary           TEXT NOT NULL CHECK (length(summary) <= 240),
    content_digest    TEXT NOT NULL,
    trust_class       TEXT NOT NULL CHECK (trust_class IN ('SYSTEM_GENERATED','MODEL_GENERATED','USER_DERIVED')),
    verification      TEXT NOT NULL CHECK (verification IN ('UNVERIFIED','EVIDENCE_LINKED','CONFLICTED')),
    taint_json        TEXT NOT NULL,
    provenance_json   TEXT NOT NULL,
    confidence_source TEXT NOT NULL CHECK (confidence_source IN ('RUNTIME_EVIDENCE','RUNTIME_OBSERVATION','MODEL_SELF_REPORT','USER_APPROVED_WRITE','NONE')),
    importance        INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
    status            TEXT NOT NULL CHECK (status IN ('ACTIVE','SUPERSEDED','EXPIRED','DELETED')),
    version           INTEGER NOT NULL CHECK (version >= 1),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    last_accessed_at  TEXT NULL,
    expires_at        TEXT NULL,
    expires_at_ms     INTEGER NULL,
    -- النطاق مربوط بمالكه: ذاكرة مهمّة بلا مهمّة، أو ذاكرة مشروع بلا مشروع، لا توجد.
    CHECK (scope <> 'MISSION' OR mission_id IS NOT NULL),
    CHECK (scope <> 'PROJECT' OR project_id IS NOT NULL),
    -- الحذف حقيقي: الصفّ المحذوف لا يحمل محتوى ولا موضوعًا ولا ملخّصًا.
    CHECK (status <> 'DELETED' OR (content = '' AND subject = '' AND summary = ''))
) STRICT;
CREATE INDEX memories_by_scope ON memories (scope, status, mission_id, project_id);
CREATE INDEX memories_by_subject ON memories (subject, status);

CREATE TABLE memory_sources (
    memory_id   TEXT NOT NULL REFERENCES memories (memory_id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('MISSION','TASK','CLAIM','EVIDENCE','TOOL_INVOCATION','AGENT','USER')),
    reference   TEXT NOT NULL CHECK (length(reference) <= 200),
    PRIMARY KEY (memory_id, source_kind, reference)
) STRICT;

CREATE TABLE memory_conflicts (
    conflict_id TEXT PRIMARY KEY NOT NULL,
    memory_a    TEXT NOT NULL,
    memory_b    TEXT NOT NULL,
    subject     TEXT NOT NULL CHECK (length(subject) <= 120),
    state       TEXT NOT NULL CHECK (state IN ('NO_CONFLICT','CONFLICT','SUPERSEDED_BY_VERIFIED_SOURCE','INSUFFICIENT_EVIDENCE')),
    detected_at TEXT NOT NULL
) STRICT;
CREATE INDEX memory_conflicts_by_memory ON memory_conflicts (memory_a, memory_b);

CREATE TABLE memory_access (
    access_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id   TEXT NOT NULL,
    mission_id  TEXT NULL,
    purpose     TEXT NOT NULL CHECK (purpose IN ('AGENT_CONTEXT','USER_VIEW')),
    accessed_at TEXT NOT NULL
);
CREATE INDEX memory_access_by_memory ON memory_access (memory_id);

CREATE TABLE memory_decisions (
    candidate_id   TEXT PRIMARY KEY NOT NULL,
    source         TEXT NOT NULL CHECK (source IN ('RUNTIME','AGENT')),
    proposed_type  TEXT NOT NULL,
    proposed_scope TEXT NOT NULL,
    mission_id     TEXT NULL,
    decision       TEXT NOT NULL CHECK (decision IN ('PROMOTED','REJECTED','DUPLICATE','COALESCED')),
    reason_code    TEXT NOT NULL,
    memory_id      TEXT NULL,
    -- بصمة المحتوى لا المحتوى: مرشّح رُفض لأنه يشبه سرًّا لا يُحفظ نصّه هنا.
    content_digest TEXT NOT NULL,
    decided_at     TEXT NOT NULL
) STRICT;
CREATE INDEX memory_decisions_by_mission ON memory_decisions (mission_id, decided_at);

CREATE TABLE browser_sessions (
    session_id       TEXT PRIMARY KEY NOT NULL,
    mission_id       TEXT NOT NULL,
    owner_agent_id   TEXT NOT NULL,
    state            TEXT NOT NULL CHECK (state IN ('CREATED','ACTIVE','WAITING','CLOSED','FAILED','CANCELLED')),
    current_origin   TEXT NULL CHECK (current_origin IS NULL OR length(current_origin) <= 300),
    current_url      TEXT NULL CHECK (current_url IS NULL OR length(current_url) <= 2048),
    current_title    TEXT NULL CHECK (current_title IS NULL OR length(current_title) <= 300),
    navigation_count INTEGER NOT NULL CHECK (navigation_count >= 0),
    action_count     INTEGER NOT NULL CHECK (action_count >= 0),
    download_count   INTEGER NOT NULL CHECK (download_count >= 0),
    upload_count     INTEGER NOT NULL CHECK (upload_count >= 0),
    created_at       TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    closed_reason    TEXT NULL
) STRICT;
CREATE INDEX browser_sessions_by_mission ON browser_sessions (mission_id, created_at);

CREATE TABLE browser_actions (
    action_id      TEXT PRIMARY KEY NOT NULL,
    session_id     TEXT NOT NULL REFERENCES browser_sessions (session_id),
    mission_id     TEXT NOT NULL,
    task_id        TEXT NOT NULL,
    action         TEXT NOT NULL CHECK (action IN ('NAVIGATE','READ','CLICK','TYPE','BACK','FORWARD','RELOAD','DOWNLOAD','UPLOAD')),
    target         TEXT NOT NULL CHECK (length(target) <= 600),
    status         TEXT NOT NULL CHECK (status IN ('EXECUTED','DENIED','FAILED','CANCELLED')),
    reason_code    TEXT NULL,
    url            TEXT NULL CHECK (url IS NULL OR length(url) <= 2048),
    http_status    INTEGER NULL,
    content_digest TEXT NULL,
    outcome        TEXT NOT NULL CHECK (outcome IN ('ACTION_EXECUTED','NOT_EXECUTED')),
    occurred_at    TEXT NOT NULL,
    duration_ms    INTEGER NOT NULL CHECK (duration_ms >= 0)
) STRICT;
CREATE INDEX browser_actions_by_session ON browser_actions (session_id, occurred_at);

CREATE TABLE browser_downloads (
    download_id   TEXT PRIMARY KEY NOT NULL,
    session_id    TEXT NOT NULL REFERENCES browser_sessions (session_id),
    mission_id    TEXT NOT NULL,
    source_url    TEXT NOT NULL CHECK (length(source_url) <= 2048),
    file_name     TEXT NOT NULL CHECK (length(file_name) <= 200),
    byte_count    INTEGER NOT NULL CHECK (byte_count >= 0),
    sha256        TEXT NOT NULL,
    content_type  TEXT NOT NULL CHECK (length(content_type) <= 200),
    executable    INTEGER NOT NULL CHECK (executable IN (0, 1)),
    trust         TEXT NOT NULL CHECK (trust IN ('UNTRUSTED_CONTENT')),
    downloaded_at TEXT NOT NULL
) STRICT;

CREATE TABLE computer_target_grants (
    grant_id      TEXT PRIMARY KEY NOT NULL,
    mission_id    TEXT NOT NULL,
    identity_json TEXT NOT NULL CHECK (length(identity_json) <= 4000),
    granted_at    TEXT NOT NULL,
    revoked_at    TEXT NULL
) STRICT;
CREATE INDEX computer_target_grants_by_mission ON computer_target_grants (mission_id);

CREATE TABLE computer_sessions (
    session_id     TEXT PRIMARY KEY NOT NULL,
    mission_id     TEXT NOT NULL,
    agent_id       TEXT NOT NULL,
    state          TEXT NOT NULL CHECK (state IN ('CREATED','ACTIVE','WAITING','CLOSED','FAILED','CANCELLED')),
    target_json    TEXT NULL CHECK (target_json IS NULL OR length(target_json) <= 4000),
    created_at     TEXT NOT NULL,
    last_action_at TEXT NULL,
    action_count   INTEGER NOT NULL CHECK (action_count >= 0),
    click_count    INTEGER NOT NULL CHECK (click_count >= 0),
    keyboard_count INTEGER NOT NULL CHECK (keyboard_count >= 0),
    capture_count  INTEGER NOT NULL CHECK (capture_count >= 0),
    closed_reason  TEXT NULL
) STRICT;
CREATE INDEX computer_sessions_by_mission ON computer_sessions (mission_id, created_at);

CREATE TABLE computer_actions (
    action_id          TEXT PRIMARY KEY NOT NULL,
    session_id         TEXT NOT NULL REFERENCES computer_sessions (session_id),
    mission_id         TEXT NOT NULL,
    task_id            TEXT NOT NULL,
    action             TEXT NOT NULL CHECK (action IN ('WINDOW_LIST','OBSERVE','FOCUS','POINTER_MOVE','CLICK','KEY','TYPE','SCROLL')),
    target             TEXT NOT NULL CHECK (length(target) <= 600),
    status             TEXT NOT NULL CHECK (status IN ('EXECUTED','DENIED','FAILED','CANCELLED')),
    reason_code        TEXT NULL,
    observation_digest TEXT NULL,
    occurred_at        TEXT NOT NULL,
    duration_ms        INTEGER NOT NULL CHECK (duration_ms >= 0)
) STRICT;
CREATE INDEX computer_actions_by_session ON computer_actions (session_id, occurred_at);

-- بصمات وأبعاد فقط. لا بكسلات: اللقطة نفسها لا تُكتب على القرص أبدًا.
CREATE TABLE computer_observations (
    observation_id TEXT PRIMARY KEY NOT NULL,
    session_id     TEXT NOT NULL REFERENCES computer_sessions (session_id),
    mission_id     TEXT NOT NULL,
    window_json    TEXT NOT NULL CHECK (length(window_json) <= 4000),
    width          INTEGER NOT NULL CHECK (width >= 0),
    height         INTEGER NOT NULL CHECK (height >= 0),
    frame_digest   TEXT NOT NULL,
    layout_digest  TEXT NOT NULL,
    element_count  INTEGER NOT NULL CHECK (element_count >= 0),
    capture_scope  TEXT NOT NULL CHECK (capture_scope IN ('WINDOW')),
    trust          TEXT NOT NULL CHECK (trust IN ('UNTRUSTED_CONTENT')),
    observed_at    TEXT NOT NULL
) STRICT;
CREATE INDEX computer_observations_by_session ON computer_observations (session_id, observed_at);
"#;

/// Phase-06: الموصلات، وحفظ الاستعمال والكلفة، والميزانيات، والرصد، وطبقات
/// الإعدادات. إضافة بحتة: لا جدول سابق يُعاد بناؤه، ولا صفّ يُحذف.
///
/// ما لا يُكتب هنا أبدًا: قيمة سرّ. الموصل يحمل مرجع سرّه، والقيمة في مخزن بيانات
/// الاعتماد وحده. ولا جسم استجابة خام: بصمته وملخّص محدود فقط.
const V5: &str = r#"
CREATE TABLE config_meta (
    meta_key   TEXT PRIMARY KEY NOT NULL,
    meta_value TEXT NOT NULL CHECK (length(meta_value) <= 200)
) STRICT;
INSERT INTO config_meta (meta_key, meta_value) VALUES ('config_schema_version', '1');

CREATE TABLE config_values (
    layer       TEXT NOT NULL CHECK (layer IN ('USER', 'PROJECT', 'MISSION', 'SECURITY')),
    scope_id    TEXT NOT NULL CHECK (length(scope_id) <= 64),
    setting_key TEXT NOT NULL CHECK (length(setting_key) BETWEEN 3 AND 120),
    value_json  TEXT NOT NULL CHECK (length(value_json) <= 4000),
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (layer, scope_id, setting_key),
    CHECK ((layer IN ('USER', 'SECURITY') AND scope_id = '') OR (layer IN ('PROJECT', 'MISSION') AND length(scope_id) = 36))
) STRICT;

CREATE TABLE connectors (
    connector_id          TEXT PRIMARY KEY NOT NULL,
    provider              TEXT NOT NULL CHECK (provider IN ('polaris.rest', 'polaris.workspace')),
    category              TEXT NOT NULL CHECK (category IN ('EMAIL', 'CALENDAR', 'FILES', 'MESSAGING', 'PROJECT_MANAGEMENT', 'CODE_HOSTING', 'DATABASE', 'CUSTOM_API')),
    display_name          TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
    version               TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
    enabled               INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    auth_mode             TEXT NOT NULL CHECK (auth_mode IN ('NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC', 'OAUTH2')),
    config_json           TEXT NOT NULL CHECK (length(config_json) <= 16000),
    provenance_json       TEXT NOT NULL CHECK (length(provenance_json) <= 4000),
    credential_updated_at TEXT NULL,
    registered_at         TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    last_activity_at      TEXT NULL
) STRICT;

CREATE TABLE connector_operations (
    connector_id    TEXT NOT NULL REFERENCES connectors (connector_id) ON DELETE CASCADE,
    operation_id    TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 64),
    action          TEXT NOT NULL CHECK (action IN ('READ', 'WRITE', 'DELETE', 'SEND', 'PUBLISH', 'CREATE_EXTERNAL_RESOURCE', 'MODIFY_EXTERNAL_RESOURCE')),
    definition_json TEXT NOT NULL CHECK (length(definition_json) <= 16000),
    PRIMARY KEY (connector_id, operation_id)
) STRICT;

-- اقتراحات استيراد OpenAPI: تُعرض وتُراجع، ولا يُسجَّل منها إلا ما وافق عليه المستخدم.
CREATE TABLE connector_imports (
    import_id      TEXT PRIMARY KEY NOT NULL,
    spec_digest    TEXT NOT NULL,
    title          TEXT NOT NULL CHECK (length(title) <= 200),
    proposals_json TEXT NOT NULL CHECK (length(proposals_json) <= 64000),
    rejected_json  TEXT NOT NULL CHECK (length(rejected_json) <= 16000),
    status         TEXT NOT NULL CHECK (status IN ('PROPOSED', 'APPROVED', 'DISCARDED')),
    connector_id   TEXT NULL,
    created_at     TEXT NOT NULL,
    decided_at     TEXT NULL
) STRICT;

CREATE TABLE connector_invocations (
    invocation_id TEXT PRIMARY KEY NOT NULL,
    connector_id  TEXT NOT NULL,
    operation_id  TEXT NOT NULL,
    mission_id    TEXT NULL,
    task_id       TEXT NULL,
    action        TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED', 'DENIED', 'CANCELLED', 'REPLAYED', 'OUTCOME_UNKNOWN')),
    attempts      INTEGER NOT NULL CHECK (attempts >= 0 AND attempts <= 10),
    http_status   INTEGER NULL,
    reason_code   TEXT NULL,
    result_digest TEXT NULL,
    resource_refs TEXT NOT NULL CHECK (length(resource_refs) <= 2000),
    summary       TEXT NOT NULL CHECK (length(summary) <= 1200),
    latency_ms    INTEGER NOT NULL CHECK (latency_ms >= 0),
    started_at    TEXT NOT NULL
) STRICT;
CREATE INDEX connector_invocations_by_connector ON connector_invocations (connector_id, started_at);
CREATE INDEX connector_invocations_by_mission ON connector_invocations (mission_id, started_at);

-- حماية POLARIS نفسها من التكرار العرضي: المفتاح، وبصمة الحمولة، ونتيجتها.
CREATE TABLE connector_idempotency (
    connector_id    TEXT NOT NULL,
    operation_id    TEXT NOT NULL,
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
    payload_digest  TEXT NOT NULL,
    state           TEXT NOT NULL CHECK (state IN ('IN_FLIGHT', 'COMPLETED', 'OUTCOME_UNKNOWN', 'FAILED')),
    result_json     TEXT NULL CHECK (result_json IS NULL OR length(result_json) <= 8000),
    invocation_id   TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (connector_id, operation_id, idempotency_key)
) STRICT;

CREATE TABLE usage_records (
    record_id         TEXT PRIMARY KEY NOT NULL,
    recorded_at       TEXT NOT NULL,
    day               TEXT NOT NULL CHECK (length(day) = 10),
    category          TEXT NOT NULL CHECK (category IN ('MODEL', 'TOOL', 'BROWSER', 'COMPUTER', 'CONNECTOR')),
    subject_id        TEXT NOT NULL,
    mission_id        TEXT NULL,
    project_id        TEXT NULL,
    provider_id       TEXT NULL,
    model_id          TEXT NULL,
    connector_id      TEXT NULL,
    tool_id           TEXT NULL,
    input_tokens      INTEGER NULL CHECK (input_tokens IS NULL OR input_tokens >= 0),
    output_tokens     INTEGER NULL CHECK (output_tokens IS NULL OR output_tokens >= 0),
    cached_tokens     INTEGER NULL CHECK (cached_tokens IS NULL OR cached_tokens >= 0),
    token_provenance  TEXT NOT NULL CHECK (token_provenance IN ('PROVIDER_REPORTED', 'LOCALLY_MEASURED', 'ESTIMATED', 'UNKNOWN')),
    wall_ms           INTEGER NOT NULL CHECK (wall_ms >= 0),
    external_requests INTEGER NOT NULL CHECK (external_requests >= 0),
    cost_micros       INTEGER NULL CHECK (cost_micros IS NULL OR cost_micros >= 0),
    currency          TEXT NULL CHECK (currency IS NULL OR length(currency) = 3),
    cost_provenance   TEXT NOT NULL CHECK (cost_provenance IN ('PROVIDER_REPORTED', 'LOCALLY_MEASURED', 'ESTIMATED', 'UNKNOWN')),
    pricing_source    TEXT NULL CHECK (pricing_source IS NULL OR length(pricing_source) <= 200),
    -- قيمة بلا مصدر تسعير ليست كلفة: المقدَّرة تحتاج مصدرًا، والمجهولة لا تحمل مبلغًا.
    CHECK (cost_provenance <> 'UNKNOWN' OR cost_micros IS NULL),
    CHECK (cost_provenance <> 'ESTIMATED' OR pricing_source IS NOT NULL),
    CHECK ((cost_micros IS NULL) = (currency IS NULL))
) STRICT;
CREATE INDEX usage_by_day ON usage_records (day, category);
CREATE INDEX usage_by_mission ON usage_records (mission_id);
CREATE INDEX usage_by_project ON usage_records (project_id);

CREATE TABLE pricing_entries (
    pricing_id    TEXT PRIMARY KEY NOT NULL,
    target_kind   TEXT NOT NULL CHECK (target_kind IN ('MODEL', 'CONNECTOR')),
    target_id     TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 200),
    unit          TEXT NOT NULL CHECK (unit IN ('PER_MILLION_INPUT_TOKENS', 'PER_MILLION_OUTPUT_TOKENS', 'PER_CALL')),
    amount_micros INTEGER NOT NULL CHECK (amount_micros >= 0 AND amount_micros <= 1000000000000),
    currency      TEXT NOT NULL CHECK (length(currency) = 3),
    source_note   TEXT NOT NULL CHECK (length(source_note) BETWEEN 1 AND 200),
    created_at    TEXT NOT NULL,
    UNIQUE (target_kind, target_id, unit)
) STRICT;

CREATE TABLE budgets (
    budget_id      TEXT PRIMARY KEY NOT NULL,
    scope          TEXT NOT NULL CHECK (scope IN ('MISSION', 'PROJECT', 'DAY', 'PROVIDER', 'CONNECTOR')),
    scope_key      TEXT NOT NULL CHECK (length(scope_key) <= 200),
    dimension      TEXT NOT NULL CHECK (dimension IN ('COST_MICROS', 'MODEL_TOKENS', 'EXTERNAL_CALLS')),
    limit_value    INTEGER NOT NULL CHECK (limit_value >= 0),
    currency       TEXT NULL CHECK (currency IS NULL OR length(currency) = 3),
    mode           TEXT NOT NULL CHECK (mode IN ('SOFT', 'HARD')),
    warn_ratio_pct INTEGER NOT NULL CHECK (warn_ratio_pct BETWEEN 1 AND 100),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    UNIQUE (scope, scope_key, dimension),
    CHECK ((dimension = 'COST_MICROS') = (currency IS NOT NULL))
) STRICT;

-- أحداث الرصد المهيكلة. محدودة العدد: تُقصّ بعد الكتابة، ولا نصّ حرّ فيها.
CREATE TABLE obs_events (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    TEXT NOT NULL UNIQUE,
    occurred_at TEXT NOT NULL,
    component   TEXT NOT NULL CHECK (length(component) <= 40),
    category    TEXT NOT NULL CHECK (length(category) <= 40),
    severity    TEXT NOT NULL CHECK (severity IN ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    mission_id  TEXT NULL,
    task_id     TEXT NULL,
    agent_id    TEXT NULL,
    operation   TEXT NOT NULL CHECK (length(operation) <= 120),
    result      TEXT NOT NULL CHECK (length(result) <= 40),
    duration_ms INTEGER NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
    reason_code TEXT NULL CHECK (reason_code IS NULL OR length(reason_code) <= 80),
    provenance  TEXT NOT NULL CHECK (provenance IN ('LOCALLY_MEASURED', 'PROVIDER_REPORTED', 'CONNECTOR_REPORTED'))
) STRICT;
CREATE INDEX obs_events_by_time ON obs_events (occurred_at);

CREATE TABLE obs_alerts (
    alert_id    TEXT PRIMARY KEY NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('BUDGET_NEAR_LIMIT', 'BUDGET_EXCEEDED', 'PROVIDER_UNHEALTHY', 'CONNECTOR_UNHEALTHY', 'ERROR_SPIKE', 'STORAGE_ISSUE')),
    severity    TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    subject     TEXT NOT NULL CHECK (length(subject) <= 200),
    reason_code TEXT NOT NULL CHECK (length(reason_code) <= 80),
    first_at    TEXT NOT NULL,
    last_at     TEXT NOT NULL,
    occurrences INTEGER NOT NULL CHECK (occurrences >= 1),
    state       TEXT NOT NULL CHECK (state IN ('OPEN', 'RESOLVED')),
    UNIQUE (kind, subject)
) STRICT;
"#;

const MIGRATIONS: &[(i64, &str)] = &[(1, V1), (2, V2), (3, V3), (4, V4), (5, V5), (6, super::schema_v6::V6), (7, super::schema_v7::V7), (8, super::schema_v8::V8), (9, super::schema_v9::V9), (10, super::schema_v10::V10), (11, super::schema_v11::V11), (12, super::schema_v12::V12), (13, super::schema_v13::V13), (14, super::schema_v14::V14), (15, super::schema_v15::V15), (16, super::schema_v16::V16), (17, super::schema_v17::V17), (18, super::schema_v18::V18), (19, super::schema_v19::V19), (20, super::schema_v20::V20), (21, super::schema_v21::V21), (22, super::schema_v22::V22), (23, super::schema_v23::V23), (24, super::schema_v24::V24), (25, super::schema_v25::V25)];

pub fn current_version(conn: &Connection) -> Result<i64, StorageError> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

pub fn apply(conn: &mut Connection) -> Result<(), StorageError> {
    apply_up_to(conn, SUPPORTED_VERSION)
}

/// يرحّل حتى إصدار بعينه لا بعده. Phase-07 يحتاجه لبناء مخطط مرجعي لإصدار أقدم
/// (بصمة المخطط) ولإنشاء قواعد قديمة حقيقية في اختبارات الترقية؛ المنتج يستعمل `apply`.
pub fn apply_up_to(conn: &mut Connection, target: i64) -> Result<(), StorageError> {
    let found = current_version(conn)?;
    if found > SUPPORTED_VERSION {
        return Err(StorageError::SchemaTooNew { found, supported: SUPPORTED_VERSION });
    }
    if !(0..=SUPPORTED_VERSION).contains(&target) {
        return Err(StorageError::Invalid(format!("migration target {target} is outside 0..={SUPPORTED_VERSION}")));
    }
    // R-45: إجراء SQLite الموثّق لتغيير مخطط جدول («Making Other Kinds Of Table Schema Changes»): المفاتيح الأجنبية تُوقف خارج
    // المعاملة (داخلها لا أثر للأمر)، ثم `foreign_key_check` قبل الالتزام، ثم تعود كما كانت. إعادة بناء جدول أبٍ والمفاتيح مفعّلة
    // تُعدّ حذفه انتهاكًا لكل صفّ تابع، فيفشل ترحيل قاعدة فيها بيانات حقيقية.
    let enforced: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).map_err(|e| StorageError::Migration(e.to_string()))?;
    if enforced == 1 {
        conn.pragma_update(None, "foreign_keys", "OFF").map_err(|e| StorageError::Migration(e.to_string()))?;
    }
    let result = MIGRATIONS.iter().filter(|(v, _)| *v > found && *v <= target).try_for_each(|(version, sql)| {
        let tx = conn.transaction().map_err(|e| StorageError::Migration(e.to_string()))?;
        tx.execute_batch(sql).map_err(|e| StorageError::Migration(format!("v{version}: {e}")))?;
        let broken: i64 = tx.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).map_err(|e| StorageError::Migration(e.to_string()))?;
        if broken > 0 {
            return Err(StorageError::Migration(format!("v{version}: {broken} rows would break a foreign key")));
        }
        tx.pragma_update(None, "user_version", version)
            .map_err(|e| StorageError::Migration(e.to_string()))?;
        tx.commit().map_err(|e| StorageError::Migration(e.to_string()))
    });
    if enforced == 1 {
        conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| StorageError::Migration(e.to_string()))?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_ordered_and_end_at_the_supported_version() {
        let versions: Vec<i64> = MIGRATIONS.iter().map(|(v, _)| *v).collect();
        let mut sorted = versions.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(versions, sorted);
        assert_eq!(*versions.last().unwrap(), SUPPORTED_VERSION);
    }

    /// R-45 (كشفته تجربة الهجرة على نسخة من قاعدة المالك v16، 2026-10-14): v17 يعيد بناء `tasks` و`evidence`، وحذف الجدول القديم
    /// والمفاتيح الأجنبية مفعّلة يُعدّ انتهاكًا مؤجَّلًا لكل صفّ في `task_dependencies` و`claim_evidence`، فيفشل الترحيل كله
    /// («FOREIGN KEY constraint failed»). الاختبارات السابقة رحّلت قاعدة بلا هذه الصفوف.
    #[test]
    fn a_v16_database_with_dependent_rows_upgrades_and_keeps_every_link() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        apply_up_to(&mut conn, 16).unwrap();
        conn.execute_batch(
            "INSERT INTO missions VALUES ('m1', NULL, 't', 'DIRECT_USER_INSTRUCTION', 'o', 'USER', 'SINGLE_AGENT', 'NORMAL', 'COMPLETED', 'NOT_EVALUATED', 1, 't1', '{}', NULL, NULL, 't', NULL, NULL, 1);
             INSERT INTO tasks VALUES ('t1', 'm1', NULL, 'a', 'o', 'PLAN', 'SUCCEEDED', NULL, 0, 2, NULL, 1, 0, 1);
             INSERT INTO tasks VALUES ('t2', 'm1', NULL, 'b', 'o', 'BUILD', 'SUCCEEDED', NULL, 0, 2, NULL, 1, 1, 1);
             INSERT INTO task_dependencies VALUES ('m1', 't2', 't1', 'REQUIRES_SUCCESS');
             INSERT INTO evidence VALUES ('e1', 'm1', 'AGENT_OUTPUT', 'd', 'p', 'MODEL_GENERATED', 'MISSION_OBJECTIVE', '[]', 'INFERRED', '{}', 's', 't');
             INSERT INTO claims VALUES ('c1', 'm1', 't1', 'a1', 's', 'FACT', 'UNVERIFIED', NULL, NULL, NULL, '{}', 1, 1, 't');
             INSERT INTO claim_evidence VALUES ('c1', 'e1', 'SUPPORTS');",
        )
        .unwrap();
        apply(&mut conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), SUPPORTED_VERSION);
        let links: i64 = conn.query_row("SELECT (SELECT count(*) FROM task_dependencies) + (SELECT count(*) FROM claim_evidence)", [], |r| r.get(0)).unwrap();
        assert_eq!(links, 2, "a dependent row was lost");
        let violations: i64 = conn.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
        assert_eq!(violations, 0);
        let on: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(on, 1, "the migration left foreign keys switched off");
    }

    #[test]
    fn a_failed_migration_leaves_no_partial_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE projects (x INTEGER);").unwrap();
        assert!(apply(&mut conn).is_err());
        assert_eq!(current_version(&conn).unwrap(), 0);
        let tables: i64 = conn
            .query_row("SELECT count(*) FROM sqlite_master WHERE name = 'context_sources'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tables, 0, "a partial migration was committed");
    }

    #[test]
    fn an_existing_v1_database_upgrades_to_the_supported_version_without_losing_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        // نُطبّق v1 وحدها، ثم نكتب صفًّا، ثم نُكمل الترحيل إلى ما يفهمه هذا البناء.
        // الرقم لا يُثبَّت: الادعاء المقيس هو أن صفَّ v1 ينجو كل الترحيلات، وتثبيت
        // «2» كان يجعل ترحيلًا لاحقًا يكسر اختبارًا سليمًا بلا تغيّر في ادعائه.
        conn.execute_batch(V1).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute(
            "INSERT INTO projects VALUES ('p1', 'kept', '', 'ACTIVE', 'en', NULL, NULL, 'LOCAL_ONLY', 1, 't', 't')",
            [],
        )
        .unwrap();
        apply(&mut conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), SUPPORTED_VERSION);
        let name: String = conn.query_row("SELECT name FROM projects WHERE project_id = 'p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "kept", "a v1 row was lost across the migrations");
        // جداول Phase-03 موجودة، وجداول Phase-04 كذلك.
        for table in [
            "missions",
            "tasks",
            "task_dependencies",
            "claims",
            "evidence",
            "agent_instances",
            "skill_state",
            "mcp_servers",
            "mcp_tools",
            "tool_invocations",
            "tool_approvals",
        ] {
            let found: i64 = conn
                .query_row("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |r| r.get(0))
                .unwrap();
            assert_eq!(found, 1, "{table} is missing after the migrations");
        }
    }

    #[test]
    fn the_v4_schema_refuses_a_deleted_memory_that_still_holds_content_and_unscoped_memory() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply(&mut conn).unwrap();
        let insert = |id: &str, scope: &str, mission: Option<&str>, subject: &str, content: &str, status: &str| {
            conn.execute(
                "INSERT INTO memories (memory_id, memory_type, scope, mission_id, project_id, subject, content, summary, content_digest,
                    trust_class, verification, taint_json, provenance_json, confidence_source, importance, status, version, created_at, updated_at)
                 VALUES (?1, 'SEMANTIC', ?2, ?3, NULL, ?4, ?5, ?4, 'd', 'MODEL_GENERATED', 'UNVERIFIED', '{}', '{}', 'NONE', 3, ?6, 1, 't', 't')",
                rusqlite::params![id, scope, mission, subject, content, status],
            )
        };
        assert!(insert("a", "MISSION", Some("m1"), "s", "c", "ACTIVE").is_ok());
        // محذوف ما زال يحمل نصًّا: المخطط نفسه يرفضه، لا الشيفرة وحدها.
        assert!(insert("b", "MISSION", Some("m1"), "s", "leftover", "DELETED").is_err(), "a deleted row kept its content");
        assert!(insert("c", "MISSION", Some("m1"), "", "", "DELETED").is_ok());
        // ذاكرة مهمّة بلا مهمّة لا توجد.
        assert!(insert("d", "MISSION", None, "s", "c", "ACTIVE").is_err(), "a mission memory without a mission was stored");
        // ولا مستوى ثقة خارج المفردات المغلقة، ولا «محقَّق».
        let trusted = conn.execute(
            "INSERT INTO memories (memory_id, memory_type, scope, mission_id, project_id, subject, content, summary, content_digest,
                trust_class, verification, taint_json, provenance_json, confidence_source, importance, status, version, created_at, updated_at)
             VALUES ('e', 'SEMANTIC', 'SYSTEM', NULL, NULL, 's', 'c', 's', 'd', 'MODEL_GENERATED', 'VERIFIED', '{}', '{}', 'NONE', 3, 'ACTIVE', 1, 't', 't')",
            [],
        );
        assert!(trusted.is_err(), "a memory was stored as VERIFIED");
    }

    #[test]
    fn the_v3_migration_keeps_every_evidence_row_and_widens_only_the_type_constraint() {
        let mut conn = Connection::open_in_memory().unwrap();
        // v1 ثم v2 وحدهما، وصفّ دليل من مفردات Phase-03، ثم v3.
        conn.execute_batch(V1).unwrap();
        conn.execute_batch(V2).unwrap();
        conn.pragma_update(None, "user_version", 2).unwrap();
        conn.execute(
            "INSERT INTO missions VALUES ('m1', NULL, 't', 'DIRECT_USER_INSTRUCTION', 'o', 'USER', 'SINGLE_AGENT', 'NORMAL', 'RUNNING', 'NOT_PROVEN', 1, NULL, '{}', NULL, NULL, 't', NULL, NULL, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO evidence VALUES ('e1','m1','TEST_RESULT','d','p','TRUSTED_RUNTIME_FACT','probe:x','[]','MEASURED','{}','kept','t')",
            [],
        )
        .unwrap();
        apply(&mut conn).unwrap();
        let summary: String = conn.query_row("SELECT summary FROM evidence WHERE evidence_id = 'e1'", [], |r| r.get(0)).unwrap();
        assert_eq!(summary, "kept", "an evidence row was lost when the table was rebuilt");
        // النوع الجديد مقبول الآن.
        conn.execute(
            "INSERT INTO evidence VALUES ('e2','m1','TOOL_RESULT','d','polaris.tool/x','TRUSTED_RUNTIME_FACT','tool:x','[]','MEASURED','{}','new','t')",
            [],
        )
        .unwrap();
        // والقيد ما زال مغلقًا: نوع غير مُعلن يُرفض على مستوى المخطط.
        let invented = conn.execute(
            "INSERT INTO evidence VALUES ('e3','m1','WHATEVER','d','p','TRUSTED_RUNTIME_FACT','x','[]','MEASURED','{}','s','t')",
            [],
        );
        assert!(invented.is_err(), "the rebuilt table accepted an unknown evidence type");
    }

    #[test]
    fn phase03_check_constraints_refuse_unknown_vocabulary() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply(&mut conn).unwrap();
        let insert = |state: &str, proof: &str| {
            conn.execute(
                "INSERT INTO missions VALUES ('m1', NULL, 'title', 'DIRECT_USER_INSTRUCTION', 'obj', 'USER', 'SINGLE_AGENT', 'NORMAL', ?1, ?2, 1, NULL, '{}', NULL, NULL, 't', NULL, NULL, 1)",
                [state, proof],
            )
        };
        assert!(insert("NOT_A_STATE", "NOT_PROVEN").is_err(), "an unknown mission state was stored");
        assert!(insert("RUNNING", "MAYBE").is_err(), "an unknown proof status was stored");
        assert!(insert("RUNNING", "NOT_PROVEN").is_ok());
        // تبعية ذاتية مرفوضة على مستوى المخطط أيضًا، لا في الكود وحده.
        conn.execute(
            "INSERT INTO tasks VALUES ('t1','m1',NULL,'t','o','BUILD','PENDING',NULL,0,1,NULL,1,0,1)",
            [],
        )
        .unwrap();
        let self_dep = conn.execute("INSERT INTO task_dependencies VALUES ('m1','t1','t1','REQUIRES_SUCCESS')", []);
        assert!(self_dep.is_err(), "a self dependency was stored");
    }

    #[test]
    fn an_agent_message_cannot_store_command_authority() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO missions VALUES ('m1', NULL, 't', 'DIRECT_USER_INSTRUCTION', 'o', 'USER', 'SINGLE_AGENT', 'NORMAL', 'RUNNING', 'NOT_PROVEN', 1, NULL, '{}', NULL, NULL, 't', NULL, NULL, 1)",
            [],
        )
        .unwrap();
        let escalated = conn.execute(
            "INSERT INTO agent_messages VALUES ('msg1','m1','a','AGENT','b','QUESTION',NULL,NULL,'p','{}','DIRECT_USER_INSTRUCTION','t')",
            [],
        );
        assert!(escalated.is_err(), "an agent message stored user authority");
    }

    #[test]
    fn v12_keeps_every_setting_and_admits_the_search_server_key_only() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_up_to(&mut conn, 11).unwrap();
        conn.execute("INSERT INTO p08_settings VALUES ('voice.transcription_model', '\"base\"', 't')", []).unwrap();
        assert!(conn.execute("INSERT INTO p08_settings VALUES ('web.search_endpoint', '\"x\"', 't')", []).is_err(), "v11 already admitted the key");
        apply(&mut conn).unwrap();
        let kept: String = conn.query_row("SELECT value_json FROM p08_settings WHERE setting_key = 'voice.transcription_model'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, "\"base\"", "a setting was lost in the rebuild");
        assert!(conn.execute("INSERT INTO p08_settings VALUES ('web.search_endpoint', '\"http://127.0.0.1:8888\"', 't')", []).is_ok());
        assert!(conn.execute("INSERT INTO p08_settings VALUES ('agent.authority', '\"ALL\"', 't')", []).is_err(), "an unknown key was stored");
    }

    #[test]
    fn v21_keeps_every_mcp_server_and_its_tools_and_ties_the_transport_to_its_address() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_up_to(&mut conn, 20).unwrap();
        conn.execute("INSERT INTO mcp_servers (server_id, name, endpoint, transport, state, granted_effects, tool_count, rejected_tool_count, registered_at) VALUES ('s1', 'local', 'http://127.0.0.1:4200/mcp', 'LOOPBACK_HTTP', 'ENABLED', '[]', 1, 0, 't')", []).unwrap();
        let tools: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('mcp_tools')").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert!(tools.contains(&"server_id".to_string()));
        apply(&mut conn).unwrap();
        let kept: (String, String) = conn.query_row("SELECT endpoint, transport FROM mcp_servers WHERE server_id = 's1'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(kept, ("http://127.0.0.1:4200/mcp".to_string(), "LOOPBACK_HTTP".to_string()), "a server row changed in the migration");
        let insert = |id: &str, endpoint: &str, transport: &str| conn.execute("INSERT INTO mcp_servers (server_id, name, endpoint, transport, state, granted_effects, tool_count, rejected_tool_count, registered_at) VALUES (?1, 'n', ?2, ?3, 'ENABLED', '[]', 0, 0, 't')", rusqlite::params![id, endpoint, transport]);
        assert!(insert("s2", "https://learn.microsoft.com/api/mcp", "REMOTE_HTTPS").is_ok());
        assert!(insert("s3", "http://example.com/mcp", "REMOTE_HTTPS").is_err(), "a plain-http remote server was stored");
        assert!(insert("s4", "https://example.com/mcp", "LOOPBACK_HTTP").is_err(), "a remote address was stored as loopback");
        assert!(insert("s5", "http://127.0.0.1:1/mcp", "STDIO").is_err(), "an unknown transport was stored");
    }

    #[test]
    fn v20_keeps_every_attachment_and_bounds_the_inspection_columns() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_up_to(&mut conn, 19).unwrap();
        let id = "00000000-0000-4000-8000-000000000001";
        conn.execute("INSERT INTO p08_attachments (attachment_id, mission_id, staging_id, file_name, workspace_ref, file_kind, size_bytes, sha256, classification, imported_at) VALUES (?1, NULL, ?1, 'a.txt', 'staging/a.txt', 'TEXT', 1, ?2, 'USER_PROVIDED_UNTRUSTED', 't')", rusqlite::params![id, "a".repeat(64)]).unwrap();
        apply(&mut conn).unwrap();
        let kept: (String, Option<String>) = conn.query_row("SELECT file_name, family FROM p08_attachments WHERE attachment_id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(kept, ("a.txt".to_string(), None), "an attachment row changed in the migration");
        assert!(conn.execute("UPDATE p08_attachments SET family = 'IMAGE', mime_type = 'image/png', content_check = 'MATCHED', model_access = 'IMAGE_INPUT'", []).is_ok());
        assert!(conn.execute("UPDATE p08_attachments SET family = 'EXECUTABLE'", []).is_err(), "an unknown family was stored");
        assert!(conn.execute("UPDATE p08_attachments SET model_access = 'RUN'", []).is_err(), "an unknown access was stored");
    }

    #[test]
    fn v19_keeps_every_setting_admits_the_new_keys_and_bounds_ratings_and_notes() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_up_to(&mut conn, 18).unwrap();
        conn.execute("INSERT INTO p08_settings VALUES ('profile.nickname', '\"Doshi\"', 't')", []).unwrap();
        assert!(conn.execute("INSERT INTO p08_settings VALUES ('web.search_provider', '\"BRAVE\"', 't')", []).is_err(), "v18 already admitted the key");
        apply(&mut conn).unwrap();
        let kept: String = conn.query_row("SELECT value_json FROM p08_settings WHERE setting_key = 'profile.nickname'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, "\"Doshi\"", "a setting was lost in the rebuild");
        for key in ["web.search_provider", "notifications.enabled", "notifications.sound"] {
            assert!(conn.execute("INSERT INTO p08_settings VALUES (?1, 'true', 't')", [key]).is_ok(), "{key} was refused");
        }
        assert!(conn.execute("INSERT INTO p08_settings VALUES ('web.search_api_key', '\"secret\"', 't')", []).is_err(), "a key name for a secret was admitted");
        conn.execute("INSERT INTO missions (mission_id, title, title_authority, objective, origin, execution_mode, priority, state, completion_proof_status, current_revision, budget_json, created_at, version) VALUES ('m', 't', 'USER', 'o', 'USER', 'SINGLE_AGENT', 'NORMAL', 'COMPLETED', 'NOT_EVALUATED', 1, '{}', 't', 1)", []).unwrap();
        assert!(conn.execute("INSERT INTO p08_mission_ratings VALUES ('m', 6, 't')", []).is_err(), "a rating above 5 was stored");
        assert!(conn.execute("INSERT INTO p08_mission_ratings VALUES ('m', 4, 't')", []).is_ok());
        assert!(conn.execute("INSERT INTO p08_turn_notes VALUES ('n1', 'm', 1, 'hello', 'DELIVERED', 't', NULL)", []).is_err(), "a delivered note without a time was stored");
        assert!(conn.execute("INSERT INTO p08_turn_notes VALUES ('n1', 'm', 1, 'hello', 'QUEUED', 't', NULL)", []).is_ok());
        assert!(conn.execute("INSERT INTO p08_turn_notes VALUES ('n2', 'm', 1, 'again', 'QUEUED', 't', NULL)", []).is_err(), "two notes took the same place in the order");
    }

    #[test]
    fn v15_keeps_every_setting_and_admits_the_profile_keys_and_longer_values_only() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_up_to(&mut conn, 14).unwrap();
        conn.execute("INSERT INTO p08_settings VALUES ('web.search_endpoint', '\"http://127.0.0.1:8888\"', 't')", []).unwrap();
        assert!(conn.execute("INSERT INTO p08_settings VALUES ('profile.nickname', '\"x\"', 't')", []).is_err(), "v14 already admitted the key");
        apply(&mut conn).unwrap();
        let kept: String = conn.query_row("SELECT value_json FROM p08_settings WHERE setting_key = 'web.search_endpoint'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, "\"http://127.0.0.1:8888\"", "a setting was lost in the rebuild");
        let long = format!("\"{}\"", "a".repeat(3_000));
        assert!(conn.execute("INSERT INTO p08_settings VALUES ('profile.instructions', ?1, 't')", [long]).is_ok());
        assert!(conn.execute("INSERT INTO p08_settings VALUES ('agent.authority', '\"ALL\"', 't')", []).is_err(), "an unknown key was stored");
    }

    #[test]
    fn v13_adds_custom_providers_with_shaped_ids_and_bounded_model_lists() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply(&mut conn).unwrap();
        let insert = |id: &str, models: &str| {
            conn.execute(
                "INSERT INTO provider_custom VALUES (?1, 'n', 'https://api.example.com/v1', ?2, 't', 't')",
                rusqlite::params![id, models],
            )
        };
        assert!(insert("my-gateway", "[]").is_ok());
        assert!(insert("Bad", "[]").is_err(), "an id outside the contract shape was stored");
        assert!(insert("1abc", "[]").is_err(), "an id starting with a digit was stored");
        assert!(insert("ok-two", "{}").is_err(), "a model list that is not an array was stored");
    }

    #[test]
    fn v14_keeps_every_conflict_and_admits_the_user_supersession_state_only() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_up_to(&mut conn, 13).unwrap();
        conn.execute("INSERT INTO memory_conflicts VALUES ('c1','a','b','s','CONFLICT','t')", []).unwrap();
        assert!(conn.execute("INSERT INTO memory_conflicts VALUES ('c2','a','b','s','SUPERSEDED_BY_USER','t')", []).is_err(), "v13 already admitted the state");
        apply(&mut conn).unwrap();
        let kept: String = conn.query_row("SELECT state FROM memory_conflicts WHERE conflict_id = 'c1'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, "CONFLICT", "a conflict was lost in the rebuild");
        assert!(conn.execute("INSERT INTO memory_conflicts VALUES ('c2','a','b','s','SUPERSEDED_BY_USER','t')", []).is_ok());
        assert!(conn.execute("INSERT INTO memory_conflicts VALUES ('c3','a','b','s','AGENT_WINS','t')", []).is_err(), "an unknown state was stored");
    }

    #[test]
    fn check_constraints_refuse_invalid_records() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply(&mut conn).unwrap();
        let bad = conn.execute(
            "INSERT INTO projects VALUES ('p', '', '', 'ACTIVE', 'en', NULL, NULL, 'LOCAL_ONLY', 1, 't', 't')",
            [],
        );
        assert!(bad.is_err(), "an empty project name was stored");
        let bad = conn.execute(
            "INSERT INTO projects VALUES ('p', 'n', '', 'DELETED', 'en', NULL, NULL, 'LOCAL_ONLY', 1, 't', 't')",
            [],
        );
        assert!(bad.is_err(), "an unknown status was stored");
    }
}
