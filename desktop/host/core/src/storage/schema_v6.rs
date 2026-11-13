// مخطط v6 (Phase-08): إضافة بحتة لجداول بيئة التنفيذ والمخرجات والمرفقات والمجدول
// وتفويض OAuth والمشاركة والنشر وحزم المهارات وهوية الجهاز. لا جدول قديم يُمسّ.
//
// القيود المغلقة (CHECK) هي المفردات نفسها في الشيفرة: قيمة خارجها لا تُخزَّن أبدًا،
// فلا يستطيع خطأ في طبقة أعلى أن يكتب حالة لا يعرفها المنتج. ولا عمود يحمل سرًّا:
// رموز OAuth تُحفظ في مخزن الأسرار، ولا يبقى هنا إلا مرجعها.

pub const V6: &str = r#"
CREATE TABLE p08_artifacts (
    artifact_id         TEXT PRIMARY KEY NOT NULL CHECK (length(artifact_id) = 36),
    mission_id          TEXT NOT NULL CHECK (length(mission_id) = 36),
    artifact_type       TEXT NOT NULL CHECK (artifact_type IN ('DOCX', 'PPTX', 'XLSX', 'PDF', 'CSV', 'HTML', 'MARKDOWN', 'TEXT', 'JSON', 'IMAGE', 'WEB_SITE', 'CODE_PROJECT')),
    title               TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
    file_ref            TEXT NOT NULL CHECK (length(file_ref) BETWEEN 1 AND 400),
    mime_type           TEXT NOT NULL CHECK (length(mime_type) BETWEEN 3 AND 120),
    size_bytes          INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256              TEXT NOT NULL CHECK (length(sha256) = 64),
    created_at          TEXT NOT NULL,
    source_task         TEXT NULL CHECK (source_task IS NULL OR length(source_task) <= 64),
    verification_status TEXT NOT NULL CHECK (verification_status IN ('VERIFIED', 'FAILED', 'UNVERIFIED')),
    verification_json   TEXT NOT NULL CHECK (length(verification_json) <= 16000),
    preview_json        TEXT NOT NULL CHECK (length(preview_json) <= 64000),
    provenance_json     TEXT NOT NULL CHECK (length(provenance_json) <= 4000)
) STRICT;
CREATE INDEX p08_artifacts_by_mission ON p08_artifacts (mission_id, created_at);

CREATE TABLE p08_execution_runs (
    run_id          TEXT PRIMARY KEY NOT NULL CHECK (length(run_id) = 36),
    mission_id      TEXT NOT NULL CHECK (length(mission_id) = 36),
    task_id         TEXT NOT NULL CHECK (length(task_id) <= 64),
    tool_id         TEXT NOT NULL CHECK (length(tool_id) <= 160),
    runtime         TEXT NOT NULL CHECK (runtime IN ('POWERSHELL', 'CMD', 'PYTHON')),
    command_preview TEXT NOT NULL CHECK (length(command_preview) <= 2000),
    command_sha256  TEXT NOT NULL CHECK (length(command_sha256) = 64),
    status          TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED', 'TIMED_OUT', 'LIMIT_EXCEEDED', 'CANCELLED', 'SANDBOX_UNAVAILABLE')),
    exit_code       INTEGER NULL,
    duration_ms     INTEGER NOT NULL CHECK (duration_ms >= 0),
    stdout_bytes    INTEGER NOT NULL CHECK (stdout_bytes >= 0),
    stderr_bytes    INTEGER NOT NULL CHECK (stderr_bytes >= 0),
    output_truncated INTEGER NOT NULL CHECK (output_truncated IN (0, 1)),
    network         INTEGER NOT NULL CHECK (network IN (0, 1)),
    processes_total INTEGER NOT NULL CHECK (processes_total >= 0),
    survivors       INTEGER NOT NULL CHECK (survivors >= 0),
    output_excerpt  TEXT NOT NULL CHECK (length(output_excerpt) <= 8000),
    started_at      TEXT NOT NULL,
    finished_at     TEXT NOT NULL
) STRICT;
CREATE INDEX p08_execution_runs_by_mission ON p08_execution_runs (mission_id, started_at);

CREATE TABLE p08_attachments (
    attachment_id  TEXT PRIMARY KEY NOT NULL CHECK (length(attachment_id) = 36),
    mission_id     TEXT NULL CHECK (mission_id IS NULL OR length(mission_id) = 36),
    staging_id     TEXT NOT NULL CHECK (length(staging_id) = 36),
    file_name      TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
    workspace_ref  TEXT NOT NULL CHECK (length(workspace_ref) BETWEEN 1 AND 400),
    file_kind      TEXT NOT NULL CHECK (length(file_kind) BETWEEN 2 AND 20),
    size_bytes     INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256         TEXT NOT NULL CHECK (length(sha256) = 64),
    classification TEXT NOT NULL CHECK (classification IN ('USER_PROVIDED_UNTRUSTED')),
    imported_at    TEXT NOT NULL
) STRICT;

