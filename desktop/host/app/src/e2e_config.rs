// إعداد مجموعة E2E الخاصة بـPhase-02. يُترجَم مع الميزة `e2e` وحدها.
//
// المشغّل الأصلي يمرّر عبر البيئة: اسم المرحلة، ومنفذ تجهيزة الاختبار المحلية،
// ومنفذًا مغلقًا، ومجلد مساحة عمل مؤقتًا. كل قيمة تُتحقق قبل أن تدخل النافذة:
// المرحلة من قائمة مغلقة، والمنافذ أعداد، والمسار مطلق وموجود. ما لا يصلح يُسقط
// ولا يُمرَّر. والنص يُبنى بـserde فلا حقن في السكربت.

use serde_json::{json, Value};

const SUITE_ENV: &str = "POLARIS_E2E_SUITE";
const FIXTURE_PORT_ENV: &str = "POLARIS_E2E_FIXTURE_PORT";
const CLOSED_PORT_ENV: &str = "POLARIS_E2E_CLOSED_PORT";
const WORKSPACE_ENV: &str = "POLARIS_E2E_WORKSPACE";
const MARKER_ENV: &str = "POLARIS_E2E_MARKER";
/// منفذ تجهيزة خادم الأدوات المحلية (MCP). منفصل عن منفذ تجهيزة المزوّد عمدًا:
/// خلطهما يجعل نداء نموذج ونداء أداة يبدوان طريقًا واحدًا وهما طريقان.
const MCP_PORT_ENV: &str = "POLARIS_E2E_MCP_PORT";
/// منفذ يستمع ويصمت. يُستعمل لقياس المهلة على مسار MCP الحقيقي.
const SLOW_PORT_ENV: &str = "POLARIS_E2E_MCP_SLOW_PORT";

fn port(name: &str) -> Option<u16> {
    std::env::var(name).ok()?.trim().parse::<u16>().ok().filter(|p| *p > 0)
}

fn marker() -> Option<String> {
    let value = std::env::var(MARKER_ENV).ok()?;
    let ok = !value.is_empty() && value.len() <= 64 && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    ok.then_some(value)
}

fn workspace() -> Option<String> {
    let value = std::env::var(WORKSPACE_ENV).ok()?;
    let path = std::path::Path::new(&value);
    (path.is_absolute() && path.is_dir()).then_some(value)
}

/// إعداد Phase-02، أو `None` حين لا تُطلب مجموعة Phase-02 (فتعمل مجموعة Phase-01).
pub fn phase02_suite() -> Option<Value> {
    build(
        std::env::var(SUITE_ENV).ok().as_deref(),
        port(FIXTURE_PORT_ENV),
        port(CLOSED_PORT_ENV),
        workspace(),
        marker(),
    )
}

/// منفذ تجهيزة الويب (Phase-05). أصل الحلقة المحلية الوحيد الذي تسمح به سياسة التنقّل
/// في بناء القياس.
const WEB_PORT_ENV: &str = "POLARIS_E2E_WEB_PORT";
/// معرّف عملية نافذة تجهيزة سطح المكتب التي يملكها المشغّل.
const DESKTOP_PID_ENV: &str = "POLARIS_E2E_DESKTOP_PID";

pub fn web_fixture_port() -> Option<u16> {
    port(WEB_PORT_ENV)
}

fn desktop_pid() -> Option<u32> {
    std::env::var(DESKTOP_PID_ENV).ok()?.trim().parse::<u32>().ok().filter(|p| *p > 0)
}

/// إعداد Phase-05، أو `None` حين لا تُطلب مجموعة Phase-05.
pub fn phase05_suite() -> Option<Value> {
    build_p05(std::env::var(SUITE_ENV).ok().as_deref(), port(FIXTURE_PORT_ENV), web_fixture_port(), desktop_pid(), marker())
}

/// التركيب النقي لإعداد Phase-05. المرحلة من قائمة مغلقة، والنقاط حلقة محلية فقط.
fn build_p05(stage: Option<&str>, fixture: Option<u16>, web: Option<u16>, desktop_pid: Option<u32>, marker: Option<String>) -> Option<Value> {
    let stage = stage.filter(|s| *s == "p05-first" || *s == "p05-restart")?;
    Some(json!({
        "stage": stage,
        "fixture_endpoint": fixture.map(|p| format!("http://127.0.0.1:{p}")),
        "web_endpoint": web.map(|p| format!("http://127.0.0.1:{p}")),
        "desktop_pid": desktop_pid,
        "marker": marker,
    }))
}

