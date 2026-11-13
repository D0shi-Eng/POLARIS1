// مفاتيح أقسام الإعدادات وإعداداتها بالإنجليزية.
//
// مفصولة عن الملف الرئيسي لأنها تنمو مع فهرس الإعدادات لا مع نصوص الواجهة،
// ولأن اختبار تكافؤ المفاتيح يقرأ المجموعتين معًا على أي حال.

export const SETTINGS_EN: Readonly<Record<string, string>> = {
  "settings.section.general.appearance": "Appearance",
  "settings.general.appearance.appearance": "Theme",
  "settings.general.appearance.accent-color": "Accent colour",

  "settings.section.general.language-region": "Language & region",
  "settings.general.language-region.locale": "Language",
  "settings.general.language-region.direction": "Writing direction",
  "settings.general.language-region.first-day-of-week": "First day of the week",

  "settings.section.general.startup": "Startup",
  "settings.general.startup.launch-at-login": "Launch at sign-in",
  "settings.general.startup.restore-window": "Restore the last window",

  "settings.section.ai.models": "Models",
  "settings.ai.models.configured-model-count": "Configured models",
  "settings.ai.models.default-model": "Default model",

  "settings.section.ai.providers": "Providers",
  "settings.ai.providers.provider-count": "Configured providers",
  "settings.ai.providers.provider-endpoint": "Provider endpoint",

  "settings.section.ai.routing": "Routing",
  "settings.ai.routing.routing-strategy": "Routing strategy",
  "settings.ai.routing.fallback-order": "Fallback order",

  "settings.section.ai.context": "Context",
  "settings.ai.context.context-window": "Context window",
  "settings.ai.context.context-policy": "Context policy",

  "settings.section.ai.local-models": "Local models",
  "settings.ai.local-models.local-runner": "Local runner",
  "settings.ai.local-models.local-model-path": "Local model location",

  "settings.section.agents.defaults": "Defaults",
  "settings.agents.defaults.default-agent": "Default agent",
  "settings.agents.defaults.default-timeout": "Default timeout",

  "settings.section.agents.execution": "Execution",
  "settings.agents.execution.max-parallel-missions": "Parallel missions",
  "settings.agents.execution.execution-mode": "Execution mode",

  "settings.section.agents.approvals": "Approvals",
  "settings.agents.approvals.approval-timeout": "Approval timeout",
  "settings.agents.approvals.require-approval": "Require approval",

  "settings.section.agents.permissions": "Permissions",
  "settings.agents.permissions.filesystem-scope": "Filesystem scope",
  "settings.agents.permissions.network-scope": "Network scope",

  "settings.section.agents.safety": "Safety",
  "settings.agents.safety.panic-stop-hotkey": "Panic stop shortcut",
  "settings.agents.safety.safety-profile": "Safety profile",

  "settings.section.data.projects": "Projects",
  "settings.data.projects.project-root": "Projects folder",
  "settings.data.projects.project-count": "Projects",

  "settings.section.data.memory": "Memory",
  "settings.data.memory.memory-store": "Memory store",
  "settings.data.memory.memory-retention-days": "Retention",

  "settings.section.data.storage": "Storage",
  "settings.data.storage.storage-root": "Storage folder",
  "settings.data.storage.storage-quota-mb": "Storage limit",

  "settings.section.data.backups": "Backups",
  "settings.data.backups.backup-enabled": "Back up automatically",
  "settings.data.backups.backup-interval-hours": "Backup interval",

  "settings.section.tools.skills": "Skills",
  "settings.tools.skills.skill-count": "Installed skills",
  "settings.tools.skills.skill-autoload": "Load skills at startup",

  "settings.section.tools.mcp": "MCP",
  "settings.tools.mcp.mcp-server-count": "MCP servers",
  "settings.tools.mcp.mcp-autostart": "Start servers automatically",

  "settings.section.tools.connectors": "Connectors",
  "settings.tools.connectors.connector-count": "Connectors",
  "settings.tools.connectors.connector-autoconnect": "Connect automatically",

  "settings.section.tools.browser": "Browser",
  "settings.tools.browser.browser-engine": "Browser engine",
  "settings.tools.browser.browser-headless": "Run without a window",

  "settings.section.tools.computer-use": "Computer use",
  "settings.tools.computer-use.computer-use-enabled": "Allow computer use",
  "settings.tools.computer-use.screenshot-redaction": "Redact screenshots",

  "settings.section.security.privacy": "Privacy",
  "settings.security.privacy.telemetry-enabled": "Telemetry",
  "settings.security.privacy.crash-reporting": "Crash reporting",

  "settings.section.security.data-egress": "Data egress",
  "settings.security.data-egress.network-egress-performed": "Network requests made",
  "settings.security.data-egress.allowed-egress-hosts": "Allowed destinations",

  "settings.section.security.protected-values": "Protected values",
  "settings.security.protected-values.store-backend": "Storage backend",
  "settings.security.protected-values.stored-entry-count": "Stored entries",

  "settings.section.security.audit": "Audit",
  "settings.security.audit.audit-sink": "Audit destination",
  "settings.security.audit.audit-retention-days": "Audit retention",

  "settings.section.security.sandboxing": "Sandboxing",
  "settings.security.sandboxing.desktop-host-confined": "Desktop host confined",
  "settings.security.sandboxing.executor-confinement-profile": "Executor confinement profile",

  "settings.section.advanced.developer": "Developer",
  "settings.advanced.developer.developer-mode": "Developer mode",
  "settings.advanced.developer.devtools-enabled": "Developer tools",

  "settings.section.advanced.logs": "Logs",
  "settings.advanced.logs.log-level": "Log level",
  "settings.advanced.logs.log-retention-days": "Log retention",

  "settings.section.advanced.diagnostics": "Diagnostics",
  "settings.advanced.diagnostics.host-diagnostics-retained": "Host diagnostics kept locally",
  "settings.advanced.diagnostics.diagnostics-export": "Export diagnostics",

  "settings.section.advanced.experimental": "Experimental",
  "settings.advanced.experimental.experimental-flags": "Experimental flags",
  "settings.advanced.experimental.preview-features": "Preview features",
};
