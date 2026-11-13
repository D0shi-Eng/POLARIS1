// مفاتيح أقسام الإعدادات وإعداداتها بالعربية.

export const SETTINGS_AR: Readonly<Record<string, string>> = {
  "settings.section.general.appearance": "المظهر",
  "settings.general.appearance.appearance": "السمة",
  "settings.general.appearance.accent-color": "اللون المميِّز",

  "settings.section.general.language-region": "اللغة والمنطقة",
  "settings.general.language-region.locale": "اللغة",
  "settings.general.language-region.direction": "اتجاه الكتابة",
  "settings.general.language-region.first-day-of-week": "أول أيام الأسبوع",

  "settings.section.general.startup": "بدء التشغيل",
  "settings.general.startup.launch-at-login": "التشغيل عند الدخول",
  "settings.general.startup.restore-window": "استعادة آخر نافذة",

  "settings.section.ai.models": "النماذج",
  "settings.ai.models.configured-model-count": "النماذج المضبوطة",
  "settings.ai.models.default-model": "النموذج الافتراضي",

  "settings.section.ai.providers": "المزوّدون",
  "settings.ai.providers.provider-count": "المزوّدون المضبوطون",
  "settings.ai.providers.provider-endpoint": "عنوان المزوّد",

  "settings.section.ai.routing": "التوجيه",
  "settings.ai.routing.routing-strategy": "استراتيجية التوجيه",
  "settings.ai.routing.fallback-order": "ترتيب التراجع",

  "settings.section.ai.context": "السياق",
  "settings.ai.context.context-window": "نافذة السياق",
  "settings.ai.context.context-policy": "سياسة السياق",

  "settings.section.ai.local-models": "النماذج المحلية",
  "settings.ai.local-models.local-runner": "المُشغِّل المحلي",
  "settings.ai.local-models.local-model-path": "موضع النموذج المحلي",

  "settings.section.agents.defaults": "الافتراضيات",
  "settings.agents.defaults.default-agent": "الوكيل الافتراضي",
  "settings.agents.defaults.default-timeout": "المهلة الافتراضية",

  "settings.section.agents.execution": "التنفيذ",
  "settings.agents.execution.max-parallel-missions": "المهام المتوازية",
  "settings.agents.execution.execution-mode": "نمط التنفيذ",

  "settings.section.agents.approvals": "الموافقات",
  "settings.agents.approvals.approval-timeout": "مهلة الموافقة",
  "settings.agents.approvals.require-approval": "اشتراط الموافقة",

  "settings.section.agents.permissions": "الأذونات",
  "settings.agents.permissions.filesystem-scope": "نطاق الملفات",
  "settings.agents.permissions.network-scope": "نطاق الشبكة",

  "settings.section.agents.safety": "الأمان",
  "settings.agents.safety.panic-stop-hotkey": "اختصار الإيقاف الطارئ",
  "settings.agents.safety.safety-profile": "ملف الأمان",

  "settings.section.data.projects": "المشاريع",
  "settings.data.projects.project-root": "مجلد المشاريع",
  "settings.data.projects.project-count": "المشاريع",

  "settings.section.data.memory": "الذاكرة",
  "settings.data.memory.memory-store": "مخزن الذاكرة",
  "settings.data.memory.memory-retention-days": "مدة الاحتفاظ",

  "settings.section.data.storage": "التخزين",
  "settings.data.storage.storage-root": "مجلد التخزين",
  "settings.data.storage.storage-quota-mb": "حدّ التخزين",

  "settings.section.data.backups": "النسخ الاحتياطي",
  "settings.data.backups.backup-enabled": "نسخ احتياطي تلقائي",
  "settings.data.backups.backup-interval-hours": "فترة النسخ",

  "settings.section.tools.skills": "المهارات",
  "settings.tools.skills.skill-count": "المهارات المثبَّتة",
  "settings.tools.skills.skill-autoload": "تحميل المهارات عند البدء",

  "settings.section.tools.mcp": "MCP",
  "settings.tools.mcp.mcp-server-count": "خوادم MCP",
  "settings.tools.mcp.mcp-autostart": "تشغيل الخوادم تلقائيًا",

  "settings.section.tools.connectors": "الموصّلات",
  "settings.tools.connectors.connector-count": "الموصّلات",
  "settings.tools.connectors.connector-autoconnect": "الاتصال تلقائيًا",

  "settings.section.tools.browser": "المتصفح",
  "settings.tools.browser.browser-engine": "محرّك المتصفح",
  "settings.tools.browser.browser-headless": "التشغيل بلا نافذة",

  "settings.section.tools.computer-use": "التحكّم بالحاسوب",
  "settings.tools.computer-use.computer-use-enabled": "السماح بالتحكّم بالحاسوب",
  "settings.tools.computer-use.screenshot-redaction": "حجب محتوى لقطات الشاشة",

  "settings.section.security.privacy": "الخصوصية",
  "settings.security.privacy.telemetry-enabled": "القياس عن بُعد",
  "settings.security.privacy.crash-reporting": "تقارير الأعطال",

  "settings.section.security.data-egress": "خروج البيانات",
  "settings.security.data-egress.network-egress-performed": "طلبات شبكية أُجريت",
  "settings.security.data-egress.allowed-egress-hosts": "الوجهات المسموح بها",

  "settings.section.security.protected-values": "القيم المحمية",
  "settings.security.protected-values.store-backend": "خلفية التخزين",
  "settings.security.protected-values.stored-entry-count": "المدخلات المخزَّنة",

  "settings.section.security.audit": "التدقيق",
  "settings.security.audit.audit-sink": "وجهة التدقيق",
  "settings.security.audit.audit-retention-days": "مدة حفظ التدقيق",

  "settings.section.security.sandboxing": "العزل",
  "settings.security.sandboxing.desktop-host-confined": "حصر مضيف سطح المكتب",
  "settings.security.sandboxing.executor-confinement-profile": "ملف حصر المُنفِّذ",

  "settings.section.advanced.developer": "المطوّر",
  "settings.advanced.developer.developer-mode": "وضع المطوّر",
  "settings.advanced.developer.devtools-enabled": "أدوات المطوّر",

  "settings.section.advanced.logs": "السجلات",
  "settings.advanced.logs.log-level": "مستوى السجل",
  "settings.advanced.logs.log-retention-days": "مدة حفظ السجلات",

  "settings.section.advanced.diagnostics": "التشخيص",
  "settings.advanced.diagnostics.host-diagnostics-retained": "حفظ تشخيص المضيف محليًا",
  "settings.advanced.diagnostics.diagnostics-export": "تصدير التشخيص",

  "settings.section.advanced.experimental": "التجريبي",
  "settings.advanced.experimental.experimental-flags": "الرايات التجريبية",
  "settings.advanced.experimental.preview-features": "ميزات المعاينة",
};
