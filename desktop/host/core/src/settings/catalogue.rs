// فهرس أقسام الإعدادات. بيانات لا شيفرة: البنية تُعلَن هنا مرة، ويُشتق منها
// الواصفُ ومفاتيحُ الترجمة معًا، فلا ينجرف الاثنان.
//
// المعرّف يحمل مجموعته كبادئة (`general.appearance`)، والعارض يجمع الأقسام بها.
// البديل — تعداد المجموعات في العقد — كان يعني تغيير عقد كلما أضاف التصميم
// مجموعة، والعقد جمّد الشكل عمدًا وترك الفهرسة لـW6. مُسجَّل كـP01-DEC-05.

use crate::model::availability::AvailabilityReason;
use crate::model::settings::{
    SettingDescriptor, SettingMode, SettingSectionDescriptor, SettingValueKind,
};

pub struct SettingSpec {
    pub id: &'static str,
    pub kind: SettingValueKind,
    pub mode: SettingMode,
    pub reason: Option<AvailabilityReason>,
    /// إلزامية لنوع ENUM وحده.
    pub allowed_values: Option<&'static [&'static str]>,
}

pub struct SectionSpec {
    pub id: &'static str,
    pub mode: SettingMode,
    pub reason: Option<AvailabilityReason>,
    pub settings: &'static [SettingSpec],
}

use AvailabilityReason::PhaseNotImplemented;
use SettingMode::{ReadOnly, UnavailableThisPhase};
use SettingValueKind::{Appearance, Boolean, Integer, Locale, Text};

/// إعداد غير مبنيّ في هذه المرحلة.
const fn pending(id: &'static str, kind: SettingValueKind) -> SettingSpec {
    SettingSpec { id, kind, mode: UnavailableThisPhase, reason: Some(PhaseNotImplemented), allowed_values: None }
}

/// إعداد يحمل حقيقة مضيف حقيقية: يُرى ولا يُغيَّر في هذه المرحلة.
const fn observable(id: &'static str, kind: SettingValueKind) -> SettingSpec {
    SettingSpec { id, kind, mode: ReadOnly, reason: Some(PhaseNotImplemented), allowed_values: None }
}


const GENERAL_APPEARANCE: &[SettingSpec] =
    &[observable("appearance", Appearance), pending("accent-color", Text)];

const GENERAL_LANGUAGE: &[SettingSpec] = &[
    observable("locale", Locale),
    observable("direction", Text),
    pending("first-day-of-week", Text),
];

const GENERAL_STARTUP: &[SettingSpec] =
    &[pending("launch-at-login", Boolean), pending("restore-window", Boolean)];

// Phase-02: النماذج والمزوّدون يُداران من صفحاتهما. هنا تُعرض الحقائق الحيّة للقراءة،
// والقيمة تأتي من السجل لا من الفهرس. النموذج الافتراضي نصّ معرّفه كما هو، أو غياب.
const AI_MODELS: &[SettingSpec] = &[observable("configured-model-count", Integer), observable("default-model", Text)];

const AI_PROVIDERS: &[SettingSpec] =
    &[observable("provider-count", Integer), pending("provider-endpoint", Text)];

const AI_ROUTING: &[SettingSpec] = &[pending("routing-strategy", Text), pending("fallback-order", Text)];
const AI_CONTEXT: &[SettingSpec] = &[pending("context-window", Integer), pending("context-policy", Text)];
// لا مسار نموذج محلي ولا مشغّل يُدار من Polaris: الخادم المحلي يملك نماذجه.
const AI_LOCAL_MODELS: &[SettingSpec] =
    &[pending("local-runner", Text), pending("local-model-path", Text)];

const AGENTS_DEFAULTS: &[SettingSpec] = &[pending("default-agent", Text), pending("default-timeout", Integer)];
const AGENTS_EXECUTION: &[SettingSpec] =
    &[pending("max-parallel-missions", Integer), pending("execution-mode", Text)];
const AGENTS_APPROVALS: &[SettingSpec] =
    &[pending("approval-timeout", Integer), pending("require-approval", Boolean)];
const AGENTS_PERMISSIONS: &[SettingSpec] =
    &[pending("filesystem-scope", Text), pending("network-scope", Text)];
const AGENTS_SAFETY: &[SettingSpec] = &[pending("panic-stop-hotkey", Text), pending("safety-profile", Text)];

