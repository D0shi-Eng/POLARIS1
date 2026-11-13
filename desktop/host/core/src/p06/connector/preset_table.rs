// جدول الإعدادات الجاهزة الموسّع (2026-11-13): مكافئات «الإضافات» في Manus التي لها واجهة REST موثّقة تُقرأ برمز واحد.
//
// كل سطر بيانات فقط، ويمرّ ببوابة الموصلات نفسها (السياسة، والمعدّل، والأسرار في مخزن النظام، والتدقيق). عمليات قراءة GET
// وحدها: لا كتابة ولا إرسال ولا دفع. الخدمة التي تتطلّب OAuth تفاعليًا أو GraphQL أو عنوانًا خاصًا بكل حساب ليست هنا؛ تُضاف
// من «إنشاء ← موصل REST» أو خادم MCP، والواجهة تقول ذلك صراحة بدل أن تعرض «متّصل» كاذبًا.
//
// المسارات من التوثيق الرسمي لكل خدمة (روابطها في `docs`). أسماء الخدمات علامات أصحابها؛ لا شعار ولا ادّعاء شراكة.

use super::model::{AuthMode, ConnectorCategory, ConnectorOperation, HttpMethod, IdempotencySupport, OperationAction, OperationParam, ParamKind, ParamLocation};

/// عملية قراءة في الجدول: المعرّف، والعنوان، والمسار (معاملات `{x}` تصير معاملات مسار إلزامية)، ومعاملات الاستعلام
/// (`!` في آخر الاسم = إلزامي)، ومؤشّر القائمة، وحقول العنصر.
pub struct Op {
    pub id: &'static str,
    pub title: &'static str,
    pub path: &'static str,
    pub query: &'static [&'static str],
    pub list: Option<&'static str>,
    pub items: &'static [&'static str],
}

pub struct Row {
    pub preset_id: &'static str,
    pub name: &'static str,
    pub category: ConnectorCategory,
    pub description: &'static str,
    pub base_url: &'static str,
    pub auth: AuthMode,
    /// ترويسة المفتاح لنمط API_KEY (من القائمة المسموحة وحدها).
    pub key_header: Option<&'static str>,
    pub hint: &'static str,
    pub docs: &'static str,
    pub ops: &'static [Op],
}

const fn op(id: &'static str, title: &'static str, path: &'static str, query: &'static [&'static str], list: Option<&'static str>, items: &'static [&'static str]) -> Op {
    Op { id, title, path, query, list, items }
}

fn text(name: &str, location: ParamLocation, required: bool) -> OperationParam {
    OperationParam { name: name.into(), location, kind: ParamKind::String, required, max_length: Some(200), minimum: None, maximum: None, allowed: Vec::new() }
}

/// معاملات `{x}` في المسار.
fn path_params(path: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = path;
    while let Some(open) = rest.find('{') {
        let Some(close) = rest[open..].find('}') else { break };
        out.push(rest[open + 1..open + close].to_string());
        rest = &rest[open + close + 1..];
    }
    out
}

impl Op {
    pub fn build(&self) -> ConnectorOperation {
        let mut params: Vec<OperationParam> = path_params(self.path).iter().map(|p| text(p, ParamLocation::Path, true)).collect();
        // اسم معامل لا يقبله الموصل (حروف كبيرة أو `$` أو نقطة) لا يُعرض للوكيل؛ الاختبار يمنع أن يُفقد معامل إلزامي هكذا.
        params.extend(self.query.iter().filter_map(|q| {
            let (name, required) = q.strip_suffix('!').map_or((*q, false), |n| (n, true));
            super::model::is_param_name(name).then(|| text(name, ParamLocation::Query, required))
        }));
        ConnectorOperation {
            operation_id: self.id.into(),
            title: self.title.into(),
            action: OperationAction::Read,
            method: HttpMethod::Get,
            path: self.path.into(),
            params,
            idempotency: IdempotencySupport::None,
            resource_id_pointer: None,
            result_fields: Vec::new(),
            cost_pointer: None,
            cost_currency: None,
            list_pointer: self.list.map(str::to_string),
            item_fields: if self.list.is_some() { self.items.iter().map(|f| f.to_string()).collect() } else { Vec::new() },
        }
    }
}