/// منفذ موصل الاختبار (Phase-06): خدمة REST حتمية على الحلقة المحلية — TEST FIXTURE.
const CONNECTOR_PORT_ENV: &str = "POLARIS_E2E_CONNECTOR_PORT";

/// إعداد Phase-06، أو `None` حين لا تُطلب مجموعة Phase-06.
pub fn phase06_suite() -> Option<Value> {
    build_p06(std::env::var(SUITE_ENV).ok().as_deref(), port(FIXTURE_PORT_ENV), port(CONNECTOR_PORT_ENV), workspace(), marker())
}

/// التركيب النقي لإعداد Phase-06. المرحلة من قائمة مغلقة، والنقاط حلقة محلية فقط. مفتاح
/// الموصل لا يدخل هذا الإعداد أبدًا: يُقرأ من بيئة المضيف باسمه، ولا يراه العارض.
fn build_p06(stage: Option<&str>, fixture: Option<u16>, connector: Option<u16>, workspace: Option<String>, marker: Option<String>) -> Option<Value> {
    let stage = stage.filter(|s| *s == "p06-first" || *s == "p06-restart")?;
    Some(json!({
        "stage": stage,
        "fixture_endpoint": fixture.map(|p| format!("http://127.0.0.1:{p}")),
        "connector_base": connector.map(|p| format!("http://127.0.0.1:{p}/api")),
        "workspace": workspace,
        "marker": marker,
    }))
}

/// نموذج محلي حقيقي تسمّيه طبقة القياس لمجموعة Phase-08 (بصيغة `<provider>:<model>`).
const P08_MODEL_ENV: &str = "POLARIS_E2E_P08_MODEL";

/// معرّف نموذج بصيغة العقد: `<provider>:<model>` بمحارف مسموحة فقط؛ غيره يُسقط.
fn p08_model() -> Option<String> {
    let value = std::env::var(P08_MODEL_ENV).ok()?;
    let (provider, model) = value.split_once(':')?;
    let provider_ok = (2..=48).contains(&provider.len()) && provider.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    let model_ok = (1..=200).contains(&model.len()) && model.chars().all(|c| c.is_ascii_graphic() && !matches!(c, '"' | '\'' | '<' | '>' | '\\' | '`'));
    (provider_ok && model_ok).then_some(value)
}

/// إعداد Phase-08، أو `None` حين لا تُطلب مجموعته.
pub fn phase08_suite() -> Option<Value> {
    build_p08(std::env::var(SUITE_ENV).ok().as_deref(), web_fixture_port(), p08_model(), marker())
}

/// التركيب النقي لإعداد Phase-08: المرحلة من قائمة مغلقة، والموقع حلقة محلية، والنموذج بصيغة العقد.
fn build_p08(stage: Option<&str>, web: Option<u16>, model: Option<String>, marker: Option<String>) -> Option<Value> {
    let stage = stage.filter(|s| *s == "p08-first" || *s == "p08-restart")?;
    Some(json!({
        "stage": stage,
        "web_endpoint": web.map(|p| format!("http://127.0.0.1:{p}")),
        "model_id": model,
        "marker": marker,
    }))
}

/// إعداد Phase-04، أو `None` حين لا تُطلب مجموعة Phase-04.
pub fn phase04_suite() -> Option<Value> {
    build_p04(
        std::env::var(SUITE_ENV).ok().as_deref(),
        port(FIXTURE_PORT_ENV),
        port(MCP_PORT_ENV),
        port(SLOW_PORT_ENV),
        marker(),
    )
}

/// التركيب النقي لإعداد Phase-04. المرحلة من قائمة مغلقة، وكل نقطة حلقة محلية.
fn build_p04(
    stage: Option<&str>,
    fixture: Option<u16>,
    mcp: Option<u16>,
    slow: Option<u16>,
    marker: Option<String>,
) -> Option<Value> {
    let stage = stage.filter(|s| *s == "p04-first" || *s == "p04-restart")?;
    Some(json!({
        "stage": stage,
        "fixture_endpoint": fixture.map(|p| format!("http://127.0.0.1:{p}")),
        "mcp_endpoint": mcp.map(|p| format!("http://127.0.0.1:{p}/mcp")),
        "slow_endpoint": slow.map(|p| format!("http://127.0.0.1:{p}/mcp")),
        "marker": marker,
    }))
}

