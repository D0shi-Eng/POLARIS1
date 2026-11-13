// أساس OAuth 2.0: رمز التفويض مع PKCE (S256) ومستمع حلقة محلية، للخدمات التي تقدّم OAuth رسميًّا.
//
// ما يضمنه التصميم: `state` عشوائي من مولّد النظام يُطابَق بمقارنة ثابتة الزمن، و`code_verifier`
// لا يغادر العملية إلا إلى نقطة الرمز، والرموز تُحفظ في مخزن الأسرار وحده (Windows Credential
// Manager) ولا يبقى في القاعدة إلا مرجعها `secret://oauth/<id>`، ولا يصل إلى العارض شيء منها.
// ما لا يفعله أبدًا: كشط صفحة دخول، أو استعمال جلسة متصفّح، أو نقطة نهاية غير موثّقة.
//
// قوالب المزوّدين تحمل نقاط النهاية الموثّقة رسميًّا وحدها؛ معرّف العميل يسجّله المستخدم
// من حسابه لدى المزوّد، فلا تحمل الشيفرة أي معرّف ولا سرّ.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use polaris_host_providers::net::loopback::CallbackListener;
use polaris_host_providers::net::{web_destination, CancelToken, HttpClient, HttpRequest};
use polaris_host_providers::secret::SecretValue;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use url::Url;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p02::ports::CredentialStore;
use crate::p03::clock::RuntimeClock;
use crate::storage::Database;

/// مهلة انتظار عودة المستخدم من صفحة المزوّد.
pub const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);
const CALLBACK_PATH: &str = "/oauth/callback";

/// قالب مزوّد: نقاط النهاية الموثّقة ونطاقات مقترحة. لا معرّف عميل ولا سرّ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OAuthProvider {
    pub provider_id: String,
    pub display_name: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub default_scopes: Vec<String>,
    /// تجهيزة اختبار محلية (بناء القياس والاختبارات وحدها).
    #[serde(skip)]
    pub fixture: bool,
}

/// القوالب المدمجة: مزوّدان يقدّمان OAuth للتطبيقات المكتبية رسميًّا (PKCE وعنوان عودة حلقي).
pub fn builtin_providers() -> Vec<OAuthProvider> {
    vec![
        OAuthProvider {
            provider_id: "google".into(),
            display_name: "Google".into(),
            authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_endpoint: "https://oauth2.googleapis.com/token".into(),
            default_scopes: vec!["openid".into(), "email".into()],
            fixture: false,
        },
        OAuthProvider {
            provider_id: "microsoft".into(),
            display_name: "Microsoft".into(),
            authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize".into(),
            token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token".into(),
            default_scopes: vec!["offline_access".into(), "User.Read".into()],
            fixture: false,
        },
    ]
}

/// عشوائية من مولّد نظام التشغيل، بترميز base64url بلا حشو.
pub fn random_token(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| format!("the system random generator failed: {e}"))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf))
}

/// تحدّي PKCE بطريقة S256 (RFC 7636).
pub fn pkce_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// مقارنة ثابتة الزمن بالنسبة للمحتوى.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn form_encode(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{}={}", url::form_urlencoded::byte_serialize(k.as_bytes()).collect::<String>(), url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>())).collect::<Vec<_>>().join("&")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectionView {
    pub connection_id: String,
    pub provider_id: String,
    pub display_name: String,
    pub client_id: String,
    pub scopes: String,
    /// مرجع السرّ لا قيمته.
    pub token_ref: Option<String>,
    pub status: String,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// ما يُعاد عند البدء: عنوان التفويض يفتحه المستخدم في متصفّحه.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BeginResult {
    pub connection_id: String,
    pub authorization_url: String,
    pub redirect_uri: String,
    pub opened_in_browser: bool,
}

/// فتح عنوان في متصفّح النظام. تقدّمه المنصّة؛ غيابه يعني أن العارض يعرض العنوان للمستخدم.
pub trait UrlOpener: Send + Sync {
    fn open(&self, url: &str) -> bool;
}

