// إعدادات جاهزة لموصلات حقيقية فوق موصل REST العامّ (PHASE-05، 2026-10-20).
//
// كل إعداد بيانات: عنوان الخدمة الرسمي، وعمليات قراءة موثّقة، ونوع الاعتماد. لا شيفرة خاصة بخدمة: التنفيذ والسياسة والمعدّل
// والأسرار والتدقيق هي بوابة الموصلات نفسها. الموصل يُسجَّل معطّلًا وبلا اعتماد، ويبقى غير متّصل حتى يضع المستخدم رمزه ويختبره؛
// لا «متّصل» يُعرض قبل ذلك. لا عملية كتابة ولا إرسال في هذه الدفعة.
//
// المصادر: Slack Web API (`https://api.slack.com/methods/conversations.list`، `conversations.history`)؛ Notion API
// (`https://developers.notion.com/reference`: `Retrieve a page`، `Retrieve block children`، `List all users`، والترويسة الإلزامية
// `Notion-Version`). أسماء الخدمات علامات أصحابها؛ لا شعار ولا ادّعاء شراكة.

use serde::Serialize;

use super::model::{
    AuthMode, ConnectorCategory, ConnectorOperation, ConnectorProvider, EgressClass, FixedHeader, HttpMethod, IdempotencySupport, OperationAction, OperationParam, ParamKind,
    ParamLocation,
};
use super::service::{RegisterInput, RestInput};

