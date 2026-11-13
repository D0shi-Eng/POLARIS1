// جذر التطبيق: ترتيب الإقلاع، والتنقّل، وتطبيق اللغة والاتجاه والسمة.
//
// الترتيب هو ما تصفه المعمارية بالضبط: المضيف يجهز، ثم يُحمَّل العارض، ثم يرسل
// `desktop.bootstrap`، ثم يترطّب من الردّ، ثم تصير الرئيسية قابلة للتفاعل. ولا
// خطوة واحدة يخمّن فيها العارض: فشل الإقلاع يعطي شاشة خطأ صادقة قابلة للإعادة،
// ولا يتراجع إلى لغة وسمة وقائمة قدرات يخترعها من عنده.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { DesktopIpcClient } from "../ipc/client";
import type { Phase02Client } from "../ipc/p02-client";
import type { Phase03Client } from "../ipc/p03-client";
import type { Phase04Client } from "../ipc/p04-client";
import type { Phase05Client } from "../ipc/p05-client";
import type { Phase06Client } from "../ipc/p06-client";
import type { Phase08Client } from "../ipc/p08-client";
import type { ResolvedValueV1 } from "../generated/types/desktop-p06-result-v1";
import type { DisplayError } from "../ipc/errors";
import type {
  Availability,
  BootstrapSnapshot,
  ResolvedSetting,
  SettingSectionDescriptor,
} from "../generated/types/desktop-result-v1";
import { createTranslator } from "../localization/translate";
import { directionOf, isLocale, FALLBACK_LOCALE, type LocaleCode } from "../localization/types";
import { hashLocation, type LocationPort } from "../routes/location";
import {
  missionPath,
  resolveRoute,
  ROUTES,
  SECONDARY_ROUTES,
  viewCapabilityIds,
  type RouteDefinition,
} from "../routes/registry";
import { HomeScreen } from "../screens/HomeScreen";
import { NotFoundScreen } from "../screens/NotFoundScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { UnavailableScreen } from "../screens/UnavailableScreen";
import { ModelsScreen } from "../screens/p02/ModelsScreen";
import { ProjectDetailScreen } from "../screens/p02/ProjectDetailScreen";
import { ProjectsScreen } from "../screens/p02/ProjectsScreen";
import { AgentsScreen } from "../screens/p03/AgentsScreen";
import { MissionDetailScreen } from "../screens/p03/MissionDetailScreen";
import { MissionsScreen } from "../screens/p03/MissionsScreen";
import { ProvidersScreen } from "../screens/p02/ProvidersScreen";
import { ActivityScreen } from "../screens/p04/ActivityScreen";
import { ConnectorsScreen } from "../screens/p04/ConnectorsScreen";
import { ToolsScreen } from "../screens/p04/ToolsScreen";
import { BrowserComputerScreen } from "../screens/p05/BrowserComputerScreen";
import { MemoryScreen } from "../screens/p05/MemoryScreen";
import { ConfigScreen } from "../screens/p06/ConfigScreen";
import { DiagnosticsScreen, EventsScreen, HealthScreen, ObservabilityLinks, UsageScreen } from "../screens/p06/ObservabilityScreens";
import { Phase06ConnectorsScreen } from "../screens/p06/Phase06ConnectorsScreen";
import { AgentsCatalogScreen } from "../screens/p08/AgentsCatalogScreen";
import { HomeWorkspace } from "../screens/p08/HomeWorkspace";
import { SchedulesScreen } from "../screens/p08/SchedulesScreen";
import { ProjectWorkspace } from "../screens/p08/ProjectWorkspace";
import { ComputerUseScreen } from "../screens/p08/ComputerUseScreen";
import { CustomizeScreen } from "../screens/p08/CustomizeScreen";
import { LibraryScreen } from "../screens/p08/LibraryScreen";
import { SkillsGallery } from "../screens/p04/SkillsGallery";
import { CommandPalette, type PaletteEntry } from "../ui/components/CommandPalette";
import { SearchDialog } from "../ui/components/SearchDialog";
import { HeaderTools } from "../ui/components/HeaderTools";
import { Icon, ROUTE_ICONS } from "../ui/components/Icon";
import { RailAccount, RailButton, RailLink, RailMissions, RailMore, RailProjects } from "../ui/components/RailMissions";
import { useProjectsChanged } from "../ui/components/ProjectDialogs";
import { useThreadsChanged, type ThreadState } from "../p08/threads";
import { NavItem } from "../ui/components/Sidebar";
import type { ProjectListResultV1 } from "../generated/types/desktop-p02-result-v1";
import type { MissionListResultV1 } from "../generated/types/desktop-p03-result-v1";
import { StateBlock } from "../ui/components/StateBlock";
import { present } from "./availability";
import { NavigationProvider, TranslatorProvider, type Navigation } from "./context";
import { resolveTheme, subscribeToSystemTheme, systemPrefersDark, type ViewPreferences } from "./preferences";
import { Store } from "../state/store";

