// تركيب Phase-06 وعملياته. لا منطق إنفاذ هنا: الإنفاذ في بوابة الموصلات، وحارس النماذج،
// والسياسة المركَّبة، ومحلِّل الإعدادات. ما هنا ترتيب النداءات وبناء المستندات.

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use serde::Serialize;
use serde_json::Value;

use polaris_host_providers::net::HttpClient;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p02::context::SourceService;
use crate::p02::ports::{CredentialPrompt, CredentialStore, Environment};
use crate::p02::Phase02;
use crate::p03::cancel::MissionCancellation;
use crate::p03::clock::RuntimeClock;
use crate::p04::service::Phase04;
use crate::p05::Phase05;
use crate::storage::{Database, StorageError};

use super::config::model::SettingState;
use super::config::registry::catalogue;
use super::config::{ConfigScope, ConfigService, ConfigState};
use super::connector::gateway::GatewayDeps;
use super::connector::idempotency::IdempotencyLedger;
use super::connector::secrets::ConnectorSecrets;
use super::connector::store::ConnectorStore;
use super::connector::{ConnectorGateway, ConnectorService};
use super::cost::guard::ModelCallGuard;
use super::cost::CostBooks;
use super::hooks::{ConfiguredBrokers, Phase06Context, Phase06Observer, PolicyOverlay, ToolUsage};
use super::observe::alerts::{AlertKind, AlertSeverity};
use super::observe::event::{Category, Component, EventDraft, Severity};
use super::observe::health::{overall, HealthOverview, HealthRecord, HealthState, HealthSubject};
use super::observe::redact::redact_value;
use super::observe::ObservabilityService;

/// ما يحتاجه Phase-06 من محيطه.
pub struct Phase06Config {
    pub db: Arc<Database>,
    pub audit: Arc<AuditLedger>,
    pub clock: RuntimeClock,
    pub http: Arc<HttpClient>,
    pub phase02: Option<Arc<Phase02>>,
    pub phase04: Option<Arc<Phase04>>,
    pub phase05: Option<Arc<Phase05>>,
    pub sources: Option<Arc<SourceService>>,
    pub credential_store: Arc<dyn CredentialStore>,
    pub credential_prompt: Arc<dyn CredentialPrompt>,
    pub environment: Arc<dyn Environment>,
    /// مجلّد التصدير التشخيصي. غيابه يعني أن المستند يُعاد ولا يُكتب.
    pub diagnostics_dir: Option<PathBuf>,
}