pub struct OAuthService {
    db: Arc<Database>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
    http: Arc<HttpClient>,
    store: Arc<dyn CredentialStore>,
    opener: Option<Arc<dyn UrlOpener>>,
    providers: Mutex<Vec<OAuthProvider>>,
}

fn target(connection_id: &str, kind: &str) -> String {
    format!("POLARIS/oauth/{connection_id}/{kind}")
}

impl OAuthService {
    pub fn new(db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock, http: Arc<HttpClient>, store: Arc<dyn CredentialStore>, opener: Option<Arc<dyn UrlOpener>>) -> Self {
        Self { db, audit, clock, http, store, opener, providers: Mutex::new(builtin_providers()) }
    }

    /// يضيف مزوّد تجهيزة محليًّا. للاختبار وبناء القياس وحدهما.
    pub fn add_fixture_provider(&self, provider: OAuthProvider) {
        if let Ok(mut p) = self.providers.lock() {
            p.retain(|x| x.provider_id != provider.provider_id);
            p.push(OAuthProvider { fixture: true, ..provider });
        }
    }

    pub fn providers(&self) -> Vec<OAuthProvider> {
        self.providers.lock().map(|p| p.clone()).unwrap_or_default()
    }

    fn provider(&self, id: &str) -> Option<OAuthProvider> {
        self.providers().into_iter().find(|p| p.provider_id == id)
    }

