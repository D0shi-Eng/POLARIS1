// بحث الويب من الإعدادات (ADR-042، تكليف 2026-10-19): المزوّد المختار وحالته، ومفتاح المزوّد، واختبار اتصال حقيقي.
//
// كان خادم SearXNG يُضبط عبر IPC وحدها ولا واجهة له. هنا ما تحتاجه صفحة «بحث الويب»: الحالة بلا شبكة، والمفتاح يُكتب في مخزن
// الاعتماد ولا يعود أبدًا، والاختبار يرسل بحثًا واحدًا بنصّ ثابت محايد عبر المسار نفسه الذي تسلكه أداة الوكيل.

use std::sync::Arc;
use std::time::{Duration, Instant};

use polaris_host_providers::net::{CancelToken, HttpClient};
use polaris_host_providers::secret::SecretValue;
use serde::Serialize;

use super::integrations::settings::Phase08Settings;
use super::web_search::{chosen_provider, SearchProvider, SearchRoute, BRAVE_CREDENTIAL_TARGET, SETTING_ENDPOINT};
use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p02::ports::CredentialStore;
use crate::p04::adapter::ToolFailure;

/// نصّ الاختبار: ثابت ومحايد، لا يحمل شيئًا من بيانات المستخدم.
const TEST_QUERY: &str = "POLARIS desktop agent";
const TEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WebSearchStatus {
    pub provider: &'static str,
    pub ready: bool,
    pub searxng_endpoint_configured: bool,
    pub brave_key_configured: bool,
    pub secure_store_available: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WebSearchTest {
    pub provider: &'static str,
    pub outcome: &'static str,
    pub results: u32,
    pub duration_ms: u64,
}

pub struct WebSearchService {
    http: Arc<HttpClient>,
    settings: Arc<Phase08Settings>,
    store: Arc<dyn CredentialStore>,
    audit: Arc<AuditLedger>,
    fixture: Option<String>,
}

/// رمز النتيجة من خطأ المسار. الرموز مغلقة ومطابقة لعقد `WebSearchTestResultV1`.
fn outcome_of(failure: &ToolFailure) -> &'static str {
    let text = format!("{failure:?}");
    for (marker, code) in [
        ("WEB_SEARCH_NOT_CONFIGURED", "NOT_CONFIGURED"),
        ("WEB_SEARCH_AUTH_FAILED", "AUTH_FAILED"),
        ("WEB_SEARCH_RATE_LIMITED", "RATE_LIMITED"),
        ("WEB_SEARCH_TIMEOUT", "TIMEOUT"),
        ("WEB_SEARCH_UNREACHABLE", "UNREACHABLE"),
        ("WEB_SEARCH_NOT_LOCAL", "UNREACHABLE"),
        ("WEB_SEARCH_UNREADABLE", "MALFORMED"),
        ("WEB_SEARCH_REFUSED", "REFUSED"),
    ] {
        if text.contains(marker) {
            return code;
        }
    }
    if matches!(failure, ToolFailure::ResultMalformed(_)) {
        "MALFORMED"
    } else {
        "REFUSED"
    }
}

impl WebSearchService {
    pub fn new(http: Arc<HttpClient>, settings: Arc<Phase08Settings>, store: Arc<dyn CredentialStore>, audit: Arc<AuditLedger>, fixture: Option<String>) -> Self {
        Self { http, settings, store, audit, fixture }
    }

    /// الحالة بلا شبكة: ما اختاره المستخدم، وهل لدى المزوّد ما يحتاجه. المفتاح يُقال «موجود» أو «غائب» فقط.
    pub fn status(&self) -> WebSearchStatus {
        let provider = chosen_provider(&self.settings);
        let secure_store_available = self.store.available();
        let brave_key_configured = secure_store_available && self.store.read(BRAVE_CREDENTIAL_TARGET).ok().flatten().is_some();
        let searxng_endpoint_configured = self.settings.get_str(SETTING_ENDPOINT).is_some();
        let ready = match provider {
            SearchProvider::None => false,
            SearchProvider::Searxng => searxng_endpoint_configured,
            SearchProvider::Brave => brave_key_configured,
        };
        WebSearchStatus { provider: provider.as_str(), ready, searxng_endpoint_configured, brave_key_configured, secure_store_available }
    }

    /// يحفظ مفتاح Brave في مخزن الاعتماد، أو يحذفه حين `None`. لا يعيد المفتاح، ولا يكتبه في القاعدة ولا في التدقيق.
    pub fn put_brave_key(&self, key: Option<String>) -> Result<WebSearchStatus, String> {
        if !self.store.available() {
            return Err("CREDENTIAL_STORE_UNAVAILABLE: the operating system credential store is unavailable".into());
        }
        let (event, outcome) = match key {
            Some(text) => {
                let secret = SecretValue::new(text).ok_or("the key is empty or too long")?;
                self.store.write(BRAVE_CREDENTIAL_TARGET, &secret).map_err(|e| format!("the credential store refused the key: {e:?}"))?;
                (AuditEventType::ConnectorCredentialSet, AuditOutcome::Success)
            }
            None => {
                self.store.delete(BRAVE_CREDENTIAL_TARGET).map_err(|e| format!("the credential store refused the deletion: {e:?}"))?;
                (AuditEventType::ConnectorCredentialCleared, AuditOutcome::Success)
            }
        };
        let _ = self.audit.append(&AuditRecord::new(event, "connector", "web-search.brave", outcome, serde_json::json!({ "store": "OS_CREDENTIAL_STORE" })));
        Ok(self.status())
    }

    /// بحث اختبار واحد عبر المسار نفسه الذي تسلكه الأداة. أثر شبكي يطلبه المستخدم بزرّ؛ نصّ البحث ثابت.
    pub fn test(&self) -> WebSearchTest {
        let route = SearchRoute { http: &self.http, settings: &self.settings, store: self.store.as_ref(), fixture: self.fixture.as_deref() };
        let started = Instant::now();
        let outcome = route.search(TEST_QUERY, None, 5, TEST_TIMEOUT, &CancelToken::new());
        let duration_ms = started.elapsed().as_millis() as u64;
        let provider = chosen_provider(&self.settings).as_str();
        let result = match &outcome {
            Ok((_, hits)) => WebSearchTest { provider, outcome: "OK", results: hits.len() as u32, duration_ms },
            Err(failure) => WebSearchTest { provider, outcome: outcome_of(failure), results: 0, duration_ms },
        };
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::ConnectorHealthChecked,
            "connector",
            "web-search",
            if result.outcome == "OK" { AuditOutcome::Success } else { AuditOutcome::Failure },
            serde_json::json!({ "provider": provider, "outcome": result.outcome, "results": result.results, "duration_ms": duration_ms }),
        ));
        result
    }
}