/// ما تعرضه الواجهة عن إعداد جاهز. لا سرّ فيه.
#[derive(Debug, Clone, Serialize)]
pub struct PresetView {
    pub preset_id: &'static str,
    pub display_name: &'static str,
    pub category: ConnectorCategory,
    pub description: &'static str,
    pub base_url: &'static str,
    pub auth_mode: AuthMode,
    /// كيف ينشئ المستخدم رمزه، والأذونات الدنيا. نصّ عرض.
    pub setup_hint: &'static str,
    pub docs_url: &'static str,
    pub operations: Vec<PresetOperation>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PresetOperation {
    pub operation_id: String,
    pub title: String,
    pub action: OperationAction,
}

struct Preset {
    view: PresetView,
    base_url: &'static str,
    paths: Vec<String>,
    fixed_headers: &'static [(&'static str, &'static str)],
    operations: Vec<ConnectorOperation>,
    /// ترويسة المفتاح لنمط API_KEY.
    key_header: Option<&'static str>,
}

/// سطر من الجدول الموسّع إعدادًا جاهزًا: المسارات المسموحة هي مسارات عملياته وحدها.
fn from_row(row: &super::preset_table::Row) -> Preset {
    let operations: Vec<ConnectorOperation> = row.ops.iter().map(super::preset_table::Op::build).collect();
    let mut paths: Vec<String> = operations.iter().map(|o| o.path.clone()).collect();
    paths.dedup();
    Preset {
        view: PresetView {
            preset_id: row.preset_id,
            display_name: row.name,
            category: row.category,
            description: row.description,
            base_url: row.base_url,
            auth_mode: row.auth,
            setup_hint: row.hint,
            docs_url: row.docs,
            operations: Vec::new(),
        },
        base_url: row.base_url,
        paths,
        fixed_headers: &[],
        operations,
        key_header: row.key_header,
    }
}

fn param(name: &str, location: ParamLocation, kind: ParamKind, required: bool) -> OperationParam {
    OperationParam { name: name.into(), location, kind, required, max_length: None, minimum: None, maximum: None, allowed: Vec::new() }
}

fn text(name: &str, location: ParamLocation, required: bool, max: u32) -> OperationParam {
    OperationParam { max_length: Some(max), ..param(name, location, ParamKind::String, required) }
}

fn page_size(name: &str, max: i64) -> OperationParam {
    OperationParam { minimum: Some(1), maximum: Some(max), ..param(name, ParamLocation::Query, ParamKind::Integer, false) }
}

/// عملية قراءة: GET، بلا تكرار، وقائمة بحقولها.
fn read(id: &str, title: &str, path: &str, params: Vec<OperationParam>, result_fields: &[&str], list: Option<&str>, items: &[&str]) -> ConnectorOperation {
    ConnectorOperation {
        operation_id: id.into(),
        title: title.into(),
        action: OperationAction::Read,
        method: HttpMethod::Get,
        path: path.into(),
        params,
        idempotency: IdempotencySupport::None,
        resource_id_pointer: None,
        result_fields: result_fields.iter().map(|f| f.to_string()).collect(),
        cost_pointer: None,
        cost_currency: None,
        list_pointer: list.map(str::to_string),
        item_fields: items.iter().map(|f| f.to_string()).collect(),
    }
}

fn slack_operations() -> Vec<ConnectorOperation> {
    let mut types = param("types", ParamLocation::Query, ParamKind::Enum, false);
    types.allowed = vec!["public_channel".into(), "private_channel".into(), "public_channel,private_channel".into()];
    vec![
        read(
            "conversations.list",
            "List channels",
            "/api/conversations.list",
            vec![types, page_size("limit", 200), text("cursor", ParamLocation::Query, false, 200)],
            &["/ok"],
            Some("/channels"),
            &["/id", "/name", "/topic/value", "/num_members", "/is_private"],
        ),
        read(
            "conversations.history",
            "Read a channel's recent messages",
            "/api/conversations.history",
            vec![text("channel", ParamLocation::Query, true, 32), page_size("limit", 200), text("cursor", ParamLocation::Query, false, 200)],
            &["/ok"],
            Some("/messages"),
            &["/ts", "/user", "/text"],
        ),
    ]
}

fn notion_operations() -> Vec<ConnectorOperation> {
    vec![
        read("pages.retrieve", "Read a page's properties", "/v1/pages/{page_id}", vec![text("page_id", ParamLocation::Path, true, 64)], &["/id", "/url", "/last_edited_time"], None, &[]),
        read(
            "blocks.children",
            "Read a page's content blocks",
            "/v1/blocks/{block_id}/children",
            vec![text("block_id", ParamLocation::Path, true, 64), page_size("page_size", 100), text("start_cursor", ParamLocation::Query, false, 64)],
            &["/has_more"],
            Some("/results"),
            &["/id", "/type", "/paragraph/rich_text/0/plain_text", "/heading_1/rich_text/0/plain_text", "/heading_2/rich_text/0/plain_text", "/bulleted_list_item/rich_text/0/plain_text", "/to_do/rich_text/0/plain_text", "/child_page/title"],
        ),
        read("users.list", "List workspace users", "/v1/users", vec![page_size("page_size", 100), text("start_cursor", ParamLocation::Query, false, 64)], &["/has_more"], Some("/results"), &["/id", "/name", "/type"]),
    ]
}

const SLACK_PATHS: &[&str] = &["/api/conversations.list", "/api/conversations.history"];
const NOTION_PATHS: &[&str] = &["/v1/pages/{page_id}", "/v1/blocks/{block_id}/children", "/v1/users"];

fn catalog() -> Vec<Preset> {
    vec![
        Preset {
            view: PresetView {
                preset_id: "slack.read",
                display_name: "Slack",
                category: ConnectorCategory::Messaging,
                description: "Read channel lists and recent messages from a Slack workspace with a bot token.",
                base_url: "https://slack.com",
                auth_mode: AuthMode::BearerToken,
                setup_hint: "Create a Slack app in your workspace, add the bot scopes channels:read and channels:history (groups:read and groups:history for private channels), install it, invite the bot to the channels, and paste its Bot User OAuth Token (xoxb-…).",
                docs_url: "https://api.slack.com/methods/conversations.history",
                operations: Vec::new(),
            },
            base_url: "https://slack.com",
            paths: SLACK_PATHS.iter().map(|p| p.to_string()).collect(),
            fixed_headers: &[],
            operations: slack_operations(),
            key_header: None,
        },
        Preset {
            view: PresetView {
                preset_id: "notion.read",
                display_name: "Notion",
                category: ConnectorCategory::ProjectManagement,
                description: "Read pages, their content blocks and workspace users from Notion with an internal integration token.",
                base_url: "https://api.notion.com",
                auth_mode: AuthMode::BearerToken,
                setup_hint: "Create an internal integration at notion.so/my-integrations with the Read content capability, share the pages you want with it, and paste its Internal Integration Secret.",
                docs_url: "https://developers.notion.com/reference/intro",
                operations: Vec::new(),
            },
            base_url: "https://api.notion.com",
            paths: NOTION_PATHS.iter().map(|p| p.to_string()).collect(),
            fixed_headers: &[("Notion-Version", "2022-06-28")],
            operations: notion_operations(),
            key_header: None,
        },
    ]
    .into_iter()
    .chain(super::preset_table::ROWS.iter().map(from_row))
    .collect()
}

/// الإعدادات الجاهزة بعملياتها.
pub fn list() -> Vec<PresetView> {
    catalog()
        .into_iter()
        .map(|p| {
            let mut view = p.view;
            view.operations = p.operations.into_iter().map(|o| PresetOperation { operation_id: o.operation_id, title: o.title, action: o.action }).collect();
            view
        })
        .collect()
}

/// طلب التسجيل لإعداد جاهز: موصل REST عامّ باعتماد في مخزن النظام، وعمليات قراءة فقط. `None` لمعرّف غير معروف.
pub fn register_input(preset_id: &str, display_name: Option<&str>) -> Option<RegisterInput> {
    let preset = catalog().into_iter().find(|p| p.view.preset_id == preset_id)?;
    Some(RegisterInput {
        provider: ConnectorProvider::Rest,
        category: preset.view.category,
        display_name: display_name.map(str::to_string).unwrap_or_else(|| preset.view.display_name.to_string()),
        rest: Some(RestInput {
            base_url: preset.base_url.into(),
            egress_class: EgressClass::PublicHttps,
            allowed_paths: preset.paths.clone(),
            allowed_methods: vec![HttpMethod::Get],
            auth_mode: preset.view.auth_mode,
            // خدمة عامّة بلا اعتماد لا مصدر مفتاح لها؛ والبقية من مخزن النظام.
            key_source: if preset.view.auth_mode == AuthMode::None { "NONE".into() } else { "CREDENTIAL_STORE".into() },
            environment_variable: None,
            key_header: preset.key_header.map(str::to_string),
            basic_username: None,
            timeout_ms: 15_000,
            max_response_bytes: 524_288,
            requests_per_minute: Some(20),
            max_concurrent: Some(2),
        }),
        workspace: None,
        operations: preset.operations,
        fixed_headers: preset.fixed_headers.iter().map(|(n, v)| FixedHeader { name: n.to_string(), value: v.to_string() }).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p06::connector::model::{validate_rest, RateLimit, RestConfig, SecretSource};

    fn config_of(input: &RegisterInput) -> RestConfig {
        let rest = input.rest.as_ref().expect("rest");
        RestConfig {
            base_url: rest.base_url.clone(),
            egress_class: rest.egress_class,
            allowed_paths: rest.allowed_paths.clone(),
            allowed_methods: rest.allowed_methods.clone(),
            auth_mode: rest.auth_mode,
            secret: if rest.auth_mode == AuthMode::None { SecretSource::None } else { SecretSource::CredentialStore { secret_ref: "secret://connectors/test/default".into() } },
            api_key_header: rest.key_header.clone(),
            basic_username: None,
            timeout_ms: rest.timeout_ms,
            max_response_bytes: rest.max_response_bytes,
            rate: RateLimit { requests_per_minute: rest.requests_per_minute.unwrap_or(20), max_concurrent: rest.max_concurrent.unwrap_or(2) },
            fixed_headers: input.fixed_headers.clone(),
        }
    }

    #[test]
    fn every_preset_passes_the_connector_validation_and_reads_only() {
        for view in list() {
            let input = register_input(view.preset_id, None).expect("known preset");
            validate_rest(&config_of(&input), &input.operations, 1_048_576).unwrap_or_else(|e| panic!("{} is refused: {e:?}", view.preset_id));
            assert!(input.operations.iter().all(|o| o.action == OperationAction::Read && o.method == HttpMethod::Get), "{} has a non-read operation", view.preset_id);
            assert_eq!(input.rest.as_ref().unwrap().egress_class, EgressClass::PublicHttps);
            let expected = if input.rest.as_ref().unwrap().auth_mode == AuthMode::None { "NONE" } else { "CREDENTIAL_STORE" };
            assert_eq!(input.rest.as_ref().unwrap().key_source, expected, "{} reads its key from somewhere else", view.preset_id);
        }
        assert!(register_input("unknown.read", None).is_none(), "an unknown preset produced a connector");
        // الجدول الموسّع: 2 + 42 إعدادًا بمعرّفات فريدة، ولا معامل إلزامي يسقط لأن اسمه لا يُقبل.
        let ids: std::collections::BTreeSet<&str> = list().iter().map(|v| v.preset_id).collect();
        assert_eq!(ids.len(), list().len(), "two presets share an id");
        assert_eq!(list().len(), 44);
        for row in super::super::preset_table::ROWS {
            for op in row.ops {
                for q in op.query.iter().filter_map(|q| q.strip_suffix('!')) {
                    assert!(crate::p06::connector::model::is_param_name(q), "{}:{} drops its required parameter {q}", row.preset_id, op.id);
                }
            }
        }
    }

    #[test]
    fn notion_carries_its_version_header_and_slack_none() {
        assert_eq!(register_input("notion.read", None).unwrap().fixed_headers, vec![FixedHeader { name: "Notion-Version".into(), value: "2022-06-28".into() }]);
        assert!(register_input("slack.read", None).unwrap().fixed_headers.is_empty());
    }

    #[test]
    fn a_fixed_header_outside_the_allow_list_or_with_a_free_text_value_is_refused() {
        let mut input = register_input("notion.read", None).unwrap();
        input.fixed_headers = vec![FixedHeader { name: "Authorization".into(), value: "Bearer x".into() }];
        assert!(validate_rest(&config_of(&input), &input.operations, 1_048_576).is_err(), "an Authorization header was accepted as a fixed header");
        input.fixed_headers = vec![FixedHeader { name: "Notion-Version".into(), value: "2022 06 28; evil".into() }];
        assert!(validate_rest(&config_of(&input), &input.operations, 1_048_576).is_err(), "a free-text header value was accepted");
    }
}
