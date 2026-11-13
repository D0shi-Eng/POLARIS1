// أجزاء الشريط الجانبي على نمط مانوس: بنود الأدوات، والمشاريع، والمهامّ، وصفّ المستخدم في الأسفل.
//
// الشريط يقرأ قائمة المهامّ والمشاريع كما قالها المضيف؛ ما يكتبه (قائمة «⋯»، وحوارات المشروع) نداءات مضيف
// صريحة ثم إعادة قراءة. الأزرار هنا ليست بنود تنقّل رئيسية
// (لا `nav__item`)، فعدد الوجهات العشر وحالة «الصفحة الحالية» لا يتغيّران.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useTranslator } from "../../app/context";
import type { ProjectListResultV1 } from "../../generated/types/desktop-p02-result-v1";
import type { MissionListResultV1 } from "../../generated/types/desktop-p03-result-v1";
import type { Phase02Client } from "../../ipc/p02-client";
import type { Phase08Client } from "../../ipc/p08-client";
import { stateOf, type ThreadState } from "../../p08/threads";
import { missionPath, projectPath } from "../../routes/registry";
import { DeleteProjectDialog, ProjectDialog } from "./ProjectDialogs";
import { ThreadMenu } from "./ThreadMenu";
import { Icon, type IconName } from "./Icon";
import { MenuItem, Popover } from "./Popover";

type MissionRow = MissionListResultV1["missions"][number];

/** حالات يعمل فيها التشغيل الآن: الصفّ يعرض دوّارًا أزرق. */
const LIVE = ["PLANNING", "READY", "RUNNING", "VERIFYING"];

/** زرّ في قائمة الأدوات أعلى الشريط (مهمّة جديدة، بحث، المجدولة، المكتبة). */
export function RailButton({ icon, label, onSelect, active = false, shortcut }: { readonly icon: IconName; readonly label: string; onSelect(): void; readonly active?: boolean; readonly shortcut?: string }) {
  return (
    <li>
      <button type="button" className={active ? "rail-link is-open" : "rail-link"} onClick={onSelect} {...(active ? { "aria-current": "page" as const } : {})} {...(shortcut === undefined ? {} : { "aria-keyshortcuts": shortcut })}>
        <Icon name={icon} className="nav__icon" />
        <span className="nav__label">{label}</span>
        {shortcut === undefined ? null : <kbd className="rail-link__kbd">{shortcut.replace(/Control/g, "Ctrl").replace(/\+/g, " ")}</kbd>}
        {active ? <Icon name="check" size={15} className="rail-link__check" /> : null}
      </button>
    </li>
  );
}

/** رابط في الشريط لوجهة ثانوية (المجدولة، المكتبة): ليس بندًا رئيسيًّا، فلا `nav__item` ولا «الصفحة الحالية». */
export function RailLink({ path, currentPath, icon, labelKey, onOpen }: { readonly path: string; readonly currentPath: string; readonly icon: IconName; readonly labelKey: string; onOpen(path: string): void }) {
  const translator = useTranslator();
  return <RailButton icon={icon} label={translator.t(labelKey)} active={currentPath === path} onSelect={() => onOpen(path)} />;
}

type ProjectRow = ProjectListResultV1["projects"][number];

/** صفّ محادثة في الشريط: اسمها بأيقونة حالتها، وقائمة «⋯» تظهر عند المرور أو حين تكون مفتوحة. */
function ThreadRow({ row, last, open, thread, phase08, phase02, projects, onOpen, nested = false }: { readonly row: MissionRow; readonly last: MissionRow; readonly open: boolean; readonly thread: ThreadState; readonly phase08?: Phase08Client | undefined; readonly phase02?: Phase02Client | undefined; readonly projects: readonly ProjectRow[]; onOpen(path: string): void; readonly nested?: boolean }) {
  const translator = useTranslator();
  const [menuOpen, setMenuOpen] = useState(false);
  const live = LIVE.includes(last.state);
  const path = missionPath(row.mission_id);
  return (
    <li className={["rail-thread", open ? "is-open" : "", menuOpen ? "is-menu-open" : "", nested ? "is-nested" : ""].filter(Boolean).join(" ")}>
      <button
        type="button"
        className={open ? "rail-missions__item is-open" : "rail-missions__item"}
        title={thread.title}
        onClick={() => onOpen(path)}
        aria-label={`${thread.title} — ${translator.t(`p03.mission_state.${last.state}`)}`}
      >
        {live ? (
          <span className="rail-spinner" aria-hidden="true" />
        ) : (
          <Icon name={last.state === "FAILED" || last.state === "BLOCKED" ? "shield" : last.state === "CREATED" ? "missions" : "report"} size={15} className={`rail-missions__icon state-${last.state.toLowerCase()}`} />
        )}
        <span className="rail-missions__name" dir="auto">
          {thread.title}
        </span>
        {thread.pinned ? <Icon name="pin" size={13} className="rail-thread__pin" /> : null}
      </button>
      {phase08 === undefined ? null : (
        <span className="rail-thread__menu">
          <ThreadMenu thread={thread} phase08={phase08} phase02={phase02} projects={projects} triggerClassName="icon-button rail-thread__more" onOpenChange={setMenuOpen} onDeleted={() => (open ? onOpen("/") : undefined)} />
        </span>
      )}
    </li>
  );
}

