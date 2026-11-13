// سجل المسارات.
//
// مُعلَن كبيانات لا كشجرة JSX، ولا منطق توجيه داخل مكوّن الشريط الجانبي: الشريط
// يعرض السجل، ولا يملكه. وكل وجهة مربوطة بمعرّف قدرة، فحالتها تأتي من المضيف لا
// من ثابت وقت بناء.

export const ROUTE_IDS = [
  "home",
  "projects",
  "missions",
  "agents",
  "skills",
  "browser-computer",
  "memory",
  "connectors",
  "activity",
  "settings",
] as const;

export type NavigationRouteId = (typeof ROUTE_IDS)[number];

/** وجهات خارج الشريط الجانبي: تُفتح من صفحة، لا من التنقّل الرئيسي. */
export const SECONDARY_ROUTE_IDS = [
  "providers",
  "models",
  "project-detail",
  "mission-detail",
  "tools",
  "health",
  "events",
  "usage",
  "diagnostics",
  "settings-host",
  "schedules",
  "artifacts",
  "creations",
  "computer-use",
] as const;

export type RouteId = NavigationRouteId | (typeof SECONDARY_ROUTE_IDS)[number];

/** كيف تُرسم الوجهة. `SHELL` مبنيّة، و`CAPABILITY` تعرض حالة قدرتها. */
export type RouteKind = "SHELL" | "CAPABILITY";

export interface RouteDefinition {
  readonly id: RouteId;
  /** المسار داخل التطبيق. يبدأ دائمًا بشرطة مائلة. */
  readonly path: string;
  readonly labelKey: string;
  /** القدرة التي تحكم هذه الوجهة في المضيف. */
  readonly capabilityId: string;
  readonly kind: RouteKind;
  /** الوجهة التي يُبرزها الشريط الجانبي حين تكون هذه مفتوحة. */
  readonly parentId?: NavigationRouteId;
  /** معامل المسار، إن وُجد (معرّف المشروع). */
  readonly param?: string;
}

export const ROUTES: readonly RouteDefinition[] = [
  { id: "home", path: "/", labelKey: "nav.home", capabilityId: "polaris.desktop.home", kind: "SHELL" },
  { id: "projects", path: "/projects", labelKey: "nav.projects", capabilityId: "polaris.desktop.projects", kind: "CAPABILITY" },
  { id: "missions", path: "/missions", labelKey: "nav.missions", capabilityId: "polaris.desktop.missions", kind: "CAPABILITY" },
  { id: "agents", path: "/agents", labelKey: "nav.agents", capabilityId: "polaris.desktop.agents", kind: "CAPABILITY" },
  { id: "skills", path: "/skills", labelKey: "nav.skills", capabilityId: "polaris.desktop.skills", kind: "CAPABILITY" },
  {
    id: "browser-computer",
    path: "/browser-computer",
    labelKey: "nav.browser-computer",
    capabilityId: "polaris.desktop.browser-computer",
    kind: "CAPABILITY",
  },
  { id: "memory", path: "/memory", labelKey: "nav.memory", capabilityId: "polaris.desktop.memory", kind: "CAPABILITY" },
  { id: "connectors", path: "/connectors", labelKey: "nav.connectors", capabilityId: "polaris.desktop.connectors", kind: "CAPABILITY" },
  { id: "activity", path: "/activity", labelKey: "nav.activity", capabilityId: "polaris.desktop.activity", kind: "CAPABILITY" },
  { id: "settings", path: "/settings", labelKey: "nav.settings", capabilityId: "polaris.desktop.settings", kind: "SHELL" },
];

/**
 * الوجهات الثانوية. الحالة تأتي من قدرة المضيف نفسها كما في الوجهات الرئيسية:
 * المزوّدون والنماذج تحت قدرة المزوّدين، وتفاصيل المشروع تحت قدرة المشاريع.
 */