/// إعداد Phase-03، أو `None` حين لا تُطلب مجموعة Phase-03.
pub fn phase03_suite() -> Option<Value> {
    build_p03(
        std::env::var(SUITE_ENV).ok().as_deref(),
        port(FIXTURE_PORT_ENV),
        workspace(),
        marker(),
    )
}

/// التركيب النقي لإعداد Phase-03. المرحلة من قائمة مغلقة، والنقطة حلقة محلية فقط.
fn build_p03(stage: Option<&str>, fixture: Option<u16>, workspace: Option<String>, marker: Option<String>) -> Option<Value> {
    let stage = stage.filter(|s| *s == "p03-first" || *s == "p03-restart")?;
    Some(json!({
        "stage": stage,
        "fixture_endpoint": fixture.map(|p| format!("http://127.0.0.1:{p}")),
        "workspace": workspace,
        "marker": marker,
    }))
}

/// التركيب النقي: المرحلة من قائمة مغلقة، وكل ما عداها قيم مُتحقَّقة سلفًا.
fn build(stage: Option<&str>, fixture: Option<u16>, closed: Option<u16>, workspace: Option<String>, marker: Option<String>) -> Option<Value> {
    let stage = stage.filter(|s| *s == "p02-first" || *s == "p02-restart")?;
    Some(json!({
        "stage": stage,
        "fixture_endpoint": fixture.map(|p| format!("http://127.0.0.1:{p}")),
        "closed_endpoint": closed.map(|p| format!("http://127.0.0.1:{p}")),
        "workspace": workspace,
        "marker": marker,
    }))
}

/// السكربت الذي يُحقن قبل تحميل الصفحة.
pub fn init_script() -> String {
    let mut script = script_for_all(phase02_suite(), phase03_suite(), phase04_suite());
    if let Some(config) = phase05_suite() {
        script.push_str(&format!(" window.__POLARIS_E2E_P05__ = Object.freeze({config});"));
    }
    if let Some(config) = phase06_suite() {
        script.push_str(&format!(" window.__POLARIS_E2E_P06__ = Object.freeze({config});"));
    }
    if let Some(config) = phase08_suite() {
        script.push_str(&format!(" window.__POLARIS_E2E_P08__ = Object.freeze({config});"));
    }
    if let Some(config) = qa_suite() {
        script.push_str(&format!(" window.__POLARIS_E2E_QA__ = Object.freeze({config});"));
    }
    script
}

/// مجموعة QA للعناصر التفاعلية (2026-10-15)، أو `None` حين لا تُطلب.
pub fn qa_suite() -> Option<Value> {
    build_qa(std::env::var(SUITE_ENV).ok().as_deref(), marker())
}

/// المرحلة من قائمة مغلقة؛ لا مسار ولا منفذ يدخل النافذة.
fn build_qa(stage: Option<&str>, marker: Option<String>) -> Option<Value> {
    let stage = stage.filter(|s| *s == "qa-controls")?;
    Some(json!({ "stage": stage, "marker": marker }))
}