const MODELS_SECTION = "ai.models";

export interface AppRootProps {
  readonly client: DesktopIpcClient;
  /** عميل Phase-02. غيابه يعني أن شاشات Phase-02 تعرض حالتها غير المتاحة فقط. */
  readonly phase02?: Phase02Client;
  /** عميل Phase-03. غيابه يعني أن شاشات المهام والوكلاء تعرض حالتها غير المتاحة. */
  readonly phase03?: Phase03Client;
  /** عميل Phase-04. غيابه يعني أن شاشات المهارات والموصّلات والنشاط تعرض حالتها. */
  readonly phase04?: Phase04Client;
  /** عميل Phase-05. غيابه يعني أن شاشتَي الذاكرة والمتصفّح والحاسوب تعرضان حالتهما. */
  readonly phase05?: Phase05Client;
  /** عميل Phase-06. غيابه يعني أن الإعدادات تعرض عرض المضيف من Phase-01، والرصد حالته. */
  readonly phase06?: Phase06Client;
  /** عميل Phase-08. غيابه يعني أن الرئيسية بلا مُنشئ، والمهمّة بلا مساحة عمل، والإعدادات بلا أقسامه. */
  readonly phase08?: Phase08Client;
  /** منفذ الموضع. يُحقن في الاختبار ليكون التنقّل معزولًا عن عنوان مشترك. */
  readonly location?: LocationPort;
  /** يُستدعى مرة واحدة بعد أول رسم مكتمل. أداة قياس، لا سلوك منتج. */
  onReady?(outcome: "HYDRATED" | "FAILED"): void;
}

type BootstrapState =
  | { readonly phase: "LOADING" }
  | { readonly phase: "READY"; readonly snapshot: BootstrapSnapshot }
  | { readonly phase: "FAILED"; readonly error: DisplayError };