export const SECONDARY_ROUTES: readonly RouteDefinition[] = [
  {
    id: "providers",
    path: "/providers",
    labelKey: "nav.providers",
    capabilityId: "polaris.desktop.providers",
    kind: "CAPABILITY",
    parentId: "home",
  },
  {
    id: "models",
    path: "/models",
    labelKey: "nav.models",
    capabilityId: "polaris.desktop.providers",
    kind: "CAPABILITY",
    parentId: "home",
  },
  // سجل الأدوات يُفتح من شاشة المهارات. ليس وجهة في الشريط الجانبي: هو قراءة
  // للسجل لا قسم قائم بنفسه، وحالته حالة قدرة المهارات نفسها.
  {
    id: "tools",
    path: "/tools",
    labelKey: "nav.tools",
    capabilityId: "polaris.desktop.skills",
    kind: "CAPABILITY",
    parentId: "skills",
  },
  // الرصد (Phase-06) يُفتح من شاشة النشاط: صحّة النظام، والأحداث المُهيكلة، والاستعمال
  // والكلفة، والتشخيص. ليست بنودًا في الشريط الجانبي، وحالتها حالة قدرة النشاط.
  { id: "health", path: "/health", labelKey: "nav.health", capabilityId: "polaris.desktop.activity", kind: "CAPABILITY", parentId: "activity" },
  { id: "events", path: "/events", labelKey: "nav.events", capabilityId: "polaris.desktop.activity", kind: "CAPABILITY", parentId: "activity" },
  { id: "usage", path: "/usage", labelKey: "nav.usage", capabilityId: "polaris.desktop.activity", kind: "CAPABILITY", parentId: "activity" },
  {
    id: "diagnostics",
    path: "/diagnostics",
    labelKey: "nav.diagnostics",
    capabilityId: "polaris.desktop.activity",
    kind: "CAPABILITY",
    parentId: "activity",
  },
  // Phase-08: المهامّ المجدولة وكل المخرجات، تحت قدرة المهامّ نفسها. ليست بنودًا في الشريط.
  { id: "schedules", path: "/schedules", labelKey: "nav.schedules", capabilityId: "polaris.desktop.missions", kind: "CAPABILITY", parentId: "missions" },
  { id: "artifacts", path: "/artifacts", labelKey: "nav.artifacts", capabilityId: "polaris.desktop.missions", kind: "CAPABILITY", parentId: "missions" },
  // الإنشاءات (مانوس 2.0): ما بناه POLARIS من مواقع وتطبيقات وألعاب، أي مخرجات الويب في المكتبة نفسها.
  { id: "creations", path: "/creations", labelKey: "nav.creations", capabilityId: "polaris.desktop.missions", kind: "CAPABILITY", parentId: "missions" },
  // «Computer Use» من «المزيد» (مانوس 2.0): التحكّم بسطح المكتب ومتصفّح POLARIS ومهارات التطبيقات، تحت قدرة الحاسوب.
  { id: "computer-use", path: "/computer-use", labelKey: "nav.computer-use", capabilityId: "polaris.desktop.browser-computer", kind: "CAPABILITY" },
  // عرض المضيف من Phase-01 كما هو، حين تصير «الإعدادات» لوحة التحكّم في Phase-06.
  {
    id: "settings-host",
    path: "/settings/host",
    labelKey: "nav.settings-host",
    capabilityId: "polaris.desktop.settings",
    kind: "SHELL",
    parentId: "settings",
  },
];

const PROJECT_DETAIL = /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const MISSION_DETAIL = /^\/missions\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

/** مسار تفاصيل مشروع. المعرّف وحده يدخل المسار، بصيغة العقد. */
export function projectPath(projectId: string): string {
  return `/projects/${projectId}`;
}

/** مسار تفاصيل مهمّة. المعرّف وحده يدخل المسار، بصيغة العقد. */
export function missionPath(missionId: string): string {
  return `/missions/${missionId}`;
}

export const HOME_ROUTE: RouteDefinition = ROUTES[0] as RouteDefinition;

export function routeById(id: string): RouteDefinition | undefined {
  return ROUTES.find((route) => route.id === id);
}

/**
 * يحلّ مسارًا نصيًّا إلى وجهة.
 *
 * مسار غير معروف لا يرمي ولا يُفرغ الشاشة: يعود `undefined`، وطبقة التطبيق تعرض
 * صفحة «لا قسم بهذا الاسم» مع طريق عودة. الفشل الآمن هو أن يبقى الشريط الجانبي
 * قائمًا والمستخدم قادرًا على المتابعة.
 */
export function resolveRoute(path: string): RouteDefinition | undefined {
  const normalised = normalisePath(path);
  const direct = ROUTES.find((route) => route.path === normalised) ?? SECONDARY_ROUTES.find((route) => route.path === normalised);
  if (direct !== undefined) return direct;
  const detail = PROJECT_DETAIL.exec(normalised);
  if (detail !== null) {
    return {
      id: "project-detail",
      path: normalised,
      labelKey: "project.detail.title",
      capabilityId: "polaris.desktop.projects",
      kind: "CAPABILITY",
      parentId: "projects",
      param: detail[1] ?? "",
    };
  }
  const mission = MISSION_DETAIL.exec(normalised);
  if (mission === null) return undefined;
  return {
    id: "mission-detail",
    path: normalised,
    labelKey: "mission.detail.title",
    capabilityId: "polaris.desktop.missions",
    kind: "CAPABILITY",
    parentId: "missions",
    param: mission[1] ?? "",
  };
}

/** يوحّد شكل المسار: شرطة بادئة واحدة، بلا شرطة لاحقة، بلا استعلام ولا جزء. */
export function normalisePath(path: string): string {
  const withoutFragment = path.split("#")[0] ?? "";
  const withoutQuery = withoutFragment.split("?")[0] ?? "";
  const trimmed = withoutQuery.trim();
  if (trimmed === "" || trimmed === "/") return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

/** كل القدرات التي تحتاج الواجهة حالتها: الشريط الجانبي والوجهات الثانوية. */
export function viewCapabilityIds(): readonly string[] {
  return [...new Set([...navigationCapabilityIds(), ...SECONDARY_ROUTES.map((route) => route.capabilityId)])];
}

/** كل معرّفات القدرات التي يحتاج الشريط الجانبي حالتها. */
export function navigationCapabilityIds(): readonly string[] {
  return ROUTES.map((route) => route.capabilityId);
}