    fn set_status(&self, connection_id: &str, status: &str, token_ref: Option<&str>, expires_at: Option<&str>) {
        let _ = self.db.with(|c| {
            c.execute(
                "UPDATE p08_oauth_connections SET status = ?2, token_ref = COALESCE(?3, token_ref), expires_at = ?4, updated_at = ?5 WHERE connection_id = ?1",
                params![connection_id, status, token_ref, expires_at, self.clock.now()],
            )?;
            Ok(())
        });
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::OAuthConnectionChanged,
            "oauth_connection",
            connection_id,
            if status == "CONNECTED" { AuditOutcome::Success } else if status == "FAILED" { AuditOutcome::Failure } else { AuditOutcome::Started },
            serde_json::json!({ "status": status }),
        ));
    }

    /// يبدأ الربط: يسجّل اتصالًا منتظرًا، ويفتح مستمعًا حلقيًّا، ويعيد عنوان التفويض.
    /// الانتظار والتبادل يجريان في خيط، ونتيجتهما تظهر في حالة الاتصال.
    pub fn begin(self: &Arc<Self>, provider_id: &str, client_id: &str, scopes: &[String]) -> Result<BeginResult, String> {
        let provider = self.provider(provider_id).ok_or("no such OAuth provider")?;
        if client_id.trim().is_empty() || client_id.len() > 200 || client_id.chars().any(char::is_whitespace) {
            return Err("the client id is not valid".into());
        }
        let scopes: Vec<String> = if scopes.is_empty() { provider.default_scopes.clone() } else { scopes.to_vec() };
        if scopes.iter().any(|s| s.is_empty() || s.len() > 200 || s.contains(char::is_whitespace)) {
            return Err("a scope is not valid".into());
        }
        let listener = CallbackListener::bind().map_err(|e| format!("the loopback listener could not start: {e}"))?;
        let redirect_uri = format!("http://127.0.0.1:{}{CALLBACK_PATH}", listener.port());
        let state = random_token(32)?;
        let verifier = random_token(48)?;
        let challenge = pkce_challenge(&verifier);
        let mut url = Url::parse(&provider.authorization_endpoint).map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("scope", &scopes.join(" "))
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256");
        let connection_id = self.clock.id();
        let now = self.clock.now();
        self.db
            .with(|c| {
                c.execute(
                    "INSERT INTO p08_oauth_connections (connection_id, provider_id, display_name, client_id, scopes, token_ref, status, expires_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'PENDING', NULL, ?6, ?6)",
                    params![connection_id, provider.provider_id, provider.display_name, client_id, scopes.join(" "), now],
                )?;
                Ok(())
            })
            .map_err(|e| e.to_string())?;
        let is_fixture = provider.fixture;
        let service = Arc::clone(self);
        let (cid, client, redirect) = (connection_id.clone(), client_id.to_string(), redirect_uri.clone());
        std::thread::spawn(move || {
            let outcome = service.await_callback(&listener, &provider, &cid, &client, &redirect, &state, &verifier);
            if let Err(detail) = outcome {
                service.set_status(&cid, "FAILED", None, None);
                let _ = service.audit.append(&AuditRecord::new(AuditEventType::OAuthConnectionChanged, "oauth_connection", &cid, AuditOutcome::Failure, serde_json::json!({ "reason": detail.chars().take(200).collect::<String>() })));
            }
        });
        let url_text = url.to_string();
        let opened = self.opener.as_ref().is_some_and(|o| !is_fixture && o.open(&url_text));
        Ok(BeginResult { connection_id, authorization_url: url_text, redirect_uri, opened_in_browser: opened })
    }

    #[allow(clippy::too_many_arguments)]
    fn await_callback(&self, listener: &CallbackListener, provider: &OAuthProvider, connection_id: &str, client_id: &str, redirect_uri: &str, state: &str, verifier: &str) -> Result<(), String> {
        let page = "<!doctype html><meta charset=utf-8><title>POLARIS</title><p>POLARIS received the authorization. You can close this window.</p>";
        let target_path = listener.accept_one(CALLBACK_PATH, Instant::now() + CALLBACK_TIMEOUT, &CancelToken::new(), page).map_err(|e| e.to_string())?;
        let url = Url::parse(&format!("http://127.0.0.1{target_path}")).map_err(|e| e.to_string())?;
        let pairs: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        let get = |k: &str| pairs.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
        if let Some(error) = get("error") {
            return Err(format!("the provider returned {error}"));
        }
        // state أولًا: ردّ بلا state مطابق لا يُستعمل رمزه أبدًا (حماية CSRF).
        let returned = get("state").unwrap_or_default();
        if !constant_time_eq(&returned, state) {
            return Err("STATE_MISMATCH".into());
        }
        let code = get("code").filter(|c| !c.is_empty() && c.len() <= 4096).ok_or("no authorization code")?;
        let body = form_encode(&[("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", redirect_uri), ("client_id", client_id), ("code_verifier", verifier)]);
        let tokens = self.token_request(provider, body)?;
        self.store_tokens(connection_id, &tokens)
    }

    fn token_request(&self, provider: &OAuthProvider, body: String) -> Result<serde_json::Value, String> {
        let url = Url::parse(&provider.token_endpoint).map_err(|e| e.to_string())?;
        let endpoint = web_destination(&url, provider.fixture).map_err(|e| format!("the token endpoint is not allowed: {e:?}"))?;
        let mut path = url.path().to_string();
        if let Some(q) = url.query() {
            path.push('?');
            path.push_str(q);
        }
        let request = HttpRequest {
            idle: None,
            method: "POST",
            path,
            headers: vec![("Content-Type", "application/x-www-form-urlencoded".into()), ("Accept", "application/json".into())],
            body: Some(body.into_bytes()),
            deadline: Instant::now() + Duration::from_secs(30),
        };
        let mut response = self.http.send(&endpoint, request, &CancelToken::new()).map_err(|e| format!("the token request failed: {:?}", e.kind))?;
        let bytes = response.body.read_all(256 * 1024).map_err(|e| format!("the token response could not be read: {:?}", e.kind))?;
        if response.status != 200 {
            return Err(format!("the token endpoint answered {}", response.status));
        }
        serde_json::from_slice(&bytes).map_err(|_| "the token response is not JSON".into())
    }

    fn store_tokens(&self, connection_id: &str, tokens: &serde_json::Value) -> Result<(), String> {
        let access = tokens.get("access_token").and_then(|v| v.as_str()).ok_or("the token response holds no access token")?;
        let secret = SecretValue::new(access.to_string()).ok_or("the access token is empty or too long")?;
        self.store.write(&target(connection_id, "access"), &secret).map_err(|e| format!("the credential store refused the token: {e:?}"))?;
        if let Some(refresh) = tokens.get("refresh_token").and_then(|v| v.as_str()).and_then(|r| SecretValue::new(r.to_string())) {
            self.store.write(&target(connection_id, "refresh"), &refresh).map_err(|e| format!("the credential store refused the token: {e:?}"))?;
        }
        let expires = tokens.get("expires_in").and_then(|v| v.as_u64()).map(|s| crate::time::format_rfc3339_utc((self.clock.now_millis() / 1000) as i64 + s as i64));
        self.set_status(connection_id, "CONNECTED", Some(&format!("secret://oauth/{connection_id}")), expires.as_deref());
        Ok(())
    }

    /// يجدّد رمز الوصول برمز التجديد. لا يعيد الرمز: يحفظه ويعيد الحالة.
    pub fn refresh(&self, connection_id: &str) -> Result<ConnectionView, String> {
        let view = self.get(connection_id)?.ok_or("no such connection")?;
        let provider = self.provider(&view.provider_id).ok_or("the provider is no longer known")?;
        let refresh = self.store.read(&target(connection_id, "refresh")).map_err(|e| format!("{e:?}"))?.ok_or("no refresh token is stored")?;
        let body = form_encode(&[("grant_type", "refresh_token"), ("refresh_token", refresh.expose()), ("client_id", &view.client_id)]);
        drop(refresh);
        match self.token_request(&provider, body).and_then(|t| self.store_tokens(connection_id, &t)) {
            Ok(()) => {}
            Err(e) => {
                self.set_status(connection_id, "EXPIRED", None, None);
                return Err(e);
            }
        }
        self.get(connection_id)?.ok_or_else(|| "the connection vanished".into())
    }

    /// رمز الوصول لموصل موثوق داخل المضيف. لا يعبر IPC ولا يصل إلى نموذج.
    pub fn access_token(&self, connection_id: &str) -> Result<SecretValue, String> {
        self.store.read(&target(connection_id, "access")).map_err(|e| format!("{e:?}"))?.ok_or_else(|| "the connection holds no access token".into())
    }

    pub fn revoke(&self, connection_id: &str) -> Result<bool, String> {
        let _ = self.store.delete(&target(connection_id, "access"));
        let _ = self.store.delete(&target(connection_id, "refresh"));
        let exists = self.get(connection_id)?.is_some();
        if exists {
            self.set_status(connection_id, "REVOKED", None, None);
        }
        Ok(exists)
    }

    fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionView> {
        Ok(ConnectionView {
            connection_id: r.get(0)?,
            provider_id: r.get(1)?,
            display_name: r.get(2)?,
            client_id: r.get(3)?,
            scopes: r.get(4)?,
            token_ref: r.get(5)?,
            status: r.get(6)?,
            expires_at: r.get(7)?,
            created_at: r.get(8)?,
            updated_at: r.get(9)?,
        })
    }

    pub fn get(&self, connection_id: &str) -> Result<Option<ConnectionView>, String> {
        self.db
            .with(|c| Ok(c.query_row("SELECT connection_id, provider_id, display_name, client_id, scopes, token_ref, status, expires_at, created_at, updated_at FROM p08_oauth_connections WHERE connection_id = ?1", params![connection_id], Self::row).optional()?))
            .map_err(|e| e.to_string())
    }

    pub fn list(&self) -> Result<Vec<ConnectionView>, String> {
        self.db
            .with(|c| {
                let mut s = c.prepare("SELECT connection_id, provider_id, display_name, client_id, scopes, token_ref, status, expires_at, created_at, updated_at FROM p08_oauth_connections ORDER BY created_at DESC")?;
                let rows = s.query_map([], Self::row)?.collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_the_rfc_7636_appendix_b_vector() {
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn random_tokens_are_distinct_and_url_safe() {
        let a = random_token(32).unwrap();
        let b = random_token(32).unwrap();
        assert_ne!(a, b);
        assert_eq!(a.len(), 43);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert!(constant_time_eq(&a, &a.clone()));
        assert!(!constant_time_eq(&a, &b));
    }

    #[test]
    fn builtin_templates_carry_no_client_identifier_or_secret() {
        for p in builtin_providers() {
            assert!(p.authorization_endpoint.starts_with("https://") && p.token_endpoint.starts_with("https://"));
            let text = serde_json::to_string(&p).unwrap().to_lowercase();
            assert!(!text.contains("client_id") && !text.contains("secret"));
        }
    }
}