pub struct Phase06 {
    pub config: Arc<ConfigService>,
    pub observe: Arc<ObservabilityService>,
    pub books: Arc<CostBooks>,
    pub guard: Arc<ModelCallGuard>,
    pub gateway: Option<Arc<ConnectorGateway>>,
    pub connectors: Option<Arc<ConnectorService>>,
    pub overlay: Arc<PolicyOverlay>,
    pub observer: Arc<Phase06Observer>,
    pub context: Arc<Phase06Context>,
    pub brokers: Option<Arc<ConfiguredBrokers>>,
    pub tool_usage: Arc<ToolUsage>,
    /// ما رفضه سجل Phase-04 عند مزامنة أدوات الموصلات. يجب أن يكون فارغًا.
    pub refused_tools: Vec<(String, &'static str)>,
    pub guard_installed: bool,
    pub overlay_installed: bool,
    db: Arc<Database>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
    phase02: Option<Arc<Phase02>>,
    phase04: Option<Arc<Phase04>>,
    phase05: Option<Arc<Phase05>>,
    missions: OnceLock<Arc<MissionCancellation>>,
    diagnostics_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsExport {
    pub file_name: Option<String>,
    pub bytes: u64,
    pub level: String,
    pub sections: Vec<&'static str>,
    pub redactions: u32,
    pub document: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueueDepths {
    pub running_missions: u64,
    pub running_model_requests: u64,
    pub pending_approvals: u64,
    pub connector_requests_in_flight: u64,
}

impl Phase06 {
    pub fn build(config: Phase06Config) -> Self {
        let settings = Arc::new(ConfigService::new(config.db.clone(), config.audit.clone(), config.clock.clone()));
        let observe = Arc::new(ObservabilityService::new(Some(config.db.clone()), settings.clone(), config.clock.clone()));
        let books = Arc::new(CostBooks::new(config.db.clone()));
        let guard = Arc::new(ModelCallGuard::new(settings.clone(), books.clone(), observe.clone(), config.audit.clone()));
        // الحارس في مسار الاستدعاء الوحيد: كل نداء نموذج يمرّ به.
        let guard_installed = config.phase02.as_ref().is_some_and(|p| p.invocations.install_guard(guard.clone()));

        let overlay = Arc::new(PolicyOverlay { config: settings.clone() });
        let tool_usage = Arc::new(ToolUsage { books: books.clone(), observe: observe.clone() });
        let mut overlay_installed = false;
        if let Some(p04) = &config.phase04 {
            overlay_installed = p04.gateway.install_overlay(overlay.clone());
            p04.install_observer(tool_usage.clone());
        }

        let gateway = config.phase04.as_ref().map(|_| {
            Arc::new(ConnectorGateway::new(GatewayDeps {
                store: ConnectorStore::new(config.db.clone()),
                secrets: ConnectorSecrets::new(config.credential_store.clone(), config.credential_prompt.clone(), config.environment.clone()),
                idempotency: IdempotencyLedger::new(config.db.clone()),
                http: config.http.clone(),
                sources: config.sources.clone(),
                config: settings.clone(),
                books: books.clone(),
                observe: observe.clone(),
                audit: config.audit.clone(),
                clock: config.clock.clone(),
            }))
        });
        if let (Some(gateway), Some(p05)) = (&gateway, &config.phase05) {
            gateway.bind_memory(p05.memory.clone());
        }
        let connectors = match (&gateway, &config.phase04) {
            (Some(g), Some(p04)) => Some(Arc::new(ConnectorService::new(g.clone(), p04.clone(), settings.clone(), observe.clone(), config.audit.clone(), config.clock.clone()))),
            _ => None,
        };
        let refused_tools = connectors.as_ref().map(|c| c.sync_tools()).unwrap_or_default();

        let observer = Arc::new(Phase06Observer {
            phase05: config.phase05.clone(),
            phase04: config.phase04.clone(),
            connectors: gateway.clone(),
            config: settings.clone(),
            observe: observe.clone(),
            db: config.db.clone(),
        });
        let context = Arc::new(Phase06Context { phase05: config.phase05.clone(), connectors: gateway.clone(), config: settings.clone() });
        let brokers = config.phase04.as_ref().map(|p04| Arc::new(ConfiguredBrokers { phase04: p04.clone(), config: settings.clone() }));

        observe.emit(EventDraft::new(Component::Config, Category::Lifecycle, Severity::Info, "phase06.start", settings.status().state_code()).reason(if guard_installed { "GUARD_INSTALLED" } else { "GUARD_ABSENT" }));
        if settings.status().state != ConfigState::Ok {
            observe.raise(AlertKind::StorageIssue, AlertSeverity::Error, "config_values", "CONFIG_SCHEMA_UNSUPPORTED");
        }

        Self {
            config: settings,
            observe,
            books,
            guard,
            gateway,
            connectors,
            overlay,
            observer,
            context,
            brokers,
            tool_usage,
            refused_tools,
            guard_installed,
            overlay_installed,
            db: config.db,
            audit: config.audit,
            clock: config.clock,
            phase02: config.phase02,
            phase04: config.phase04,
            phase05: config.phase05,
            missions: OnceLock::new(),
            diagnostics_dir: config.diagnostics_dir,
        }
    }

    /// يربط تشغيلات Phase-03 بعد بنائه: بها يُنسب نداء النموذج إلى مهمّته.
    pub fn bind_missions(&self, missions: Arc<MissionCancellation>) {
        self.guard.bind_missions(missions.clone());
        let _ = self.missions.set(missions);
    }

    pub fn running_missions(&self) -> usize {
        self.missions.get().map(|m| m.running_count()).unwrap_or(0)
    }

    pub fn queue_depths(&self) -> QueueDepths {
        let pending = self
            .phase04
            .as_ref()
            .and_then(|p| p.gateway.state.lock().ok().map(|s| s.approvals.records().iter().filter(|r| r.status == crate::p04::approval::ApprovalStatus::Pending).count()))
            .unwrap_or(0);
        QueueDepths {
            running_missions: self.running_missions() as u64,
            running_model_requests: self.phase02.as_ref().map(|p| p.invocations.running_count()).unwrap_or(0) as u64,
            pending_approvals: pending as u64,
            connector_requests_in_flight: self.gateway.as_ref().map(|g| u64::from(g.limiter.in_flight_total())).unwrap_or(0),
        }
    }

    /// نظرة الصحّة (البند 31). المخزن والإعدادات يُقاسان الآن؛ المزوّدون والموصلات
    /// بما قيس في هذا الإقلاع وحده، وإلا فهم UNKNOWN.
    pub fn health(&self) -> HealthOverview {
        let now = self.clock.now();
        let mut components = Vec::new();

        let started = std::time::Instant::now();
        let check: Result<String, _> = self.db.with(|conn| Ok(conn.query_row("PRAGMA quick_check(1)", [], |r| r.get::<_, String>(0))?));
        let storage_ok = check.as_deref() == Ok("ok");
        self.observe.health.record(
            HealthSubject::Storage,
            "polaris.db",
            if storage_ok { HealthState::Healthy } else { HealthState::Unhealthy },
            if storage_ok { "QUICK_CHECK_OK" } else { "QUICK_CHECK_FAILED" },
            now.clone(),
            Some(started.elapsed().as_millis() as u64),
        );
        if !storage_ok {
            self.observe.raise(AlertKind::StorageIssue, AlertSeverity::Critical, "polaris.db", "QUICK_CHECK_FAILED");
        }
        components.push(self.observe.health.get(HealthSubject::Storage, "polaris.db"));

        let status = self.config.status();
        let config_state = if status.state == ConfigState::Ok { HealthState::Healthy } else { HealthState::Degraded };
        self.observe.health.record(HealthSubject::Config, "config", config_state, status.state_code(), now.clone(), None);
        components.push(self.observe.health.get(HealthSubject::Config, "config"));

        let refused = self.refused_tools.len() + self.phase05.as_ref().map(|p| p.refused_registrations.len()).unwrap_or(0);
        let gateway_state = match (&self.phase04, refused, self.overlay_installed) {
            (None, _, _) => HealthState::Unavailable,
            (Some(_), 0, true) => HealthState::Healthy,
            _ => HealthState::Degraded,
        };
        self.observe.health.record(HealthSubject::ToolGateway, "tool_gateway", gateway_state, if refused == 0 { "REGISTRY_CLEAN" } else { "REGISTRATIONS_REFUSED" }, now.clone(), None);
        components.push(self.observe.health.get(HealthSubject::ToolGateway, "tool_gateway"));

        let runtime_state = if self.missions.get().is_some() { HealthState::Healthy } else { HealthState::Unavailable };
        self.observe.health.record(HealthSubject::AgentRuntime, "agent_runtime", runtime_state, if runtime_state == HealthState::Healthy { "RUNTIME_BOUND" } else { "RUNTIME_ABSENT" }, now.clone(), None);
        components.push(self.observe.health.get(HealthSubject::AgentRuntime, "agent_runtime"));

        match &self.phase05 {
            Some(p05) => {
                let filter = crate::p05::memory::store::MemoryListFilter { limit: 1, ..Default::default() };
                let memory_ok = p05.memory.list(&filter).is_ok();
                self.observe.health.record(HealthSubject::Memory, "memory", if memory_ok { HealthState::Healthy } else { HealthState::Unhealthy }, if memory_ok { "STORE_READABLE" } else { "STORE_UNREADABLE" }, now.clone(), None);
                self.observe.health.record(HealthSubject::Browser, "browser", HealthState::Healthy, "ENGINE_READY", now.clone(), None);
                let desktop = p05.computer.available();
                self.observe.health.record(
                    HealthSubject::Computer,
                    "computer",
                    if desktop { HealthState::Healthy } else { HealthState::Unavailable },
                    if desktop { "DESKTOP_PORT_READY" } else { "DESKTOP_PORT_UNAVAILABLE" },
                    now.clone(),
                    None,
                );
            }
            None => {
                for (subject, id) in [(HealthSubject::Memory, "memory"), (HealthSubject::Browser, "browser"), (HealthSubject::Computer, "computer")] {
                    self.observe.health.record(subject, id, HealthState::Unavailable, "PHASE_05_ABSENT", now.clone(), None);
                }
            }
        }
        for (subject, id) in [(HealthSubject::Memory, "memory"), (HealthSubject::Browser, "browser"), (HealthSubject::Computer, "computer")] {
            components.push(self.observe.health.get(subject, id));
        }

        if let Some(p02) = &self.phase02 {
            for descriptor in p02.providers.relevant().unwrap_or_default() {
                let enabled = p02.providers.state(&descriptor.id).map(|s| s.enabled).unwrap_or(false);
                if enabled {
                    components.push(self.observe.health.get(HealthSubject::Provider, &descriptor.id));
                }
            }
        }
        if let Some(gateway) = &self.gateway {
            for instance in gateway.instances() {
                components.push(self.observe.health.get(HealthSubject::Connector, &instance.connector_id));
            }
        }
        HealthOverview { measured_at: now, overall: overall(&components), components }
    }

    /// حالات الأسرار كما تعبر الحدّ (البند 39): مضبوط، ومصدر، وآخر تحديث. لا قيمة.
    pub fn sensitive_statuses(&self) -> Vec<Value> {
        let mut out = Vec::new();
        if let Some(p02) = &self.phase02 {
            for descriptor in p02.providers.relevant().unwrap_or_default() {
                let status = p02.secrets.status(&descriptor);
                if status.required {
                    out.push(serde_json::json!({
                        "subject": format!("provider:{}", descriptor.id),
                        "configured": status.configured,
                        "source": status.source,
                        "reference": status.reference,
                    }));
                }
            }
        }
        if let Some(gateway) = &self.gateway {
            for instance in gateway.instances() {
                let status = gateway.secrets.status(&instance);
                if status.required {
                    out.push(serde_json::json!({
                        "subject": format!("connector:{}", instance.connector_id),
                        "configured": status.configured,
                        "source": status.source,
                        "reference": status.reference,
                        "last_updated": status.last_updated,
                    }));
                }
            }
        }
        out
    }

    /// التصدير التشخيصي (البند 33): محدود، ومنقّح، وبلا سرّ. المستوى من إعداد الخصوصية.
    pub fn export_diagnostics(&self) -> DiagnosticsExport {
        let level = self.config.code("privacy.diagnostics_level", &ConfigScope::global());
        let detailed = level == "DETAILED";
        let standard = detailed || level == "STANDARD";
        let mut sections = vec!["versions", "health", "recent_reason_codes"];
        let health = self.health();
        let mut reasons: std::collections::BTreeMap<(String, String), u64> = std::collections::BTreeMap::new();
        for event in self.observe.events.recent(500, None, None) {
            if let Some(reason) = &event.reason_code {
                *reasons.entry((event.component.as_str().to_string(), reason.clone())).or_insert(0) += 1;
            }
        }
        let mut document = serde_json::json!({
            "schema": "polaris.diagnostics.v1",
            "generated_at": self.clock.now(),
            "level": level,
            "label": "LOCAL DIAGNOSTICS — REDACTED, NO SECRETS",
            "versions": {
                "app": crate::services::app_info::APP_VERSION,
                "ipc_protocol": crate::IPC_PROTOCOL_VERSION,
                "contract": crate::CONTRACT_VERSION,
                "storage_schema": crate::storage::migrations::SUPPORTED_VERSION,
                "config_schema": super::config::store::CONFIG_SCHEMA_VERSION,
            },
            "health": health,
            "recent_reason_codes": reasons.into_iter().map(|((component, reason), count)| serde_json::json!({ "component": component, "reason_code": reason, "count": count })).collect::<Vec<_>>(),
        });
        if standard {
            sections.extend(["config_summary", "sensitive", "metrics", "queue_depths"]);
            let effective = self.config.effective(&ConfigScope::global());
            document["config_summary"] = Value::Array(
                effective
                    .iter()
                    .filter(|r| catalogue().iter().any(|d| d.key == r.key && d.state != SettingState::UnavailableThisPhase))
                    .map(|r| serde_json::json!({ "key": r.key, "value": r.value.to_json(), "source": r.source.as_str() }))
                    .collect(),
            );
            document["sensitive"] = Value::Array(self.sensitive_statuses());
            document["metrics"] = serde_json::to_value(self.observe.metrics.snapshot()).unwrap_or(Value::Null);
            document["queue_depths"] = serde_json::to_value(self.queue_depths()).unwrap_or(Value::Null);
        }
        if detailed {
            sections.extend(["alerts", "connectors", "performance"]);
            document["alerts"] = serde_json::to_value(self.observe.alerts.list(false)).unwrap_or(Value::Null);
            document["connectors"] = Value::Array(
                self.gateway
                    .as_ref()
                    .map(|g| {
                        g.instances()
                            .iter()
                            .map(|c| {
                                serde_json::json!({
                                    "connector_id": c.connector_id,
                                    "provider": c.provider.as_str(),
                                    "category": c.category.as_str(),
                                    "egress_class": c.egress_class().as_str(),
                                    "enabled": c.enabled,
                                    "operations": c.operations.len(),
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            );
            document["performance"] = serde_json::to_value(self.gateway.as_ref().map(|g| g.timings())).unwrap_or(Value::Null);
        }
        let redactions = redact_value(&mut document);
        document["redactions"] = Value::from(redactions);
        let mut text = serde_json::to_string_pretty(&document).unwrap_or_default();
        // الحدّ: مستند أكبر من ربع ميغابايت يُقصّ إلى أقسامه الأولى.
        if text.len() > 256 * 1024 {
            for key in ["performance", "connectors", "alerts", "metrics", "config_summary"] {
                if let Some(map) = document.as_object_mut() {
                    map.remove(key);
                }
                text = serde_json::to_string_pretty(&document).unwrap_or_default();
                if text.len() <= 256 * 1024 {
                    break;
                }
            }
        }
        let mut file_name = None;
        if let Some(dir) = &self.diagnostics_dir {
            let stamp: String = self.clock.now().chars().filter(|c| c.is_ascii_digit()).collect();
            let name = format!("polaris-diagnostics-{stamp}.json");
            if std::fs::create_dir_all(dir).is_ok() && std::fs::write(dir.join(&name), format!("{text}\n")).is_ok() {
                file_name = Some(name);
            }
        }
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::DiagnosticsExported,
            "diagnostics",
            file_name.clone().unwrap_or_else(|| "inline".into()),
            AuditOutcome::Success,
            serde_json::json!({ "level": level, "bytes": text.len(), "redactions": redactions, "sections": sections }),
        ));
        self.observe.emit(EventDraft::new(Component::Diagnostics, Category::Diagnostics, Severity::Info, "diagnostics.export", "EXPORTED").reason(&level));
        DiagnosticsExport { file_name, bytes: text.len() as u64, level, sections, redactions, document }
    }

    pub fn observe_audit(&self) -> &Arc<AuditLedger> {
        &self.audit
    }

    pub fn health_record(&self, subject: HealthSubject, id: &str) -> HealthRecord {
        self.observe.health.get(subject, id)
    }

    /// مجلّد التصدير التشخيصي، إن كان هناك مجلّد بيانات.
    pub fn diagnostics_dir(&self) -> Option<&Path> {
        self.diagnostics_dir.as_deref()
    }

    /// عدد صفوف المخزن التي يظهر في أحد أعمدتها نصّ بعينه، في كل الجداول.
    ///
    /// قراءة فقط، والعدد وحده يُعاد لا النصّ: هكذا يُقاس أن قيمة سرّ لم تصل إلى المخزن قطّ.
    pub fn stored_rows_containing(&self, needle: &str) -> Result<u64, StorageError> {
        if needle.len() < 8 {
            return Err(StorageError::Query("needle too short".into()));
        }
        self.db.with(|c| {
            let tables: Vec<String> = {
                let mut s = c.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")?;
                let rows = s.query_map([], |r| r.get::<_, String>(0))?;
                rows.collect::<Result<_, _>>()?
            };
            let mut total = 0u64;
            for table in tables {
                let columns: Vec<String> = {
                    let mut s = c.prepare(&format!("SELECT name FROM pragma_table_info('{}')", table.replace('\'', "''")))?;
                    let rows = s.query_map([], |r| r.get::<_, String>(0))?;
                    rows.collect::<Result<_, _>>()?
                };
                if columns.is_empty() {
                    continue;
                }
                let predicate = columns
                    .iter()
                    .map(|column| format!("instr(CAST(\"{}\" AS TEXT), ?1) > 0", column.replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(" OR ");
                let count: i64 = c.query_row(&format!("SELECT COUNT(*) FROM \"{}\" WHERE {predicate}", table.replace('"', "\"\"")), [needle], |r| r.get(0))?;
                total += count.max(0) as u64;
            }
            Ok(total)
        })
    }
}

impl super::config::service::ConfigStatus {
    pub fn state_code(&self) -> &'static str {
        match self.state {
            ConfigState::Ok => "CONFIG_OK",
            ConfigState::UnsupportedVersion => "CONFIG_SCHEMA_NEWER",
            ConfigState::Unreadable => "CONFIG_UNREADABLE",
        }
    }
}