CREATE TABLE p08_schedules (
    schedule_id      TEXT PRIMARY KEY NOT NULL CHECK (length(schedule_id) = 36),
    name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    template_json    TEXT NOT NULL CHECK (length(template_json) <= 16000),
    timezone         TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
    schedule_json    TEXT NOT NULL CHECK (length(schedule_json) <= 2000),
    enabled          INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    next_run_at      TEXT NULL,
    last_run_at      TEXT NULL,
    last_mission_id  TEXT NULL CHECK (last_mission_id IS NULL OR length(last_mission_id) = 36),
    last_status      TEXT NULL CHECK (last_status IS NULL OR length(last_status) <= 40),
    budget_json      TEXT NOT NULL CHECK (length(budget_json) <= 2000),
    approval_policy  TEXT NOT NULL CHECK (approval_policy IN ('WAIT_FOR_APPROVAL', 'FAIL_ON_APPROVAL')),
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
) STRICT;

CREATE TABLE p08_schedule_runs (
    run_id       TEXT PRIMARY KEY NOT NULL CHECK (length(run_id) = 36),
    schedule_id  TEXT NOT NULL CHECK (length(schedule_id) = 36),
    mission_id   TEXT NULL CHECK (mission_id IS NULL OR length(mission_id) = 36),
    trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('SCHEDULED', 'RUN_NOW')),
    status       TEXT NOT NULL CHECK (length(status) BETWEEN 3 AND 40),
    detail       TEXT NOT NULL CHECK (length(detail) <= 1000),
    triggered_at TEXT NOT NULL
) STRICT;
CREATE INDEX p08_schedule_runs_by_schedule ON p08_schedule_runs (schedule_id, triggered_at);

CREATE TABLE p08_oauth_connections (
    connection_id TEXT PRIMARY KEY NOT NULL CHECK (length(connection_id) = 36),
    provider_id   TEXT NOT NULL CHECK (length(provider_id) BETWEEN 3 AND 80),
    display_name  TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
    client_id     TEXT NOT NULL CHECK (length(client_id) BETWEEN 1 AND 200),
    scopes        TEXT NOT NULL CHECK (length(scopes) <= 1000),
    token_ref     TEXT NULL CHECK (token_ref IS NULL OR token_ref LIKE 'secret://oauth/%'),
    status        TEXT NOT NULL CHECK (status IN ('PENDING', 'CONNECTED', 'EXPIRED', 'REVOKED', 'FAILED')),
    expires_at    TEXT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
) STRICT;

CREATE TABLE p08_share_grants (
    grant_id    TEXT PRIMARY KEY NOT NULL CHECK (length(grant_id) = 36),
    object_type TEXT NOT NULL CHECK (object_type IN ('MISSION', 'ARTIFACT', 'WORKSPACE')),
    object_id   TEXT NOT NULL CHECK (length(object_id) = 36),
    member      TEXT NOT NULL CHECK (length(member) BETWEEN 1 AND 200),
    role        TEXT NOT NULL CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),
    created_at  TEXT NOT NULL,
    UNIQUE (object_type, object_id, member)
) STRICT;

CREATE TABLE p08_publications (
    publication_id TEXT PRIMARY KEY NOT NULL CHECK (length(publication_id) = 36),
    artifact_id    TEXT NOT NULL CHECK (length(artifact_id) = 36),
    publisher      TEXT NOT NULL CHECK (length(publisher) BETWEEN 3 AND 80),
    status         TEXT NOT NULL CHECK (status IN ('PROPOSED', 'AWAITING_APPROVAL', 'PUBLISHED', 'DENIED', 'FAILED')),
    target         TEXT NOT NULL CHECK (length(target) <= 400),
    approval_id    TEXT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
) STRICT;

CREATE TABLE p08_skill_packages (
    package_id      TEXT PRIMARY KEY NOT NULL CHECK (length(package_id) BETWEEN 3 AND 120),
    name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    version         TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
    author          TEXT NOT NULL CHECK (length(author) BETWEEN 1 AND 120),
    manifest_json   TEXT NOT NULL CHECK (length(manifest_json) <= 32000),
    manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
    signature_state TEXT NOT NULL CHECK (signature_state IN ('UNSIGNED', 'SIGNATURE_INVALID', 'SIGNED_UNKNOWN_KEY', 'SIGNED_TRUSTED')),
    source          TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 400),
    trust_state     TEXT NOT NULL CHECK (trust_state IN ('UNTRUSTED', 'VALIDATED', 'REJECTED')),
    rejection       TEXT NULL CHECK (rejection IS NULL OR length(rejection) <= 1000),
    imported_at     TEXT NOT NULL
) STRICT;

CREATE TABLE p08_settings (
    setting_key TEXT PRIMARY KEY NOT NULL CHECK (setting_key IN ('voice.transcription_endpoint', 'voice.transcription_model', 'workspace.export_folder_label', 'browser.engine_enabled')),
    value_json  TEXT NOT NULL CHECK (length(value_json) <= 2000),
    updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE p08_mission_preferences (
    mission_id TEXT PRIMARY KEY NOT NULL CHECK (length(mission_id) = 36),
    model_id   TEXT NULL CHECK (model_id IS NULL OR length(model_id) BETWEEN 1 AND 200),
    origin     TEXT NOT NULL CHECK (origin IN ('USER', 'SCHEDULE')),
    schedule_id TEXT NULL CHECK (schedule_id IS NULL OR length(schedule_id) = 36),
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE p08_device (
    singleton  INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
    device_id  TEXT NOT NULL CHECK (length(device_id) = 36),
    created_at TEXT NOT NULL
) STRICT;
"#;