fn script_for_all(p02: Option<Value>, p03: Option<Value>, p04: Option<Value>) -> String {
    let mut script = String::from("window.__POLARIS_E2E__ = true;");
    if let Some(config) = p02 {
        // `to_string` يهرّب كل محرف خاص، فلا تستطيع قيمة أن تكسر السكربت.
        script.push_str(&format!(" window.__POLARIS_E2E_P02__ = Object.freeze({config});"));
    }
    if let Some(config) = p03 {
        script.push_str(&format!(" window.__POLARIS_E2E_P03__ = Object.freeze({config});"));
    }
    if let Some(config) = p04 {
        script.push_str(&format!(" window.__POLARIS_E2E_P04__ = Object.freeze({config});"));
    }
    script
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_a_suite_only_the_phase_one_flag_is_set() {
        assert_eq!(script_for_all(build(None, Some(1), None, None, None), None, None), "window.__POLARIS_E2E__ = true;");
    }

    #[test]
    fn the_phase_eight_suite_takes_only_its_own_stages() {
        assert!(build_p08(Some("p08-first"), Some(9), Some("local-openai-compatible:fixture-chat".into()), None).is_some());
        assert!(build_p08(Some("p06-first"), Some(9), None, None).is_none());
        let v = build_p08(Some("p08-restart"), None, None, None).unwrap();
        assert!(v["web_endpoint"].is_null() && v["model_id"].is_null());
    }

    #[test]
    fn an_unknown_stage_is_dropped() {
        assert!(build(Some("p02-anything"), Some(1), None, None, None).is_none());
    }

    #[test]
    fn a_phase_three_stage_is_recognised_and_an_unknown_one_is_not() {
        assert!(build_p03(Some("p03-first"), Some(4100), None, Some("run1".into())).is_some());
        assert!(build_p03(Some("p03-restart"), Some(4100), None, None).is_some());
        assert!(build_p03(Some("p03-whatever"), Some(4100), None, None).is_none());
        // مرحلة Phase-02 لا تُفعّل مجموعة Phase-03 بالمصادفة.
        assert!(build_p03(Some("p02-first"), Some(4100), None, None).is_none());
    }

    #[test]
    fn a_phase_three_configuration_carries_only_a_loopback_endpoint() {
        let config = build_p03(Some("p03-first"), Some(4100), None, None).unwrap();
        assert_eq!(config["fixture_endpoint"], "http://127.0.0.1:4100");
        let script = script_for_all(None, Some(config), None);
        assert!(script.contains("__POLARIS_E2E_P03__"));
        assert!(!script.contains("__POLARIS_E2E_P02__"));
    }

    #[test]
    fn a_phase_four_stage_is_recognised_and_an_unknown_one_is_not() {
        assert!(build_p04(Some("p04-first"), Some(4100), Some(4200), Some(4300), Some("run1".into())).is_some());
        assert!(build_p04(Some("p04-restart"), Some(4100), Some(4200), None, None).is_some());
        assert!(build_p04(Some("p04-whatever"), Some(4100), None, None, None).is_none());
        // مرحلة أخرى لا تُفعّل مجموعة Phase-04 بالمصادفة.
        assert!(build_p04(Some("p03-first"), Some(4100), None, None, None).is_none());
        assert!(build_p04(Some("p02-first"), Some(4100), None, None, None).is_none());
    }

    #[test]
    fn a_phase_four_configuration_carries_only_loopback_endpoints() {
        let config = build_p04(Some("p04-first"), Some(4100), Some(4200), Some(4300), None).unwrap();
        assert_eq!(config["fixture_endpoint"], "http://127.0.0.1:4100");
        assert_eq!(config["mcp_endpoint"], "http://127.0.0.1:4200/mcp");
        assert_eq!(config["slow_endpoint"], "http://127.0.0.1:4300/mcp");
        let script = script_for_all(None, None, Some(config));
        assert!(script.contains("__POLARIS_E2E_P04__"));
        assert!(!script.contains("__POLARIS_E2E_P03__"));
        assert!(!script.contains("__POLARIS_E2E_P02__"));
    }

    #[test]
    fn a_phase_five_stage_is_recognised_and_carries_only_loopback_endpoints() {
        let config = build_p05(Some("p05-first"), Some(4100), Some(4500), Some(77), Some("run1".into())).unwrap();
        assert_eq!(config["web_endpoint"], "http://127.0.0.1:4500");
        assert_eq!(config["desktop_pid"], 77);
        assert!(build_p05(Some("p04-first"), Some(4100), Some(4500), None, None).is_none());
        assert!(build_p05(Some("p05-anything"), Some(4100), None, None, None).is_none());
    }

    #[test]
    fn a_phase_six_stage_is_recognised_and_carries_only_loopback_endpoints_and_no_key() {
        let config = build_p06(Some("p06-first"), Some(4100), Some(4600), None, Some("run1".into())).unwrap();
        assert_eq!(config["fixture_endpoint"], "http://127.0.0.1:4100");
        assert_eq!(config["connector_base"], "http://127.0.0.1:4600/api");
        assert!(config.get("token").is_none() && !config.to_string().to_lowercase().contains("token"));
        assert!(build_p06(Some("p06-restart"), None, None, None, None).is_some());
        assert!(build_p06(Some("p05-first"), Some(4100), Some(4600), None, None).is_none());
        assert!(build_p06(Some("p06-anything"), Some(4100), None, None, None).is_none());
    }

    #[test]
    fn a_known_stage_carries_only_loopback_endpoints() {
        let config = build(Some("p02-first"), Some(4100), Some(4101), None, Some("abc".into())).unwrap();
        assert_eq!(config["fixture_endpoint"], "http://127.0.0.1:4100");
        assert_eq!(config["closed_endpoint"], "http://127.0.0.1:4101");
        let script = script_for_all(Some(json!({ "stage": "p02-first", "workspace": "x\");alert(1);//" })), None, None);
        // الاقتباس مهرَّب داخل سلسلة JSON، فلا يخرج من القيمة.
        assert!(script.contains(r#""x\");alert(1);//""#));
    }
}
