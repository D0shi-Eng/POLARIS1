// مخطط v21 (PHASE-06، 2026-10-21): خادم MCP بعيد عبر HTTPS بجانب خادم الحلقة المحلية.
//
// `mcp_servers.transport` كان يقبل LOOPBACK_HTTP وحده، و`endpoint` عناوين الحلقة المحلية وحدها. القيد الجديد يربط النقل بشكل عنوانه:
// LOOPBACK_HTTP لعنوان حلقة محلية، وREMOTE_HTTPS لعنوان https. القيد حارس ثانٍ فوق تحقّق المضيف (`resolve_registered`: عنوان عامّ،
// بلا اعتماد ولا استعلام)، لا بديل عنه. SQLite لا يعدّل قيد CHECK في مكانه، فيُبنى الجدول من جديد بالأعمدة نفسها ويُنسخ كل صفّ
// إليه ثم يأخذ اسمه، داخل معاملة الترحيل (والمشغّل يفحص المفاتيح الأجنبية بعدها: `mcp_tools` تشير إليه).

pub const V21: &str = r#"
CREATE TABLE mcp_servers_v21 (
    server_id           TEXT PRIMARY KEY NOT NULL,
    name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    endpoint            TEXT NOT NULL CHECK (length(endpoint) <= 300),
    transport           TEXT NOT NULL CHECK (transport IN ('LOOPBACK_HTTP','REMOTE_HTTPS')),
    state               TEXT NOT NULL CHECK (state IN ('REGISTERED','ENABLED','DISABLED','UNREACHABLE')),
    granted_effects     TEXT NOT NULL,
    tool_count          INTEGER NOT NULL CHECK (tool_count >= 0),
    rejected_tool_count INTEGER NOT NULL CHECK (rejected_tool_count >= 0),
    last_error          TEXT NULL,
    last_refresh_at     TEXT NULL,
    registered_at       TEXT NOT NULL,
    CHECK (
        (transport = 'LOOPBACK_HTTP' AND (endpoint LIKE 'http://127.0.0.1%' OR endpoint LIKE 'http://localhost%' OR endpoint LIKE 'http://[::1]%'))
        OR (transport = 'REMOTE_HTTPS' AND endpoint LIKE 'https://%')
    )
) STRICT;
INSERT INTO mcp_servers_v21 (server_id, name, endpoint, transport, state, granted_effects, tool_count, rejected_tool_count, last_error, last_refresh_at, registered_at)
    SELECT server_id, name, endpoint, transport, state, granted_effects, tool_count, rejected_tool_count, last_error, last_refresh_at, registered_at FROM mcp_servers;
DROP TABLE mcp_servers;
ALTER TABLE mcp_servers_v21 RENAME TO mcp_servers;
"#;