export function AppRoot({ client, phase02, phase03, phase04, phase05, phase06, phase08, location, onReady }: AppRootProps) {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ phase: "LOADING" });
  const [availability, setAvailability] = useState<Readonly<Record<string, Availability>>>({});
  const [attempt, setAttempt] = useState(0);
  // نتيجة الإقلاع كما يجب أن تُبلَّغ، بعد أن تُرسم لا قبل ذلك.
  const [ready, setReady] = useState<"HYDRATED" | "FAILED" | null>(null);
  const onReadyRef = useRef(onReady);

  const port = useMemo(() => location ?? hashLocation(), [location]);
  const path = useSyncExternalStore(port.subscribe, port.read, port.read);

  const preferenceStore = useMemo(() => new Store<ViewPreferences | null>(null), []);
  const preferences = useSyncExternalStore(
    preferenceStore.subscribe,
    preferenceStore.getSnapshot,
    preferenceStore.getSnapshot,
  );
  // ما قالته لوحة التحكّم (Phase-06) عن الكثافة ولغة التراجع. غيابها يعني الافتراضي.
  const [density, setDensity] = useState<"COMFORTABLE" | "COMPACT">("COMFORTABLE");
  const [fallback, setFallback] = useState<LocaleCode>(FALLBACK_LOCALE);

  /** يطبّق السمة واللغة والكثافة ولغة التراجع كما حلّها المضيف. «اتبع النظام» لا يغيّر شيئًا. */
  const applyEffective = useCallback(
    (values: readonly ResolvedValueV1[]) => {
      const read = (key: string) => values.find((entry) => entry.key === key)?.value;
      const current = preferenceStore.getSnapshot();
      if (current === null) return;
      const theme = read("appearance.theme");
      const language = read("language.locale");
      const nextAppearance = theme === "LIGHT" || theme === "DARK" ? theme : current.appearance;
      const nextLocale = typeof language === "string" && isLocale(language) ? language : current.locale;
      if (nextAppearance !== current.appearance || nextLocale !== current.locale) {
        preferenceStore.set({ locale: nextLocale, appearance: nextAppearance });
      }
      const densityValue = read("appearance.density");
      setDensity(densityValue === "COMPACT" ? "COMPACT" : "COMFORTABLE");
      const fallbackValue = read("language.fallback_locale");
      setFallback(typeof fallbackValue === "string" && isLocale(fallbackValue) ? fallbackValue : FALLBACK_LOCALE);
    },
    [preferenceStore],
  );

  // ── الإقلاع ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setBootstrap({ phase: "LOADING" });
    setReady(null);
    void (async () => {
      const result = await client.bootstrap();
      if (cancelled) return;
      if (!result.ok) {
        setBootstrap({ phase: "FAILED", error: result.error });
        setReady("FAILED");
        return;
      }
      preferenceStore.set({ locale: result.value.locale, appearance: result.value.appearance });
      // الإعداد المحفوظ في لوحة التحكّم يغلب لقطة الإقلاع حين لا يكون «اتبع النظام».
      if (phase06 !== undefined) {
        const effective = await phase06.effectiveConfig();
        if (cancelled) return;
        if (effective.ok) applyEffective(effective.value.values);
      }
      setBootstrap({ phase: "READY", snapshot: result.value });

      const capabilities = await client.capabilityAvailability(viewCapabilityIds());
      if (cancelled) return;
      if (capabilities.ok) {
        const map: Record<string, Availability> = {};
        for (const entry of capabilities.value.capabilities) map[entry.capability_id] = entry.availability;
        setAvailability(map);
      }
      setReady("HYDRATED");
    })();
    return () => {
      cancelled = true;
    };
  }, [client, phase06, attempt, preferenceStore, applyEffective]);

  // ── إشعار الجاهزية ────────────────────────────────────────────────────────
  // التأثير يعمل بعد أن يُثبَّت الرسم في المستند، فمن يقرأ DOM عند الإشعار يرى
  // الهيكل المرطَّب أو شاشة الخطأ فعلًا. الاستدعاء من داخل الإقلاع مباشرةً كان
  // يسبق الرسم المجمَّع في React 18، فقرأت مجموعة E2E الأصلية صفحةً لم تُرسم بعد.
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (ready !== null) onReadyRef.current?.(ready);
  }, [ready]);

  const locale = (preferences?.locale ?? "en") as LocaleCode;
  const direction = directionOf(locale);
  const appearance = preferences?.appearance ?? "SYSTEM";
  const prefersDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false);
  const theme = resolveTheme(appearance, prefersDark);

  // ── تطبيق اللغة والاتجاه والسمة على المستند ───────────────────────────────
  useEffect(() => {
    const root = globalThis.document?.documentElement;
    if (root === undefined) return;
    root.setAttribute("lang", locale);
    root.setAttribute("dir", direction);
    root.setAttribute("data-theme", theme);
  }, [locale, direction, theme]);

  const translator = useMemo(() => createTranslator(locale, undefined, fallback), [locale, fallback]);

  useEffect(() => {
    globalThis.document?.documentElement.setAttribute("data-density", density === "COMPACT" ? "compact" : "comfortable");
  }, [density]);

  const navigation = useMemo<Navigation>(
    () => ({
      current: resolveRoute(path),
      requestedPath: path,
      navigate: (next: string) => port.write(next),
    }),
    [path, port],
  );

  // ── الشريط الجانبي: آخر المهامّ، والبحث السريع، وطيّ الشريط ─────────────────────
  const missionsAvailable = phase03 !== undefined && availability["polaris.desktop.missions"]?.state === "AVAILABLE";
  const [railMissions, setRailMissions] = useState<MissionListResultV1["missions"]>([]);
  const [followUps, setFollowUps] = useState<readonly { readonly mission_id: string; readonly thread_id: string }[]>([]);
  const [threadStates, setThreadStates] = useState<readonly ThreadState[]>([]);
  const [railTick, setRailTick] = useState(0);
  // تغيير من قائمة «⋯» أو من حوار مشروع: يُعاد الشريط من المضيف فورًا، لا بعد التنقّل التالي.
  const bumpRail = useCallback(() => setRailTick((t) => t + 1), []);
  useThreadsChanged(bumpRail);
  useProjectsChanged(bumpRail);
  useEffect(() => {
    if (!missionsAvailable || phase03 === undefined) return;
    let cancelled = false;
    // تُقرأ عند كل تنقّل وكل بضع ثوانٍ: مهمّة أُنشئت للتوّ تظهر في الشريط، ودوّارها يتوقّف حين تنتهي.
    void phase03.listMissions().then((result) => {
      if (!cancelled && result.ok) setRailMissions(result.value.missions);
    });
    if (phase08 !== undefined) {
      void phase08.conversationIndex().then((result) => {
        if (!cancelled && result.ok) {
          setFollowUps(result.value.follow_ups);
          setThreadStates(result.value.threads ?? []);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [missionsAvailable, phase03, phase08, path, railTick]);
  const anyLive = railMissions.some((m) => ["PLANNING", "READY", "RUNNING", "VERIFYING", "CREATED"].includes(m.state));
  useEffect(() => {
    if (!anyLive) return;
    const id = setInterval(() => setRailTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, [anyLive]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      // Ctrl+Shift+O مهمّة جديدة، كما في مانوس.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        port.write("/");
        setTimeout(() => globalThis.document?.getElementById("composer-input")?.focus(), 60);
      }
    };
    globalThis.addEventListener?.("keydown", onKey);
    return () => globalThis.removeEventListener?.("keydown", onKey);
  }, [port]);

  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
    try {
      return globalThis.localStorage?.getItem("polaris.rail.collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleRail = useCallback(() => {
    setRailCollapsed((collapsed) => {
      try {
        globalThis.localStorage?.setItem("polaris.rail.collapsed", collapsed ? "0" : "1");
      } catch {
        // تفضيل عرض لهذا الجهاز فقط؛ غياب التخزين لا يغيّر شيئًا
      }
      return !collapsed;
    });
  }, []);

  const newMission = useCallback(() => {
    port.write("/");
    // التركيز على المُنشئ بعد أن تُرسم الرئيسية
    setTimeout(() => globalThis.document?.getElementById("composer-input")?.focus(), 60);
  }, [port]);

  const paletteEntries = useMemo<readonly PaletteEntry[]>(() => {
    const pages = [...ROUTES, ...SECONDARY_ROUTES.filter((r) => ["schedules", "artifacts", "models", "providers", "tools", "usage", "health"].includes(r.id))].map((r) => ({
      id: `route-${r.id}`,
      label: translator.t(r.labelKey),
      hint: translator.t("ui.palette.kind.page"),
      icon: ROUTE_ICONS[r.id] ?? (r.id === "schedules" ? "schedule" : r.id === "artifacts" ? "library" : "sparkle"),
      path: r.path,
    }));
    const missions = [...railMissions]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((m) => ({ id: `mission-${m.mission_id}`, label: m.title, hint: translator.t(`p03.mission_state.${m.state}`), icon: "missions" as const, path: missionPath(m.mission_id) }));
    return [...missions, ...pages];
  }, [railMissions, translator]);

  const currentNav = navigation.current?.parentId ?? navigation.current?.id;
  // آخر صفحة غير الإعدادات: تبقى خلف حوار الإعدادات، وإليها يعود الإغلاق.
  const behindRef = useRef("/");
  // «المزوّدون» و«النماذج» صفحتان داخل الإعدادات (ADR-037، كما في OpenCode): مساراهما يفتحان الحوار عليهما.
  const settingsRoute = navigation.current?.id === "settings" || ((navigation.current?.id === "providers" || navigation.current?.id === "models") && phase02 !== undefined);
  const settingsDialog = settingsRoute && phase06 !== undefined;
  const settingsSection = navigation.current?.id === "providers" ? "PROVIDERS" : navigation.current?.id === "models" ? "MODELS" : undefined;
  if (!settingsDialog && navigation.current !== undefined && navigation.current.id !== "settings") behindRef.current = path;
  const behindPath = behindRef.current;
  // Esc يغلق حوار الإعدادات كما يغلق بقية الحوارات (صفحة الاختصارات تقول ذلك).
  useEffect(() => {
    if (!settingsDialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) port.write(behindRef.current);
    };
    const target = globalThis.document;
    target?.addEventListener("keydown", onKey);
    return () => target?.removeEventListener("keydown", onKey);
  }, [settingsDialog, port]);
  const projectsAvailable = phase02 !== undefined && availability["polaris.desktop.projects"]?.state === "AVAILABLE";
  const [railProjects, setRailProjects] = useState<ProjectListResultV1["projects"]>([]);
  useEffect(() => {
    if (!projectsAvailable || phase02 === undefined) return;
    let cancelled = false;
    void phase02.listProjects().then((result) => {
      if (!cancelled && result.ok) setRailProjects(result.value.projects);
    });
    return () => {
      cancelled = true;
    };
  }, [projectsAvailable, phase02, path, railTick]);

  const presentedAvailability = useMemo(() => {
    const map: Record<string, ReturnType<typeof present>> = {};
    for (const id of viewCapabilityIds()) {
      const entry = availability[id];
      // غياب الجواب ليس «متاح»: يبقى مجهولًا حتى يقول المضيف.
      map[id] = present(entry ?? { state: "UNAVAILABLE", reason: "RUNTIME_UNAVAILABLE" });
    }
    return map;
  }, [availability]);

  if (bootstrap.phase === "LOADING") {
    return (
      <TranslatorProvider translator={translator}>
        <main className="centered">
          <StateBlock kind="loading" titleKey="bootstrap.loading" />
        </main>
      </TranslatorProvider>
    );
  }

  if (bootstrap.phase === "FAILED") {
    return (
      <TranslatorProvider translator={translator}>
        <main className="centered">
          <StateBlock
            kind="error"
            titleKey="bootstrap.error.title"
            bodyKey="bootstrap.error.body"
            code={bootstrap.error.code}
            action={{ labelKey: "state.retry", onSelect: () => setAttempt((value) => value + 1) }}
          />
        </main>
      </TranslatorProvider>
    );
  }

  return (
    <TranslatorProvider translator={translator}>
      <NavigationProvider navigation={navigation}>
        <a className="skip-link" href="#main-content">
          {translator.t("a11y.skip_to_content")}
        </a>
        <div className={railCollapsed ? "shell is-rail-collapsed" : "shell"}>
          <header className="shell__header" role="banner" aria-label={translator.t("layout.banner")}>
            <button
              type="button"
              className="icon-button shell__rail-toggle"
              onClick={toggleRail}
              aria-label={translator.t(railCollapsed ? "ui.rail.expand" : "ui.rail.collapse")}
              aria-expanded={!railCollapsed}
            >
              <Icon name="sidebar" />
            </button>
          </header>

          <div className="shell__rail">
            {/* ترتيب الشريط كما في مانوس: مهمّة جديدة، العميل، بحث، مهارات، الإضافات، مجدول، مكتبة؛ ثم المشاريع،
                ثم المهامّ، وفي الأسفل صفّ المستخدم يفتح قائمة فيها الإعدادات وبقية الوجهات. الوجهات العشر كلها بنود
                حقيقية (NavItem)؛ عنوانا المشاريع والمهامّ بندان أيضًا. */}
            <nav className="nav" aria-label={translator.t("nav.landmark")}>
              <ul className="nav__list rail-tools">
                {/* ترتيب مانوس 2.0 (قِيس 2026-10-05): مهمّة جديدة، أجهزة الكمبيوتر، الوكلاء، بحث، المكتبة، الإنشاءات،
                    الأتمتة، الإضافات، المزيد. الأسماء أسماء مانوس، والوجهات وجهات POLARIS الحقيقية. */}
                <RailButton icon="edit" label={translator.t("ui.rail.new_mission")} onSelect={newMission} shortcut="Control+Shift+O" />
                <NavItem routeId="browser-computer" availability={presentedAvailability} currentId={currentNav} labelKey="ui.rail.computers" />
                <NavItem routeId="agents" availability={presentedAvailability} currentId={currentNav} />
                <RailButton icon="search" label={translator.t("ui.rail.search")} onSelect={() => setPaletteOpen(true)} />
                {missionsAvailable ? <RailLink path="/artifacts" currentPath={path} icon="library" labelKey="ui.rail.library" onOpen={(next) => port.write(next)} /> : null}
                {missionsAvailable ? <RailLink path="/creations" currentPath={path} icon="creations" labelKey="ui.rail.creations" onOpen={(next) => port.write(next)} /> : null}
                {missionsAvailable ? <RailLink path="/schedules" currentPath={path} icon="automation" labelKey="ui.rail.automation" onOpen={(next) => port.write(next)} /> : null}
                <NavItem routeId="connectors" availability={presentedAvailability} currentId={currentNav} labelKey="ui.rail.addons" />
                {/* «المزيد» كما في مانوس 2.0 (قِيس 2026-10-06): Computer Use، ومهارات، وتخصيص؛ والبند الحالي بعلامة ✓. */}
                <RailMore currentPath={path} active={path === "/computer-use" || currentNav === "skills" || currentNav === "memory"}>
                  <ul className="nav__list">
                    <RailLink path="/computer-use" currentPath={path} icon="cursor-screen" labelKey="ui.rail.computer_use" onOpen={(next) => port.write(next)} />
                    <NavItem routeId="skills" availability={presentedAvailability} currentId={currentNav} labelKey="ui.rail.skills" icon="puzzle" />
                    <NavItem routeId="memory" availability={presentedAvailability} currentId={currentNav} labelKey="ui.rail.customize" icon="customize" />
                  </ul>
                </RailMore>
              </ul>
              <RailProjects
                projects={railProjects}
                missions={railMissions}
                followUps={followUps}
                states={threadStates}
                phase08={phase08}
                phase02={phase02}
                currentPath={path}
                onOpen={(next) => port.write(next)}
              />
              {missionsAvailable ? (
                <RailMissions
                  missions={railMissions}
                  followUps={followUps}
                  states={threadStates}
                  projects={railProjects}
                  phase08={phase08}
                  phase02={phase02}
                  currentPath={path}
                  onOpen={(next) => port.write(next)}
                  onNew={newMission}
                />
              ) : null}
            </nav>
            <div className="rail-footer">
              <RailAccount currentPath={path} onSettings={() => port.write("/settings")}>
                <ul className="nav__list">
                  <NavItem routeId="settings" availability={presentedAvailability} currentId={currentNav} />
                  <NavItem routeId="home" availability={presentedAvailability} currentId={currentNav} />
                  {/* الصفحات الكاملة للمشاريع والمهامّ والمراقبة: ليست في شريط مانوس، فمكانها قائمة الحساب. */}
                  <NavItem routeId="projects" availability={presentedAvailability} currentId={currentNav} labelKey="ui.rail.all_projects" />
                  <NavItem routeId="missions" availability={presentedAvailability} currentId={currentNav} labelKey="ui.rail.all_missions" />
                  <NavItem routeId="activity" availability={presentedAvailability} currentId={currentNav} labelKey="ui.rail.observe" />
                </ul>
                <HeaderTools
                  locale={locale}
                  appearance={appearance}
                  onLocaleChange={(next) => preferenceStore.set({ locale: next, appearance })}
                  onAppearanceChange={(next) => preferenceStore.set({ locale, appearance: next })}
                />
              </RailAccount>
            </div>
          </div>

          {settingsDialog && phase06 !== undefined ? (
            <div className="dialog-backdrop settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && port.write(behindPath)}>
              <div className="dialog settings-dialog" role="dialog" aria-modal="true" aria-label={translator.t("nav.settings")}>
                <button type="button" className="icon-button settings-dialog__close" aria-label={translator.t("ui.close")} title={translator.t("ui.close")} onClick={() => port.write(behindPath)}>
                  <Icon name="close" />
                </button>
                <ConfigScreen client={phase06} onEffective={applyEffective} phase08={phase08} snapshot={bootstrap.snapshot} phase02={phase02} initialSection={settingsSection} />
              </div>
            </div>
          ) : null}

          <main className="shell__main" id="main-content" role="main" aria-label={translator.t("layout.main")} tabIndex={-1}>
            <div className="shell__content">
              {/* الإعدادات حوار فوق الصفحة السابقة كما في مانوس: الصفحة تبقى خلفه، وزرّ الإغلاق يعيدها. */}
              <Screen
                client={client}
                phase02={phase02}
                phase03={phase03}
                phase04={phase04}
                phase05={phase05}
                phase06={phase06}
                phase08={phase08}
                onEffective={applyEffective}
                route={settingsDialog ? resolveRoute(behindPath) : navigation.current}
                requestedPath={settingsDialog ? behindPath : navigation.requestedPath}
                snapshot={bootstrap.snapshot}
                availability={availability}
              />
            </div>
          </main>
        </div>
        {/* البحث كما في مانوس حين تتوفّر المحادثة؛ وإلا لوحة التنقّل بالعناوين كما كانت. */}
        {phase08 !== undefined ? (
          <SearchDialog open={paletteOpen} phase08={phase08} pages={paletteEntries.filter((e) => e.id.startsWith("route-"))} onSelect={(next) => port.write(next)} onNew={newMission} onClose={() => setPaletteOpen(false)} />
        ) : (
          <CommandPalette open={paletteOpen} entries={paletteEntries} onSelect={(next) => port.write(next)} onClose={() => setPaletteOpen(false)} />
        )}
      </NavigationProvider>
    </TranslatorProvider>
  );
}

function Screen({
  client,
  phase02,
  phase03,
  phase04,
  phase05,
  phase06,
  phase08,
  onEffective,
  route,
  requestedPath,
  snapshot,
  availability,
}: {
  readonly client: DesktopIpcClient;
  readonly phase02: Phase02Client | undefined;
  readonly phase03: Phase03Client | undefined;
  readonly phase04: Phase04Client | undefined;
  readonly phase05: Phase05Client | undefined;
  readonly phase06: Phase06Client | undefined;
  readonly phase08: Phase08Client | undefined;
  onEffective(values: readonly ResolvedValueV1[]): void;
  readonly route: RouteDefinition | undefined;
  readonly requestedPath: string;
  readonly snapshot: BootstrapSnapshot;
  readonly availability: Readonly<Record<string, Availability>>;
}) {
  if (route === undefined) return <NotFoundScreen requestedPath={requestedPath} />;
  if (route.id === "home") {
    const providers = phase02 !== undefined && availability["polaris.desktop.providers"]?.state === "AVAILABLE";
    const workspace =
      phase03 !== undefined && availability["polaris.desktop.missions"]?.state === "AVAILABLE" ? <HomeWorkspace phase02={phase02} phase03={phase03} phase06={phase06} phase08={phase08} /> : null;
    return <HomeSurface client={client} snapshot={snapshot} managePath={providers ? "/models" : "/settings"} workspace={workspace} />;
  }
  if (route.id === "settings") {
    return phase06 === undefined ? <SettingsSurface client={client} /> : <ConfigScreen client={phase06} onEffective={onEffective} phase08={phase08} snapshot={snapshot} />;
  }
  if (route.id === "settings-host") return <SettingsSurface client={client} />;
  // الرصد (Phase-06) تحت قدرة النشاط، بالقاعدة نفسها: قدرة متاحة وعميل موجود.
  if (phase06 !== undefined && availability[route.capabilityId]?.state === "AVAILABLE") {
    if (route.id === "health") return <HealthScreen client={phase06} />;
    if (route.id === "events") return <EventsScreen client={phase06} />;
    if (route.id === "usage") return <UsageScreen client={phase06} />;
    if (route.id === "diagnostics") return <DiagnosticsScreen client={phase06} />;
    if (route.id === "connectors") return <Phase06ConnectorsScreen client={phase06} phase04={phase04} phase08={phase08} />;
    if (route.id === "activity" && phase04 !== undefined) return <ActivityScreen client={phase04} links={<ObservabilityLinks />} />;
  }
  // شاشة Phase-02 تُرسم فقط حين يقول المضيف إن قدرتها متاحة. غير ذلك حالة معلنة.
  const ready = phase02 !== undefined && availability[route.capabilityId]?.state === "AVAILABLE";
  if (ready && phase02 !== undefined) {
    if (route.id === "providers") return <ProvidersScreen client={phase02} />;
    if (route.id === "models") return <ModelsScreen client={phase02} />;
    if (route.id === "projects") return <ProjectsScreen client={phase02} />;
    if (route.id === "project-detail" && route.param !== undefined) {
      // صفحة المشروع على نمط مانوس حين تتوفّر المحادثة (Phase-03 وPhase-08)، وإلا الألسنة التفصيلية كما كانت.
      if (phase03 !== undefined && phase08 !== undefined) return <ProjectWorkspace key={route.param} projectId={route.param} phase02={phase02} phase03={phase03} phase08={phase08} />;
      return <ProjectDetailScreen key={route.param} client={phase02} projectId={route.param} />;
    }
  }
  // شاشات Phase-03 تُرسم بالقاعدة نفسها: قدرة متاحة وعميل موجود، وإلا حالة معلنة.
  if (phase03 !== undefined && availability[route.capabilityId]?.state === "AVAILABLE") {
    if (route.id === "missions") return <MissionsScreen client={phase03} />;
    // الوكلاء: كتالوج المتخصّصين حين يتوفّر Phase-08، وإلا أدوار سير العمل وحدها كما كانت.
    if (route.id === "agents") return phase08 !== undefined ? <AgentsCatalogScreen phase03={phase03} phase08={phase08} /> : <AgentsScreen client={phase03} />;
    if (route.id === "mission-detail" && route.param !== undefined) {
      return <MissionDetailScreen key={route.param} client={phase03} phase02={phase02} phase04={phase04} phase05={phase05} phase08={phase08} missionId={route.param} />;
    }
    if (route.id === "schedules" && phase08 !== undefined) return <SchedulesScreen client={phase08} phase02={phase02} />;
    // المكتبة على نمط مانوس: مجمّعة بالمحادثة، بألسنة الأنواع.
    if (route.id === "artifacts" && phase08 !== undefined) return <LibraryScreen client={phase08} phase03={phase03} />;
    if (route.id === "creations" && phase08 !== undefined) return <LibraryScreen key="creations" client={phase08} phase03={phase03} variant="creations" />;
  }
  // شاشات Phase-04 بالقاعدة نفسها كذلك. لا استثناء لأي طبقة.
  if (phase04 !== undefined && availability[route.capabilityId]?.state === "AVAILABLE") {
    // المهارات بطاقاتٍ على نمط مانوس، والجدول القديم في «العرض التقني» داخلها.
    if (route.id === "skills") return <SkillsGallery client={phase04} />;
    if (route.id === "tools") return <ToolsScreen client={phase04} />;
    if (route.id === "connectors") return <ConnectorsScreen client={phase04} {...(phase08 !== undefined ? { phase08 } : {})} />;
    if (route.id === "activity") return <ActivityScreen client={phase04} />;
  }
  // شاشتا Phase-05 بالقاعدة نفسها: قدرة متاحة وعميل موجود، وإلا حالة معلنة.
  if (phase05 !== undefined && availability[route.capabilityId]?.state === "AVAILABLE") {
    // الذاكرة بطبقاتها بلغة المستخدم حين يتوفّر «تذكّر هذا» (Phase-08)، وإلا العرض التقني وحده.
    // «تخصيص» كما في مانوس: الملف الشخصي والمعرفة. بلا Phase-08 يبقى العرض التقني للذاكرة وحده.
    if (route.id === "memory") return phase08 !== undefined ? <CustomizeScreen phase05={phase05} phase08={phase08} /> : <MemoryScreen client={phase05} />;
    if (route.id === "computer-use") return <ComputerUseScreen />;
    if (route.id === "browser-computer")
      return phase03 === undefined ? <BrowserComputerScreen client={phase05} platform={snapshot.platform} /> : <BrowserComputerScreen client={phase05} missions={phase03} platform={snapshot.platform} />;
  }
  return <UnavailableScreen route={route} availability={availability[route.capabilityId]} />;
}

/** الرئيسية تقرأ عدد النماذج من الإعدادات؛ لا تحسبه ولا تفترضه. */
function HomeSurface({
  client,
  snapshot,
  managePath,
  workspace,
}: {
  readonly client: DesktopIpcClient;
  readonly snapshot: BootstrapSnapshot;
  readonly managePath: string;
  readonly workspace: React.ReactNode;
}) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await client.settingsRead(MODELS_SECTION, ["configured-model-count"]);
      if (cancelled || !result.ok) return;
      const setting = result.value.settings.find((entry) => entry.setting_id === "configured-model-count");
      const value = setting?.value?.integer_value;
      setCount(typeof value === "number" ? value : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  return <HomeScreen snapshot={snapshot} configuredModelCount={count} managePath={managePath} workspace={workspace} />;
}

function SettingsSurface({ client }: { readonly client: DesktopIpcClient }) {
  const [sections, setSections] = useState<readonly SettingSectionDescriptor[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [values, setValues] = useState<readonly ResolvedSetting[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const described = await client.settingsDescribe();
      if (cancelled) return;
      if (!described.ok) {
        setError(described.error);
        setLoading(false);
        return;
      }
      setSections(described.value.sections);
      setSelected((current) => (current === "" ? (described.value.sections[0]?.section_id ?? "") : current));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  useEffect(() => {
    if (selected === "") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const read = await client.settingsRead(selected);
      if (cancelled) return;
      if (!read.ok) {
        setError(read.error);
        setValues(null);
      } else {
        setValues(read.value.settings);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, selected, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return (
    <SettingsScreen
      sections={sections}
      selectedSectionId={selected}
      values={values}
      loading={loading}
      error={error}
      onSelectSection={setSelected}
      onRetry={retry}
    />
  );
}