/** المحادثات كما يعرضها الشريط: الدور الأول وحده، بحالة آخر دور ووقته، وما قرّره المستخدم فيها. */
export interface ThreadEntry {
  readonly row: MissionRow;
  readonly last: MissionRow;
  readonly thread: ThreadState;
}

export function threadEntries(missions: readonly MissionRow[], followUps: readonly { readonly mission_id: string; readonly thread_id: string }[], states: readonly ThreadState[]): ThreadEntry[] {
  const hidden = new Set(followUps.map((f) => f.mission_id));
  // حالة المحادثة حالةُ آخر دور فيها، ووقتها وقت آخر دور (المحادثة التي تكلّمت فيها للتوّ تعلو القائمة).
  const latest = new Map<string, MissionRow>();
  for (const f of followUps) {
    const m = missions.find((x) => x.mission_id === f.mission_id);
    const seen = latest.get(f.thread_id);
    if (m !== undefined && (seen === undefined || m.created_at > seen.created_at)) latest.set(f.thread_id, m);
  }
  return missions
    .filter((m) => !hidden.has(m.mission_id))
    .map((m) => ({ row: m, last: latest.get(m.mission_id) ?? m, thread: stateOf(states, m.mission_id, m.title, m.project_id) }))
    .sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
}

function openThreadOf(currentPath: string, followUps: readonly { readonly mission_id: string; readonly thread_id: string }[]): string | null {
  return currentPath.startsWith("/missions/") ? (followUps.find((f) => `/missions/${f.mission_id}` === currentPath)?.thread_id ?? currentPath.slice("/missions/".length)) : null;
}

/**
 * رأس قسم في الشريط كما في مانوس 2.0 (قِيس 2026-10-06): العنوان يطوي القسم ويفتحه (سهم يظهر عند المرور أو حين
 * يكون مطويًّا)، وأدوات القسم تظهر عند المرور: في «المهام» مهمّة جديدة والتصفية و«⋯»، وفي «المشاريع» «⋯» و«+».
 */
export function RailHead({ label, collapsed, onToggle, children }: { readonly label: string; readonly collapsed: boolean; onToggle(): void; readonly children?: ReactNode }) {
  return (
    <div className={collapsed ? "rail-head is-collapsed" : "rail-head"}>
      <button type="button" className="rail-head__toggle" aria-expanded={!collapsed} onClick={onToggle}>
        <span className="rail-head__label">{label}</span>
        <Icon name="chevron" size={12} className="rail-head__chevron" />
      </button>
      {children === undefined ? null : <span className="rail-head__tools">{children}</span>}
    </div>
  );
}

type Filter = "none" | "favorites" | "archived";

export interface RailMissionsProps {
  readonly missions: readonly MissionRow[];
  /** مهامّ المتابعة ومحادثاتها: تُعرض داخل محادثتها، لا صفًّا مستقلًّا. */
  readonly followUps?: readonly { readonly mission_id: string; readonly thread_id: string }[];
  /** ما قرّره المستخدم في كل محادثة (تثبيت، مفضّلة، أرشفة). */
  readonly states?: readonly ThreadState[];
  readonly projects?: readonly ProjectRow[];
  readonly phase08?: Phase08Client | undefined;
  readonly phase02?: Phase02Client | undefined;
  readonly currentPath: string;
  onOpen(path: string): void;
  /** «مهمّة جديدة» في رأس القسم (كما في مانوس): يفتح الرئيسية بمُنشئ فارغ. */
  onNew?(): void;
}