const DATA_PROJECTS: &[SettingSpec] = &[pending("project-root", Text), pending("project-count", Integer)];
const DATA_MEMORY: &[SettingSpec] = &[pending("memory-store", Text), pending("memory-retention-days", Integer)];
const DATA_STORAGE: &[SettingSpec] = &[pending("storage-root", Text), pending("storage-quota-mb", Integer)];
const DATA_BACKUPS: &[SettingSpec] = &[pending("backup-enabled", Boolean), pending("backup-interval-hours", Integer)];

const TOOLS_SKILLS: &[SettingSpec] = &[pending("skill-count", Integer), pending("skill-autoload", Boolean)];
const TOOLS_MCP: &[SettingSpec] = &[pending("mcp-server-count", Integer), pending("mcp-autostart", Boolean)];
const TOOLS_CONNECTORS: &[SettingSpec] =
    &[pending("connector-count", Integer), pending("connector-autoconnect", Boolean)];
const TOOLS_BROWSER: &[SettingSpec] = &[pending("browser-engine", Text), pending("browser-headless", Boolean)];
const TOOLS_COMPUTER_USE: &[SettingSpec] =
    &[pending("computer-use-enabled", Boolean), pending("screenshot-redaction", Boolean)];

const SECURITY_PRIVACY: &[SettingSpec] = &[
    observable("telemetry-enabled", Boolean),
    pending("crash-reporting", Boolean),
];
const SECURITY_DATA_EGRESS: &[SettingSpec] = &[
    observable("network-egress-performed", Boolean),
    pending("allowed-egress-hosts", Text),
];
/// اسم القسم محايد عمدًا: كاشف الأسرار في العقود يطابق أسماء المفاتيح، ووثيقة
/// تُسمّي حقلًا `secret_*` ترفضها قواعد النظافة نفسها التي كُتبت لحمايته.
const SECURITY_PROTECTED_VALUES: &[SettingSpec] =
    &[pending("store-backend", Text), pending("stored-entry-count", Integer)];
const SECURITY_AUDIT: &[SettingSpec] = &[pending("audit-sink", Text), pending("audit-retention-days", Integer)];
const SECURITY_SANDBOXING: &[SettingSpec] = &[
    observable("desktop-host-confined", Boolean),
    pending("executor-confinement-profile", Text),
];

const ADVANCED_DEVELOPER: &[SettingSpec] =
    &[pending("developer-mode", Boolean), pending("devtools-enabled", Boolean)];
const ADVANCED_LOGS: &[SettingSpec] = &[pending("log-level", Text), pending("log-retention-days", Integer)];
const ADVANCED_DIAGNOSTICS: &[SettingSpec] = &[
    observable("host-diagnostics-retained", Boolean),
    pending("diagnostics-export", Boolean),
];
const ADVANCED_EXPERIMENTAL: &[SettingSpec] =
    &[pending("experimental-flags", Text), pending("preview-features", Boolean)];

/// قسم يعرض حقائق حقيقية: يُرى ولا يُغيَّر.
const fn observable_section(id: &'static str, settings: &'static [SettingSpec]) -> SectionSpec {
    SectionSpec { id, mode: ReadOnly, reason: Some(PhaseNotImplemented), settings }
}

/// قسم لا شيء فيه بعد.
const fn pending_section(id: &'static str, settings: &'static [SettingSpec]) -> SectionSpec {
    SectionSpec { id, mode: UnavailableThisPhase, reason: Some(PhaseNotImplemented), settings }
}


/// واحد وثلاثون قسمًا. الحدّ في العقد اثنان وثلاثون، والفهرس يبقى تحته.
pub const SECTIONS: &[SectionSpec] = &[
    observable_section("general.appearance", GENERAL_APPEARANCE),
    observable_section("general.language-region", GENERAL_LANGUAGE),
    pending_section("general.startup", GENERAL_STARTUP),
    observable_section("ai.models", AI_MODELS),
    observable_section("ai.providers", AI_PROVIDERS),
    pending_section("ai.routing", AI_ROUTING),
    pending_section("ai.context", AI_CONTEXT),
    pending_section("ai.local-models", AI_LOCAL_MODELS),
    pending_section("agents.defaults", AGENTS_DEFAULTS),
    pending_section("agents.execution", AGENTS_EXECUTION),
    pending_section("agents.approvals", AGENTS_APPROVALS),
    pending_section("agents.permissions", AGENTS_PERMISSIONS),
    pending_section("agents.safety", AGENTS_SAFETY),
    pending_section("data.projects", DATA_PROJECTS),
    pending_section("data.memory", DATA_MEMORY),
    pending_section("data.storage", DATA_STORAGE),
    pending_section("data.backups", DATA_BACKUPS),
    pending_section("tools.skills", TOOLS_SKILLS),
    pending_section("tools.mcp", TOOLS_MCP),
    pending_section("tools.connectors", TOOLS_CONNECTORS),
    pending_section("tools.browser", TOOLS_BROWSER),
    pending_section("tools.computer-use", TOOLS_COMPUTER_USE),
    observable_section("security.privacy", SECURITY_PRIVACY),
    observable_section("security.data-egress", SECURITY_DATA_EGRESS),
    pending_section("security.protected-values", SECURITY_PROTECTED_VALUES),
    pending_section("security.audit", SECURITY_AUDIT),
    observable_section("security.sandboxing", SECURITY_SANDBOXING),
    pending_section("advanced.developer", ADVANCED_DEVELOPER),
    pending_section("advanced.logs", ADVANCED_LOGS),
    observable_section("advanced.diagnostics", ADVANCED_DIAGNOSTICS),
    pending_section("advanced.experimental", ADVANCED_EXPERIMENTAL),
];