use AuthMode::{ApiKey, BearerToken, None as NoAuth};
use ConnectorCategory::{Calendar, CodeHosting, CustomApi, Database, Email, Files, Messaging, ProjectManagement};

pub const ROWS: &[Row] = &[
    Row { preset_id: "github.read", name: "GitHub", category: CodeHosting, description: "Read your profile, repositories, issues and pull requests.", base_url: "https://api.github.com", auth: BearerToken, key_header: None,
        hint: "Create a fine-grained personal access token at github.com/settings/tokens with read-only access to the repositories you choose.", docs: "https://docs.github.com/en/rest",
        ops: &[op("user.get", "Read the signed-in user", "/user", &[], None, &[]),
               op("repos.list", "List your repositories", "/user/repos", &["per_page", "page", "sort"], None, &[]),
               op("issues.list", "List a repository's issues", "/repos/{owner}/{repo}/issues", &["state", "per_page", "page"], None, &[]),
               op("pulls.list", "List a repository's pull requests", "/repos/{owner}/{repo}/pulls", &["state", "per_page"], None, &[])] },
    Row { preset_id: "gmail.read", name: "Gmail", category: Email, description: "Search and read messages in your Gmail mailbox.", base_url: "https://gmail.googleapis.com", auth: BearerToken, key_header: None,
        hint: "Gmail needs an OAuth access token with the gmail.readonly scope (for example from the Google OAuth 2.0 Playground). Access tokens expire after about an hour; paste a fresh one when the test fails.", docs: "https://developers.google.com/gmail/api/reference/rest",
        ops: &[op("messages.list", "Search messages", "/gmail/v1/users/me/messages", &["q", "maxResults", "pageToken"], Some("/messages"), &["/id", "/threadId"]),
               op("messages.get", "Read a message", "/gmail/v1/users/me/messages/{id}", &["format"], None, &[]),
               op("labels.list", "List labels", "/gmail/v1/users/me/labels", &[], Some("/labels"), &["/id", "/name"])] },
    Row { preset_id: "google-calendar.read", name: "Google Calendar", category: Calendar, description: "List your calendars and upcoming events.", base_url: "https://www.googleapis.com", auth: BearerToken, key_header: None,
        hint: "Needs an OAuth access token with the calendar.readonly scope. Access tokens expire after about an hour.", docs: "https://developers.google.com/calendar/api/v3/reference",
        ops: &[op("calendars.list", "List calendars", "/calendar/v3/users/me/calendarList", &[], Some("/items"), &["/id", "/summary"]),
               op("events.list", "List events", "/calendar/v3/calendars/{calendar_id}/events", &["timeMin", "timeMax", "q", "maxResults", "singleEvents", "orderBy"], Some("/items"), &["/id", "/summary", "/start/dateTime", "/end/dateTime"])] },
    Row { preset_id: "google-drive.read", name: "Google Drive", category: Files, description: "Search and read file metadata in Google Drive.", base_url: "https://www.googleapis.com", auth: BearerToken, key_header: None,
        hint: "Needs an OAuth access token with the drive.readonly scope. Access tokens expire after about an hour.", docs: "https://developers.google.com/drive/api/reference/rest/v3",
        ops: &[op("files.list", "Search files", "/drive/v3/files", &["q", "pageSize", "pageToken", "fields"], Some("/files"), &["/id", "/name", "/mimeType"]),
               op("files.get", "Read file metadata", "/drive/v3/files/{file_id}", &["fields"], None, &[])] },
    Row { preset_id: "outlook-mail.read", name: "Outlook Mail", category: Email, description: "Search and read Outlook mail through Microsoft Graph.", base_url: "https://graph.microsoft.com", auth: BearerToken, key_header: None,
        hint: "Needs a Microsoft Graph access token with Mail.Read (for example from Graph Explorer). Tokens expire after about an hour.", docs: "https://learn.microsoft.com/graph/api/user-list-messages",
        ops: &[op("messages.list", "List messages", "/v1.0/me/messages", &["$search", "$top", "$select"], Some("/value"), &["/id", "/subject", "/from/emailAddress/address", "/receivedDateTime"]),
               op("messages.get", "Read a message", "/v1.0/me/messages/{id}", &["$select"], None, &[])] },
    Row { preset_id: "outlook-calendar.read", name: "Outlook Calendar", category: Calendar, description: "Read Outlook calendar events through Microsoft Graph.", base_url: "https://graph.microsoft.com", auth: BearerToken, key_header: None,
        hint: "Needs a Microsoft Graph access token with Calendars.Read. Tokens expire after about an hour.", docs: "https://learn.microsoft.com/graph/api/user-list-events",
        ops: &[op("events.list", "List events", "/v1.0/me/events", &["$top", "$select", "$filter"], Some("/value"), &["/id", "/subject", "/start/dateTime", "/end/dateTime"])] },
    Row { preset_id: "stripe.read", name: "Stripe", category: CustomApi, description: "Read balance, customers, charges and invoices.", base_url: "https://api.stripe.com", auth: BearerToken, key_header: None,
        hint: "Create a restricted key in the Stripe dashboard with read-only access and paste it (rk_…). Never paste a live secret key with write access.", docs: "https://docs.stripe.com/api",
        ops: &[op("balance.get", "Read the balance", "/v1/balance", &[], None, &[]),
               op("customers.list", "List customers", "/v1/customers", &["limit", "email", "starting_after"], Some("/data"), &["/id", "/email", "/name"]),
               op("charges.list", "List charges", "/v1/charges", &["limit", "customer"], Some("/data"), &["/id", "/amount", "/currency", "/status"]),
               op("invoices.list", "List invoices", "/v1/invoices", &["limit", "customer", "status"], Some("/data"), &["/id", "/amount_due", "/status"])] },
    Row { preset_id: "airtable.read", name: "Airtable", category: Database, description: "List bases and read table records.", base_url: "https://api.airtable.com", auth: BearerToken, key_header: None,
        hint: "Create a personal access token at airtable.com/create/tokens with data.records:read and schema.bases:read for the chosen bases.", docs: "https://airtable.com/developers/web/api/introduction",
        ops: &[op("bases.list", "List bases", "/v0/meta/bases", &[], Some("/bases"), &["/id", "/name"]),
               op("records.list", "List records", "/v0/{base_id}/{table}", &["maxRecords", "view", "filterByFormula", "offset"], Some("/records"), &["/id", "/createdTime"])] },
    Row { preset_id: "supabase.read", name: "Supabase", category: Database, description: "List your Supabase projects and organisations.", base_url: "https://api.supabase.com", auth: BearerToken, key_header: None,
        hint: "Create a personal access token in the Supabase dashboard (Account → Access Tokens).", docs: "https://supabase.com/docs/reference/api/introduction",
        ops: &[op("projects.list", "List projects", "/v1/projects", &[], None, &[]),
               op("organizations.list", "List organisations", "/v1/organizations", &[], None, &[])] },
    Row { preset_id: "vercel.read", name: "Vercel", category: CodeHosting, description: "List Vercel projects and deployments.", base_url: "https://api.vercel.com", auth: BearerToken, key_header: None,
        hint: "Create a token at vercel.com/account/tokens scoped to the team you choose.", docs: "https://vercel.com/docs/rest-api",
        ops: &[op("projects.list", "List projects", "/v9/projects", &["limit", "teamId"], Some("/projects"), &["/id", "/name", "/framework"]),
               op("deployments.list", "List deployments", "/v6/deployments", &["limit", "projectId", "teamId", "state"], Some("/deployments"), &["/uid", "/name", "/state", "/url"])] },
    Row { preset_id: "cloudflare.read", name: "Cloudflare", category: CustomApi, description: "Read zones, DNS records and accounts.", base_url: "https://api.cloudflare.com", auth: BearerToken, key_header: None,
        hint: "Create an API token at dash.cloudflare.com/profile/api-tokens with read permissions only (Zone:Read, DNS:Read).", docs: "https://developers.cloudflare.com/api/",
        ops: &[op("zones.list", "List zones", "/client/v4/zones", &["name", "per_page"], Some("/result"), &["/id", "/name", "/status"]),
               op("dns.list", "List DNS records", "/client/v4/zones/{zone_id}/dns_records", &["type", "name", "per_page"], Some("/result"), &["/id", "/type", "/name", "/content"]),
               op("accounts.list", "List accounts", "/client/v4/accounts", &[], Some("/result"), &["/id", "/name"])] },
    Row { preset_id: "huggingface.read", name: "Hugging Face", category: CustomApi, description: "Search models and datasets and read model cards.", base_url: "https://huggingface.co", auth: BearerToken, key_header: None,
        hint: "Create a read token at huggingface.co/settings/tokens.", docs: "https://huggingface.co/docs/hub/api",
        ops: &[op("models.search", "Search models", "/api/models", &["search", "author", "limit", "sort"], None, &[]),
               op("datasets.search", "Search datasets", "/api/datasets", &["search", "author", "limit"], None, &[]),
               op("model.get", "Read a model", "/api/models/{owner}/{name}", &[], None, &[])] },
    Row { preset_id: "openai.read", name: "OpenAI", category: CustomApi, description: "List the models your OpenAI key can use.", base_url: "https://api.openai.com", auth: BearerToken, key_header: None,
        hint: "Create a project key at platform.openai.com/api-keys with read-only model permissions.", docs: "https://platform.openai.com/docs/api-reference/models",
        ops: &[op("models.list", "List models", "/v1/models", &[], Some("/data"), &["/id", "/owned_by"])] },
    Row { preset_id: "openrouter.read", name: "OpenRouter API", category: CustomApi, description: "List models, prices and your key's credit.", base_url: "https://openrouter.ai", auth: BearerToken, key_header: None,
        hint: "Create a key at openrouter.ai/keys.", docs: "https://openrouter.ai/docs/api-reference",
        ops: &[op("models.list", "List models", "/api/v1/models", &[], Some("/data"), &["/id", "/name", "/context_length"]),
               op("key.get", "Read the key's limits and usage", "/api/v1/key", &[], None, &[])] },
    Row { preset_id: "xai.read", name: "Grok", category: CustomApi, description: "List the xAI Grok models your key can use.", base_url: "https://api.x.ai", auth: BearerToken, key_header: None,
        hint: "Create an API key at console.x.ai.", docs: "https://docs.x.ai/docs/api-reference",
        ops: &[op("models.list", "List models", "/v1/models", &[], Some("/data"), &["/id", "/owned_by"])] },
    Row { preset_id: "cohere.read", name: "Cohere", category: CustomApi, description: "List the Cohere models your key can use.", base_url: "https://api.cohere.com", auth: BearerToken, key_header: None,
        hint: "Create a key at dashboard.cohere.com/api-keys.", docs: "https://docs.cohere.com/reference/list-models",
        ops: &[op("models.list", "List models", "/v1/models", &["page_size", "endpoint"], Some("/models"), &["/name", "/context_length"])] },
    Row { preset_id: "asana.read", name: "Asana", category: ProjectManagement, description: "Read workspaces, projects and tasks.", base_url: "https://app.asana.com", auth: BearerToken, key_header: None,
        hint: "Create a personal access token at app.asana.com/0/my-apps.", docs: "https://developers.asana.com/reference/rest-api-reference",
        ops: &[op("me.get", "Read the signed-in user", "/api/1.0/users/me", &[], None, &[]),
               op("workspaces.list", "List workspaces", "/api/1.0/workspaces", &[], Some("/data"), &["/gid", "/name"]),
               op("projects.list", "List projects", "/api/1.0/projects", &["workspace!", "limit"], Some("/data"), &["/gid", "/name"]),
               op("tasks.list", "List a project's tasks", "/api/1.0/projects/{project_gid}/tasks", &["limit", "opt_fields"], Some("/data"), &["/gid", "/name", "/completed"])] },
    Row { preset_id: "todoist.read", name: "Todoist", category: ProjectManagement, description: "Read projects and active tasks.", base_url: "https://api.todoist.com", auth: BearerToken, key_header: None,
        hint: "Copy your API token from Todoist Settings → Integrations → Developer.", docs: "https://developer.todoist.com/rest/v2",
        ops: &[op("projects.list", "List projects", "/rest/v2/projects", &[], None, &[]),
               op("tasks.list", "List active tasks", "/rest/v2/tasks", &["project_id", "filter"], None, &[])] },
    Row { preset_id: "typeform.read", name: "Typeform", category: CustomApi, description: "List forms and read their responses.", base_url: "https://api.typeform.com", auth: BearerToken, key_header: None,
        hint: "Create a personal token at admin.typeform.com/user/tokens with forms:read and responses:read.", docs: "https://www.typeform.com/developers/",
        ops: &[op("forms.list", "List forms", "/forms", &["page_size", "search"], Some("/items"), &["/id", "/title"]),
               op("responses.list", "List a form's responses", "/forms/{form_id}/responses", &["page_size", "since", "until"], Some("/items"), &["/response_id", "/submitted_at"])] },
    Row { preset_id: "webflow.read", name: "Webflow", category: CustomApi, description: "List Webflow sites and CMS collections.", base_url: "https://api.webflow.com", auth: BearerToken, key_header: None,
        hint: "Create a site API token in Webflow site settings → Apps & integrations with read scopes.", docs: "https://developers.webflow.com/data/reference",
        ops: &[op("sites.list", "List sites", "/v2/sites", &[], Some("/sites"), &["/id", "/displayName", "/shortName"]),
               op("collections.list", "List a site's collections", "/v2/sites/{site_id}/collections", &[], Some("/collections"), &["/id", "/displayName"])] },
    Row { preset_id: "canva.read", name: "Canva", category: Files, description: "List your Canva designs.", base_url: "https://api.canva.com", auth: BearerToken, key_header: None,
        hint: "Canva Connect needs an OAuth access token with design:meta:read from a Canva developer integration.", docs: "https://www.canva.dev/docs/connect/",
        ops: &[op("me.get", "Read the user", "/rest/v1/users/me", &[], None, &[]),
               op("designs.list", "List designs", "/rest/v1/designs", &["query", "continuation"], Some("/items"), &["/id", "/title", "/urls/view_url"])] },
    Row { preset_id: "context7.read", name: "Context7", category: CodeHosting, description: "Search up-to-date library documentation.", base_url: "https://context7.com", auth: BearerToken, key_header: None,
        hint: "Create an API key at context7.com/dashboard.", docs: "https://context7.com/docs",
        ops: &[op("libraries.search", "Search libraries", "/api/v1/search", &["query!"], Some("/results"), &["/id", "/title", "/description"])] },
    Row { preset_id: "line.read", name: "LINE", category: Messaging, description: "Read your LINE Official Account bot information and quota.", base_url: "https://api.line.me", auth: BearerToken, key_header: None,
        hint: "Issue a channel access token in the LINE Developers console for your Messaging API channel.", docs: "https://developers.line.biz/en/reference/messaging-api/",
        ops: &[op("bot.info", "Read bot information", "/v2/bot/info", &[], None, &[]),
               op("quota.get", "Read the message quota", "/v2/bot/message/quota", &[], None, &[])] },
    Row { preset_id: "instagram.read", name: "Instagram", category: Messaging, description: "Read an Instagram professional account's profile and media.", base_url: "https://graph.instagram.com", auth: BearerToken, key_header: None,
        hint: "Needs an Instagram API access token for a professional account (Meta for Developers → Instagram API with Instagram Login).", docs: "https://developers.facebook.com/docs/instagram-platform",
        ops: &[op("me.get", "Read the profile", "/me", &["fields"], None, &[]),
               op("media.list", "List media", "/me/media", &["fields", "limit"], Some("/data"), &["/id", "/caption", "/media_type", "/timestamp"])] },
    Row { preset_id: "meta-ads.read", name: "Meta Ads Manager", category: CustomApi, description: "Read ad accounts, campaigns and insights.", base_url: "https://graph.facebook.com", auth: BearerToken, key_header: None,
        hint: "Needs a Marketing API access token with ads_read (Meta for Developers → Graph API Explorer or a system user).", docs: "https://developers.facebook.com/docs/marketing-api",
        ops: &[op("adaccounts.list", "List ad accounts", "/v21.0/me/adaccounts", &["fields"], Some("/data"), &["/id", "/name", "/account_status"]),
               op("campaigns.list", "List campaigns", "/v21.0/{ad_account_id}/campaigns", &["fields", "limit"], Some("/data"), &["/id", "/name", "/status"]),
               op("insights.get", "Read insights", "/v21.0/{object_id}/insights", &["fields", "date_preset", "level"], Some("/data"), &["/impressions", "/clicks", "/spend"])] },
    Row { preset_id: "x.read", name: "X (Twitter)", category: Messaging, description: "Search recent public posts and read profiles.", base_url: "https://api.x.com", auth: BearerToken, key_header: None,
        hint: "Create an app at developer.x.com and paste its App-only Bearer Token. Search needs an access tier that includes it.", docs: "https://docs.x.com/x-api",
        ops: &[op("tweets.search", "Search recent posts", "/2/tweets/search/recent", &["query!", "max_results", "tweet.fields"], Some("/data"), &["/id", "/text"]),
               op("users.by_username", "Read a profile", "/2/users/by/username/{username}", &["user.fields"], None, &[])] },
    Row { preset_id: "zoom.read", name: "Zoom", category: Calendar, description: "Read your Zoom profile, meetings and recordings.", base_url: "https://api.zoom.us", auth: BearerToken, key_header: None,
        hint: "Needs an OAuth access token from a Zoom app (Server-to-Server OAuth) with meeting:read and recording:read.", docs: "https://developers.zoom.us/docs/api/",
        ops: &[op("me.get", "Read the user", "/v2/users/me", &[], None, &[]),
               op("meetings.list", "List meetings", "/v2/users/me/meetings", &["type", "page_size"], Some("/meetings"), &["/id", "/topic", "/start_time"]),
               op("recordings.list", "List cloud recordings", "/v2/users/me/recordings", &["from", "to"], Some("/meetings"), &["/uuid", "/topic", "/start_time"])] },
    Row { preset_id: "heygen.read", name: "HeyGen", category: CustomApi, description: "List avatars, voices and your generated videos.", base_url: "https://api.heygen.com", auth: ApiKey, key_header: Some("X-Api-Key"),
        hint: "Copy your API key from HeyGen Settings → API.", docs: "https://docs.heygen.com/reference",
        ops: &[op("avatars.list", "List avatars", "/v2/avatars", &[], None, &[]),
               op("voices.list", "List voices", "/v2/voices", &[], None, &[]),
               op("videos.list", "List videos", "/v1/video.list", &["limit"], None, &[])] },
    Row { preset_id: "ahrefs.read", name: "Ahrefs", category: CustomApi, description: "Read domain rating, backlinks and organic keywords.", base_url: "https://api.ahrefs.com", auth: BearerToken, key_header: None,
        hint: "Create an API v3 key in Ahrefs account settings (requires a plan with API access).", docs: "https://docs.ahrefs.com/docs/api/reference",
        ops: &[op("domain_rating", "Read domain rating", "/v3/site-explorer/domain-rating", &["target!", "date!"], None, &[]),
               op("backlinks", "List backlinks", "/v3/site-explorer/all-backlinks", &["target!", "select!", "limit"], Some("/backlinks"), &["/url_from", "/url_to", "/domain_rating_source"]),
               op("organic_keywords", "List organic keywords", "/v3/site-explorer/organic-keywords", &["target!", "date!", "select!", "country", "limit"], Some("/keywords"), &["/keyword", "/volume", "/best_position"])] },
    Row { preset_id: "neon.read", name: "Neon", category: Database, description: "List Neon Postgres projects and branches.", base_url: "https://console.neon.tech", auth: BearerToken, key_header: None,
        hint: "Create an API key at console.neon.tech/app/settings/api-keys.", docs: "https://api-docs.neon.tech/reference/getting-started-with-neon-api",
        ops: &[op("projects.list", "List projects", "/api/v2/projects", &["limit"], Some("/projects"), &["/id", "/name", "/region_id"]),
               op("branches.list", "List a project's branches", "/api/v2/projects/{project_id}/branches", &[], Some("/branches"), &["/id", "/name"])] },
    Row { preset_id: "render.read", name: "Render", category: CodeHosting, description: "List Render services and deploys.", base_url: "https://api.render.com", auth: BearerToken, key_header: None,
        hint: "Create an API key in Render Account Settings → API Keys.", docs: "https://api-docs.render.com/reference/introduction",
        ops: &[op("services.list", "List services", "/v1/services", &["limit", "name"], None, &[]),
               op("deploys.list", "List a service's deploys", "/v1/services/{service_id}/deploys", &["limit"], None, &[])] },
    Row { preset_id: "gitbook.read", name: "GitBook", category: Files, description: "Read your GitBook organisations and spaces.", base_url: "https://api.gitbook.com", auth: BearerToken, key_header: None,
        hint: "Create a personal access token at app.gitbook.com/account/developer.", docs: "https://gitbook.com/docs/developers/gitbook-api/api-reference",
        ops: &[op("user.get", "Read the user", "/v1/user", &[], None, &[]),
               op("orgs.list", "List organisations", "/v1/orgs", &[], Some("/items"), &["/id", "/title"]),
               op("spaces.list", "List an organisation's spaces", "/v1/orgs/{org_id}/spaces", &[], Some("/items"), &["/id", "/title", "/urls/app"])] },
    Row { preset_id: "yelp.read", name: "Yelp API", category: CustomApi, description: "Search local businesses and read reviews.", base_url: "https://api.yelp.com", auth: BearerToken, key_header: None,
        hint: "Create an app at yelp.com/developers and paste its API key.", docs: "https://docs.developer.yelp.com/reference/v3_business_search",
        ops: &[op("businesses.search", "Search businesses", "/v3/businesses/search", &["term", "location", "latitude", "longitude", "limit"], Some("/businesses"), &["/id", "/name", "/rating", "/review_count"]),
               op("reviews.list", "Read a business's reviews", "/v3/businesses/{business_id}/reviews", &["limit"], Some("/reviews"), &["/rating", "/text", "/time_created"])] },
    Row { preset_id: "wrike.read", name: "Wrike", category: ProjectManagement, description: "Read Wrike folders, projects and tasks.", base_url: "https://www.wrike.com", auth: BearerToken, key_header: None,
        hint: "Create a permanent access token in Wrike Apps & Integrations → API.", docs: "https://developers.wrike.com/api/v4/",
        ops: &[op("folders.list", "List folders and projects", "/api/v4/folders", &[], Some("/data"), &["/id", "/title"]),
               op("tasks.list", "List tasks", "/api/v4/tasks", &["status", "limit"], Some("/data"), &["/id", "/title", "/status"])] },
    Row { preset_id: "intercom.read", name: "Intercom", category: Messaging, description: "Read Intercom contacts and conversations.", base_url: "https://api.intercom.io", auth: BearerToken, key_header: None,
        hint: "Create an access token in the Intercom Developer Hub for your workspace with read permissions.", docs: "https://developers.intercom.com/docs/references/rest-api/api.intercom.io",
        ops: &[op("contacts.list", "List contacts", "/contacts", &["per_page"], Some("/data"), &["/id", "/email", "/name"]),
               op("conversations.list", "List conversations", "/conversations", &["per_page"], Some("/conversations"), &["/id", "/state", "/updated_at"])] },
    Row { preset_id: "hubspot.read", name: "HubSpot", category: CustomApi, description: "Read CRM contacts, companies and deals.", base_url: "https://api.hubapi.com", auth: BearerToken, key_header: None,
        hint: "Create a private app in HubSpot settings with crm.objects.*.read scopes and paste its access token.", docs: "https://developers.hubspot.com/docs/api/crm/understanding-the-crm",
        ops: &[op("contacts.list", "List contacts", "/crm/v3/objects/contacts", &["limit", "after", "properties"], Some("/results"), &["/id", "/properties/email", "/properties/firstname"]),
               op("companies.list", "List companies", "/crm/v3/objects/companies", &["limit", "after"], Some("/results"), &["/id", "/properties/name", "/properties/domain"]),
               op("deals.list", "List deals", "/crm/v3/objects/deals", &["limit", "after"], Some("/results"), &["/id", "/properties/dealname", "/properties/amount"])] },
    Row { preset_id: "box.read", name: "Box", category: Files, description: "List folders and files in Box.", base_url: "https://api.box.com", auth: BearerToken, key_header: None,
        hint: "Needs a Box access token (a developer token from your Box app works for testing; it expires after an hour).", docs: "https://developer.box.com/reference/",
        ops: &[op("folder.items", "List a folder's items", "/2.0/folders/{folder_id}/items", &["limit", "offset"], Some("/entries"), &["/id", "/type", "/name"]),
               op("search", "Search content", "/2.0/search", &["query!", "limit"], Some("/entries"), &["/id", "/type", "/name"])] },
    Row { preset_id: "coingecko.read", name: "CoinGecko", category: CustomApi, description: "Read crypto prices and market data (public endpoints).", base_url: "https://api.coingecko.com", auth: NoAuth, key_header: None,
        hint: "No key needed for the public endpoints; they are rate-limited.", docs: "https://docs.coingecko.com/reference/introduction",
        ops: &[op("simple.price", "Read prices", "/api/v3/simple/price", &["ids!", "vs_currencies!"], None, &[]),
               op("coins.markets", "List coins with market data", "/api/v3/coins/markets", &["vs_currency!", "per_page", "page", "order"], None, &[])] },
    Row { preset_id: "worldbank.read", name: "DataBank", category: Database, description: "Read World Bank development indicators (public).", base_url: "https://api.worldbank.org", auth: NoAuth, key_header: None,
        hint: "No key needed. Indicator codes are listed in the World Bank data catalogue (for example NY.GDP.MKTP.CD). Always pass date (2023 or 2015:2023): without it the service takes over 40 seconds and the call times out (measured 2026-11-13).", docs: "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392",
        ops: &[op("indicator.country", "Read an indicator for a country", "/v2/country/{country}/indicator/{indicator}", &["format!", "date", "per_page"], None, &[]),
               op("indicators.search", "List indicators", "/v2/indicator", &["format!", "per_page", "page"], None, &[])] },
    Row { preset_id: "coinbase.read", name: "Coinbase", category: CustomApi, description: "Read public spot prices and exchange rates.", base_url: "https://api.coinbase.com", auth: NoAuth, key_header: None,
        hint: "No key needed for public prices.", docs: "https://docs.cdp.coinbase.com/coinbase-app/docs/api-prices",
        ops: &[op("spot", "Read a spot price", "/v2/prices/{pair}/spot", &[], None, &[]),
               op("rates", "Read exchange rates", "/v2/exchange-rates", &["currency"], None, &[])] },
    Row { preset_id: "cryptocom.read", name: "Crypto.com", category: CustomApi, description: "Read public tickers and order books.", base_url: "https://api.crypto.com", auth: NoAuth, key_header: None,
        hint: "No key needed for public market data.", docs: "https://exchange-docs.crypto.com/exchange/v1/rest-ws/index.html",
        ops: &[op("tickers", "Read tickers", "/exchange/v1/public/get-tickers", &["instrument_name"], None, &[]),
               op("book", "Read an order book", "/exchange/v1/public/get-book", &["instrument_name!", "depth"], None, &[])] },
    Row { preset_id: "kalshi.read", name: "Kalshi API", category: CustomApi, description: "Read public prediction markets and events.", base_url: "https://api.elections.kalshi.com", auth: NoAuth, key_header: None,
        hint: "No key needed for public market data.", docs: "https://docs.kalshi.com/",
        ops: &[op("markets.list", "List markets", "/trade-api/v2/markets", &["limit", "status", "event_ticker"], Some("/markets"), &["/ticker", "/title", "/yes_bid", "/no_bid"]),
               op("events.list", "List events", "/trade-api/v2/events", &["limit", "status"], Some("/events"), &["/event_ticker", "/title"])] },
];