/**
 * قائمة المهامّ كما في مانوس: المثبّتة أولًا، ثم الأحدث. مهامّ المشاريع تظهر تحت مشروعها لا هنا، والمؤرشفة
 * مخفية إلا في تصفية «المؤرشفة». زرّ التصفية حقيقي (كان رمزًا زخرفيًّا بلا وظيفة حتى 2026-10-01).
 */
export function RailMissions({ missions, followUps = [], states = [], projects = [], phase08, phase02, currentPath, onOpen, onNew }: RailMissionsProps) {
  const translator = useTranslator();
  const [filter, setFilter] = useState<Filter>("none");
  const [collapsed, setCollapsed] = useState(false);
  const [less, setLess] = useState(false);
  const all = threadEntries(missions, followUps, states);
  const shown = all.filter(({ thread }) => {
    if (filter === "archived") return thread.archived;
    if (thread.archived) return false;
    if (filter === "favorites") return thread.favorite;
    return thread.project_id === undefined;
  });
  const rows = [...shown.filter((e) => e.thread.pinned), ...shown.filter((e) => !e.thread.pinned)].slice(0, less ? LESS : 40);
  const openThread = openThreadOf(currentPath, followUps);
  const option = (id: Filter, key: string) => <MenuItem label={translator.t(key)} trailing={filter === id ? <Icon name="check" size={15} /> : undefined} onSelect={() => setFilter(id)} />;
  return (
    <section className="rail-section" aria-label={translator.t("ui.rail.recent")}>
      <RailHead label={translator.t("nav.missions")} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)}>
        <Popover label={translator.t("ui.rail.section_more")} trigger={<Icon name="more" size={15} />} triggerClassName="icon-button rail-head__tool" floating align="end">
          <MenuItem icon={<Icon name="chevrons-up" size={16} />} label={translator.t(less ? "ui.rail.show_more" : "ui.rail.show_less")} onSelect={() => setLess((v) => !v)} />
        </Popover>
        {phase08 === undefined ? null : (
          <Popover label={translator.t("ui.rail.filter")} trigger={<Icon name="filter" size={15} />} triggerClassName={filter === "none" ? "icon-button rail-head__tool" : "icon-button rail-head__tool is-active"} floating align="end">
            {option("none", "ui.rail.filter_none")}
            {option("favorites", "ui.rail.filter_favorites")}
            {option("archived", "ui.rail.filter_archived")}
          </Popover>
        )}
        {onNew === undefined ? null : (
          <button type="button" className="icon-button rail-head__tool" aria-label={translator.t("ui.rail.new_mission")} title={translator.t("ui.rail.new_mission")} onClick={onNew}>
            <Icon name="edit" size={15} />
          </button>
        )}
      </RailHead>
      {collapsed ? null : rows.length === 0 ? (
        <p className="rail-missions__empty">{translator.t(filter === "none" ? "ui.rail.recent_empty" : "ui.rail.filter_empty")}</p>
      ) : (
        <ul className="rail-missions__list">
          {rows.map(({ row, last, thread }) => (
            <ThreadRow key={row.mission_id} row={row} last={last} thread={thread} open={openThread === row.mission_id} phase08={phase08} phase02={phase02} projects={projects} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** عدد مهامّ المشروع الظاهرة تحته في الشريط قبل «المزيد من المهام». */
const PROJECT_PREVIEW = 5;
/** «عرض أقل» في رأس المهامّ: هذا العدد وحده. */
const LESS = 5;

export interface RailProjectsProps {
  readonly projects: readonly ProjectRow[];
  readonly missions?: readonly MissionRow[];
  readonly followUps?: readonly { readonly mission_id: string; readonly thread_id: string }[];
  readonly states?: readonly ThreadState[];
  readonly phase08?: Phase08Client | undefined;
  readonly phase02?: Phase02Client | undefined;
  readonly currentPath: string;
  onOpen(path: string): void;
}

/**
 * المشاريع كما في مانوس: كل مشروع صفّ بمجلد يطوي مهامّه ويفتحها، وعند المرور زرّ «مهمة جديدة في المشروع»
 * وقائمة «⋯» (تعديل، عرض، حذف). «+» ينشئ مشروعًا في حوار.
 */
export function RailProjects({ projects, missions = [], followUps = [], states = [], phase08, phase02, currentPath, onOpen }: RailProjectsProps) {
  const translator = useTranslator();
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);
  const entries = threadEntries(missions, followUps, states).filter((e) => !e.thread.archived);
  const openThread = openThreadOf(currentPath, followUps);
  const active = projects.filter((p) => p.status === "ACTIVE");
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="rail-section" aria-label={translator.t("nav.projects")}>
      <RailHead label={translator.t("nav.projects")} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)}>
        <button type="button" className="icon-button rail-head__tool" aria-label={translator.t("ui.rail.new_project")} title={translator.t("ui.rail.new_project")} onClick={() => (phase02 === undefined ? onOpen("/projects") : setCreating(true))}>
          <Icon name="plus" size={15} />
        </button>
      </RailHead>
      {collapsed || active.length === 0 ? null : (
        <ul className="rail-missions__list">
          {active.slice(0, 12).map((p) => {
            const path = projectPath(p.project_id);
            const inProject = entries.filter((e) => e.thread.project_id === p.project_id);
            const containsOpen = inProject.some((e) => e.row.mission_id === openThread);
            const isExpanded = expanded.has(p.project_id) || containsOpen;
            return (
              <li key={p.project_id} className={currentPath === path ? "rail-project is-open" : "rail-project"}>
                <div className="rail-project__row">
                  <button type="button" className={currentPath === path ? "rail-missions__item is-open" : "rail-missions__item"} title={p.name} aria-expanded={isExpanded} onClick={() => toggle(p.project_id)}>
                    <Icon name="projects" size={15} className="rail-missions__icon" />
                    <span className="rail-missions__name" dir="auto">
                      {p.name}
                    </span>
                    <Icon name="chevron" size={13} className={isExpanded ? "rail-project__chevron is-expanded" : "rail-project__chevron"} />
                  </button>
                  <span className="rail-project__tools">
                    <button type="button" className="icon-button rail-thread__more" aria-label={translator.t("ui.rail.project_new_task")} title={translator.t("ui.rail.project_new_task")} onClick={() => onOpen(path)}>
                      <Icon name="edit" size={15} />
                    </button>
                    <Popover label={translator.t("ui.project.menu")} trigger={<Icon name="more" size={16} />} triggerClassName="icon-button rail-thread__more" floating align="end">
                      <MenuItem icon={<Icon name="edit" size={16} />} label={translator.t("ui.project.edit")} disabled={phase02 === undefined} onSelect={() => setEditing(p)} />
                      <MenuItem icon={<Icon name="eye" size={16} />} label={translator.t("ui.project.view")} onSelect={() => onOpen(path)} />
                      {isExpanded && !containsOpen ? <MenuItem icon={<Icon name="chevrons-up" size={16} />} label={translator.t("ui.rail.show_less")} onSelect={() => toggle(p.project_id)} /> : null}
                      <MenuItem icon={<Icon name="trash" size={16} />} label={translator.t("ui.project.delete")} danger disabled={phase08 === undefined} onSelect={() => setDeleting(p)} />
                    </Popover>
                  </span>
                </div>
                {isExpanded ? (
                  <ul className="rail-missions__list rail-project__tasks">
                    {inProject.slice(0, PROJECT_PREVIEW).map(({ row, last, thread }) => (
                      <ThreadRow key={row.mission_id} row={row} last={last} thread={thread} open={openThread === row.mission_id} phase08={phase08} phase02={phase02} projects={projects} onOpen={onOpen} nested />
                    ))}
                    {inProject.length > PROJECT_PREVIEW || inProject.length === 0 ? (
                      <li>
                        <button type="button" className="rail-missions__item rail-project__more" onClick={() => onOpen(path)}>
                          <Icon name="more" size={15} className="rail-missions__icon" />
                          <span className="rail-missions__name">{translator.t(inProject.length === 0 ? "ui.rail.project_new_task" : "ui.rail.project_more")}</span>
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {creating && phase02 !== undefined ? (
        <ProjectDialog
          phase02={phase02}
          onClose={() => setCreating(false)}
          onSaved={(projectId) => {
            setCreating(false);
            onOpen(projectPath(projectId));
          }}
        />
      ) : null}
      {editing !== null && phase02 !== undefined ? <ProjectDialog phase02={phase02} project={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} /> : null}
      {deleting !== null && phase08 !== undefined ? (
        <DeleteProjectDialog
          phase08={phase08}
          project={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            const wasOpen = currentPath === projectPath(deleting.project_id);
            setDeleting(null);
            if (wasOpen) onOpen("/");
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * «المزيد» (مانوس 2.0): بند في قائمة الأدوات يفتح قائمة صغيرة بجانب الشريط بالوجهات الأقلّ استعمالًا (المهارات،
 * والتخصيص والذاكرة، والمراقبة). القائمة تُنقل إلى `body` (الشريط يقصّ ما يخرج منه)، وتبقى في المستند مخفية حين
 * تُطوى، فتبقى بنودها بنود تنقّل حقيقية. تُطوى باختيار بند، وبـ Escape، وبالنقر خارجها، وبتغيّر الصفحة.
 */
export function RailMore({ currentPath, children, active = false }: { readonly currentPath: string; readonly children: ReactNode; readonly active?: boolean }) {
  const translator = useTranslator();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; side: number } | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  useEffect(() => setOpen(false), [currentPath]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!(menu.current?.contains(target) ?? false) && !(button.current?.contains(target) ?? false)) setOpen(false);
    };
    globalThis.addEventListener("keydown", onKey);
    globalThis.addEventListener("mousedown", onDown);
    return () => {
      globalThis.removeEventListener("keydown", onKey);
      globalThis.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  const toggle = () => {
    const rect = button.current?.getBoundingClientRect();
    if (rect !== undefined) {
      const rtl = globalThis.document?.documentElement.getAttribute("dir") === "rtl";
      // القائمة تبدأ من حافة الشريط الداخلية، بمحاذاة البند نفسه.
      setAt({ top: rect.top, side: rtl ? globalThis.innerWidth - rect.left + 6 : rect.right + 6 });
    }
    setOpen((v) => !v);
  };
  const list = (
    <div
      ref={menu}
      className="rail-more__menu"
      id="rail-more-menu"
      hidden={!open}
      style={at === null ? undefined : { top: at.top, insetInlineStart: at.side }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button") !== null) setOpen(false);
      }}
    >
      {children}
    </div>
  );
  const body = globalThis.document?.body;
  return (
    <li className="rail-more">
      <button ref={button} type="button" className={open || active ? "rail-link is-open" : "rail-link"} aria-expanded={open} aria-controls="rail-more-menu" onClick={toggle}>
        <Icon name="more" className="nav__icon" />
        <span className="nav__label">{translator.t("ui.rail.more")}</span>
      </button>
      {body === undefined || body === null ? list : createPortal(list, body)}
    </li>
  );
}

/**
 * أسفل الشريط: صفّ المستخدم (دائرة بحرف، والاسم، وأيقونتان) يفتح قائمة كقائمة الحساب في مانوس: الإعدادات
 * والرئيسية والوجهات الأقلّ استعمالًا، واللغة والسمة. البنود داخلها بنود تنقّل حقيقية؛ القائمة المطويّة تبقيها في
 * المستند مخفية، فعدد الوجهات العشر لا يتغيّر. تُطوى باختيار بند، وبـ Escape، وبالنقر خارجها، وبتغيّر الصفحة.
 */
export function RailAccount({ currentPath, children, onSettings }: { readonly currentPath: string; readonly children: ReactNode; onSettings?(): void }) {
  const translator = useTranslator();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => setOpen(false), [currentPath]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    globalThis.addEventListener("keydown", onKey);
    globalThis.addEventListener("mousedown", onDown);
    return () => {
      globalThis.removeEventListener("keydown", onKey);
      globalThis.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  return (
    <div className="rail-account" ref={root}>
      <div
        className="rail-account__menu"
        id="rail-account-menu"
        hidden={!open}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button") !== null) setOpen(false);
        }}
      >
        <div className="rail-account__who">
          <span className="rail-account__avatar" aria-hidden="true">
            {translator.t("ui.account.initial")}
          </span>
          <span className="rail-account__text">
            <span className="rail-account__name">{translator.t("app.name")}</span>
            <span className="rail-account__sub">{translator.t("ui.account.local")}</span>
          </span>
        </div>
        {children}
      </div>
      <div className="rail-account__row">
        <button type="button" className="rail-account__button" aria-expanded={open} aria-controls="rail-account-menu" onClick={() => setOpen((v) => !v)}>
          <span className="rail-account__avatar" aria-hidden="true">
            {translator.t("ui.account.initial")}
          </span>
          <span className="rail-account__name">{translator.t("app.name")}</span>
        </button>
        {onSettings === undefined ? null : (
          <button type="button" className="icon-button rail-account__icon" aria-label={translator.t("nav.settings")} title={translator.t("nav.settings")} onClick={onSettings}>
            <Icon name="settings" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