/// مفتاح ترجمة قسم. مفتاح لا نصّ: النصّ المُوطَّن لا يعبر الحدّ أبدًا.
pub fn section_label_key(section_id: &str) -> String {
    format!("settings.section.{section_id}")
}

pub fn setting_label_key(section_id: &str, setting_id: &str) -> String {
    format!("settings.{section_id}.{setting_id}")
}

/// معرّفات الأقسام بترتيب الفهرس.
pub fn section_ids() -> Vec<&'static str> {
    SECTIONS.iter().map(|s| s.id).collect()
}

pub fn section(section_id: &str) -> Option<&'static SectionSpec> {
    SECTIONS.iter().find(|s| s.id == section_id)
}

/// يبني الواصفات من الفهرس. لا قيمة تدخل هنا: الوصف ليس قراءة.
pub fn sections(filter: Option<&[String]>) -> Vec<SettingSectionDescriptor> {
    SECTIONS
        .iter()
        .filter(|s| filter.is_none_or(|ids| ids.iter().any(|id| id == s.id)))
        .map(|s| SettingSectionDescriptor {
            section_id: s.id.to_string(),
            label_key: section_label_key(s.id),
            mode: s.mode,
            availability_reason: s.reason,
            settings: s
                .settings
                .iter()
                .map(|spec| SettingDescriptor {
                    setting_id: spec.id.to_string(),
                    value_kind: spec.kind,
                    mode: spec.mode,
                    label_key: setting_label_key(s.id, spec.id),
                    description_key: None,
                    availability_reason: spec.reason,
                    allowed_values: spec
                        .allowed_values
                        .map(|v| v.iter().map(|s| (*s).to_string()).collect()),
                })
                .collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn section_count_stays_within_the_contract_bound() {
        assert!(SECTIONS.len() <= 32, "the contract caps sections at 32");
        assert_eq!(SECTIONS.len(), 31);
    }

    #[test]
    fn section_ids_are_unique() {
        let mut ids = section_ids();
        let before = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), before);
    }

    #[test]
    fn no_setting_is_active_because_no_write_operation_exists() {
        for section in SECTIONS {
            assert_ne!(section.mode, SettingMode::Active, "{}", section.id);
            for setting in section.settings {
                assert_ne!(setting.mode, SettingMode::Active, "{}/{}", section.id, setting.id);
            }
        }
    }

    #[test]
    fn every_non_active_mode_carries_a_reason() {
        for section in SECTIONS {
            assert!(section.reason.is_some(), "{}", section.id);
            for setting in section.settings {
                assert!(setting.reason.is_some(), "{}/{}", section.id, setting.id);
            }
        }
    }

    #[test]
    fn every_enum_setting_publishes_allowed_values() {
        for section in SECTIONS {
            for setting in section.settings {
                if setting.kind == SettingValueKind::Enum {
                    assert!(
                        setting.allowed_values.is_some(),
                        "{}/{} is ENUM without allowed_values",
                        section.id,
                        setting.id
                    );
                } else {
                    assert!(
                        setting.allowed_values.is_none(),
                        "{}/{} publishes allowed_values without being ENUM",
                        section.id,
                        setting.id
                    );
                }
            }
        }
    }

    #[test]
    fn descriptors_never_expose_a_value() {
        let json = serde_json::to_string(&sections(None)).unwrap();
        for forbidden in ["\"value\"", "current_value", "resolved_value"] {
            assert!(!json.contains(forbidden), "describe leaked {forbidden}");
        }
    }
}
