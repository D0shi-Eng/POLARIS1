// الإنجليزية: لغة التراجع، ولذلك هي المجموعة الكاملة التي تُقاس عليها البقية.

import { P02_EN } from "./p02-en";
import { P03_EN } from "./p03-en";
import { P04_EN } from "./p04-en";
import { P05_EN } from "./p05-en";
import { P06_EN } from "./p06-en";
import { P08_EN } from "./p08-en";
import { UI_EN } from "./ui-en";
import { SETTINGS_EN } from "./settings-en";

export const EN: Readonly<Record<string, string>> = {
  // ── القشرة ────────────────────────────────────────────────────────────────
  "app.name": "POLARIS",
  "app.tagline": "Governed local agents",
  "app.window_title": "POLARIS",

  "nav.primary": "Primary",
  "nav.landmark": "Sections",
  "nav.home": "Home",
  "nav.projects": "Projects",
  "nav.missions": "Missions",
  "nav.agents": "Agents",
  "nav.skills": "Skills",
  "nav.browser-computer": "Browser & computer",
  "nav.memory": "Memory",
  "nav.connectors": "Connectors",
  "nav.activity": "Activity",
  "nav.settings": "Settings",

  "layout.banner": "Application header",
  "layout.main": "Main content",

  // ── الصفحة الرئيسية ───────────────────────────────────────────────────────
  "home.title": "Home",
  "home.subtitle": "What this build can actually do right now.",
  "home.section.system": "This build",
  "home.section.runtime": "Trusted core",
  "home.section.models": "Models",
  "home.section.capabilities": "Capabilities",
  "home.fact.app_version": "Version",
  "home.fact.build_channel": "Channel",
  "home.fact.platform": "Platform",
  "home.fact.architecture": "Architecture",
  "home.fact.locale": "Language",
  "home.fact.direction": "Direction",
  "home.fact.appearance": "Theme",
  "home.fact.ipc_protocol": "IPC protocol",
  "home.fact.settings_schema": "Settings contract",
  "home.runtime.reachability.ATTACHED": "Attached",
  "home.runtime.reachability.NOT_ATTACHED": "Not attached",
  "home.runtime.reachability.UNREACHABLE": "Unreachable",
  "home.runtime.note": "The seam to the trusted core is drawn and not yet built.",
  "home.models.none": "No models configured",
  "home.models.manage": "Manage models",
  "home.models.note": "Nothing is connected, so nothing is listed.",
  "home.capabilities.enabled": "Working now",
  "home.capabilities.unavailable": "Not in this build",
  "home.capabilities.empty": "Nothing is enabled in this build.",

  // ── الإتاحة ───────────────────────────────────────────────────────────────
  "availability.state.AVAILABLE": "Available",
  "availability.state.READ_ONLY": "Read only",
  "availability.state.UNAVAILABLE": "Unavailable",
  "availability.state.BLOCKED": "Blocked",
  "availability.state.ERROR": "Error",
  "availability.reason.PHASE_NOT_IMPLEMENTED": "not built in this phase",
  "availability.reason.PROVIDER_NOT_CONFIGURED": "no provider is configured",
  "availability.reason.PLATFORM_UNSUPPORTED": "this platform is not supported",
  "availability.reason.POLICY_DISABLED": "policy disables it",
  "availability.reason.RUNTIME_UNAVAILABLE": "the trusted core is unavailable",
  "availability.explained": "{state} — {reason}",

  // ── الإعدادات ─────────────────────────────────────────────────────────────
  "settings.title": "Settings",
  "settings.subtitle": "Everything this build knows about itself.",
  "settings.landmark": "Settings sections",
  "settings.group.general": "General",
  "settings.group.ai": "AI & models",
  "settings.group.agents": "Agents",
  "settings.group.data": "Data",
  "settings.group.tools": "Tools",
  "settings.group.security": "Security & privacy",
  "settings.group.advanced": "Advanced",
  "settings.group.about": "About",
  "settings.mode.ACTIVE": "Editable",
  "settings.mode.READ_ONLY": "Read only",
  "settings.mode.UNAVAILABLE_THIS_PHASE": "Not in this build",
  "settings.value.withheld": "Set, and not shown",
  "settings.value.absent": "No value",
  "settings.value.true": "Yes",
  "settings.value.false": "No",
  "settings.note.read_only_phase":
    "This build can read settings and cannot write them: its host operations are read-only. Nothing here pretends otherwise.",
  "settings.about.title": "About",
  "settings.about.licenses": "Licences",
  "settings.about.licenses_note": "Third-party licences ship with the build.",
  "settings.empty_section": "This section has no settings yet.",

  // ── الحالات ───────────────────────────────────────────────────────────────
  "state.loading": "Loading",
  "state.empty": "Nothing here yet",
  "state.offline": "No connection to the host",
  "state.unavailable": "Not available",
  "state.blocked": "Blocked",
  "state.error": "Something failed",
  "state.retrying": "Retrying",
  "state.retry": "Try again",

  "bootstrap.error.title": "POLARIS could not start",
  "bootstrap.error.body": "The shell did not receive its startup facts from the host, so nothing is shown rather than guessed.",
  "bootstrap.error.code": "Error code: {code}",
  "bootstrap.loading": "Starting",

  // ── أخطاء الحدّ ───────────────────────────────────────────────────────────
  "desktop.error.ipc_timeout": "The host did not answer in time.",
  "desktop.error.native_service_unavailable": "A host service is unavailable.",
  "desktop.error.ipc_unavailable": "The host cannot be reached.",
  "desktop.error.unsupported_operation": "This build does not support that request.",
  "desktop.error.invalid_response": "The answer did not match the contract.",
  "desktop.error.permission_denied": "That is not permitted.",
  "desktop.error.feature_not_available": "That is not available in this build.",
  "desktop.error.config_unavailable": "Settings could not be read.",
  "desktop.error.internal_error": "The host reported an internal failure.",

  // ── التوجيه ───────────────────────────────────────────────────────────────
  "route.unknown.title": "No such section",
  "route.unknown.body": "The address {route} is not part of this build.",
  "route.unknown.action": "Go to Home",
  "unavailable.title": "{section}",
  "unavailable.body": "This section is a destination with a declared state, not a screen pretending to load.",

  // ── تفضيلات الجلسة ────────────────────────────────────────────────────────
  "session.language": "Language",
  "session.appearance": "Theme",
  "session.scope_note": "Applies to this session. Nothing is saved, because this build cannot write settings.",
  "appearance.LIGHT": "Light",
  "appearance.DARK": "Dark",
  "appearance.SYSTEM": "Follow the system",

  "locale.name.ar": "العربية",
  "locale.name.en": "English",
  "locale.name.de": "Deutsch",
  "locale.name.fr": "Français",
  "locale.name.ru": "Русский",
  "locale.name.zh": "中文",
  "locale.name.ko": "한국어",
  "locale.name.ja": "日本語",
  "locale.name.es": "Español",

  // ── الوصول ────────────────────────────────────────────────────────────────
  "a11y.skip_to_content": "Skip to content",
  "a11y.current_section": "Current section",
  "a11y.language_switcher": "Change language",
  "a11y.appearance_switcher": "Change theme",
  "a11y.close": "Close",
  "a11y.section_status": "Status",

  // ── مشترك ─────────────────────────────────────────────────────────────────
  "common.count.one": "{count} item",
  "common.count.other": "{count} items",
  "common.capability.one": "{count} capability",
  "common.capability.other": "{count} capabilities",
  "common.none": "None",
  "common.updated_at": "Read at {time}",
  ...SETTINGS_EN,
  ...P02_EN,
  ...P03_EN,
  ...P04_EN,
  ...P05_EN,
  ...P06_EN,
  ...P08_EN,
  ...UI_EN,
};
