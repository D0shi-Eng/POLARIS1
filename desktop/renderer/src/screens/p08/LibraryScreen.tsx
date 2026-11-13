// المكتبة كما في مانوس 2.0 (قِيس 2026-10-05): العنوان في البداية، والبحث وزرّ العرض (قائمة/شبكة) في النهاية، وألسنة
// بالنوع، والمخرجات قائمةً مجمّعة باليوم: أيقونة النوع، والعنوان، وتحته المحادثة التي أنتجته، والوقت، و«⋯».
// «الإنشاءات» الصفحة نفسها مقصورة على ما بُني (مواقع ومشاريع شيفرة)، بحالة فارغة تدعو إلى البناء.
//
// ما في الصفّ والبطاقة من المضيف كما قاله: النوع والعنوان والمقتطف وحالة التحقّق (أعاد المضيف فتح الملف أم لا).
// «⋯» يعاين الملف ويصدّره ويفتح محادثته. لا شيء يُحذف من هنا.

import { useMemo, useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { ArtifactV1 } from "../../generated/types/desktop-p08-result-v1";
import type { Phase03Client } from "../../ipc/p03-client";
import type { Phase08Client } from "../../ipc/p08-client";
import type { LocaleCode } from "../../localization/types";
import { formatBytes } from "../../p08/present";
import { missionPath } from "../../routes/registry";
import { Icon, type IconName } from "../../ui/components/Icon";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { MenuItem, Popover } from "../../ui/components/Popover";
import { PageFrame } from "../../ui/components/PageFrame";
import { FilePreview } from "./FilePreview";
import { openHomePanel } from "./HomeWorkspace";

const TABS: Readonly<Record<string, readonly string[]>> = {
  all: [],
  slides: ["PPTX"],
  sites: ["WEB_SITE", "HTML"],
  documents: ["DOCX", "PDF", "MARKDOWN", "TEXT"],
  sheets: ["XLSX", "CSV"],
  images: ["IMAGE"],
  other: ["JSON", "CODE_PROJECT"],
};

/** ألسنة «الإنشاءات»: ما بناه POLARIS فعلًا، لا أنواعًا لا ينتجها. «all» يحدّ نطاق الصفحة كلّها. */
const CREATION_TABS: Readonly<Record<string, readonly string[]>> = {
  all: ["WEB_SITE", "HTML", "CODE_PROJECT"],
  sites: ["WEB_SITE", "HTML"],
  code: ["CODE_PROJECT"],
};

const TYPE_ICONS: Readonly<Record<string, IconName>> = { DOCX: "report", PDF: "file", XLSX: "data", CSV: "data", PPTX: "slides", HTML: "web", WEB_SITE: "web", MARKDOWN: "report", TEXT: "report", JSON: "code", CODE_PROJECT: "code", IMAGE: "file" };

/** مفضّلة الإنشاءات (نجمة مانوس) تفضيل عرض على هذا الجهاز فقط، لا بيانات مهمّة: لا شيء منها يصل إلى المضيف. */
const FAVOURITES_KEY = "polaris.creations.favourites";

function readFavourites(): ReadonlySet<string> {
  try {
    const raw = globalThis.localStorage?.getItem(FAVOURITES_KEY);
    const list: unknown = raw === null || raw === undefined ? [] : JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function storeFavourites(ids: ReadonlySet<string>): void {
  try {
    globalThis.localStorage?.setItem(FAVOURITES_KEY, JSON.stringify([...ids]));
  } catch {
    // التخزين المحلي غير متاح: تبقى المفضّلة لهذه الجلسة وحدها.
  }
}

function excerptOf(a: ArtifactV1): string {
  const p = a.preview as { excerpt?: unknown };
  return typeof p.excerpt === "string" ? p.excerpt : "";
}

/** موقع أو مشروع شيفرة مجلّد لا ملف: يُفتح في محادثته (حاسوب POLARIS يعرضه)، لا في معاينة ملف واحد. */
function isExportable(a: ArtifactV1): boolean {
  return a.type !== "WEB_SITE" && a.type !== "CODE_PROJECT";
}

function ArtifactMenu({ client, artifact, onPreview, onOpenThread, className }: { readonly client: Phase08Client; readonly artifact: ArtifactV1; onPreview(): void; onOpenThread(): void; readonly className: string }) {
  const translator = useTranslator();
  const action = useAction();
  const verified = artifact.verification.status === "VERIFIED";
  const exportable = isExportable(artifact);
  return (
    <>
      <Popover label={translator.t("ui.library.actions")} trigger={<Icon name="more" size={16} />} triggerClassName={`icon-button ${className}`} floating align="end">
        <MenuItem icon={<Icon name="eye" size={16} />} label={translator.t("p08.artifact.preview")} disabled={!exportable} onSelect={onPreview} />
        <MenuItem
          icon={<Icon name="upload" size={16} />}
          label={translator.t("p08.files.export")}
          disabled={!exportable}
          onSelect={() => void action.run(() => client.exportFile(artifact.mission_id, artifact.file_ref), (v) => ({ phase: "DONE", messageKey: "p08.files.exported", values: { name: v.file_label } }))}
        />
        <MenuItem
          icon={<Icon name="globe" size={16} />}
          label={translator.t("p08.publish.propose")}
          disabled={!verified}
          onSelect={() => void action.run(() => client.proposePublication(artifact.artifact_id, "local-folder"), () => ({ phase: "DONE", messageKey: "p08.publish.proposed" }))}
        />
        <MenuItem icon={<Icon name="missions" size={16} />} label={translator.t("ui.library.open_thread")} onSelect={onOpenThread} />
      </Popover>
      <ActionNote state={action.state} />
    </>
  );
}

function LibraryCard({ client, artifact, onPreview, onOpenThread }: { readonly client: Phase08Client; readonly artifact: ArtifactV1; onPreview(): void; onOpenThread(): void }) {
  const translator = useTranslator();
  const verified = artifact.verification.status === "VERIFIED";
  const open = isExportable(artifact) ? onPreview : onOpenThread;
  return (
    <article className="lib-card">
      <header className="lib-card__head">
        <Icon name={TYPE_ICONS[artifact.type] ?? "file"} size={16} className="lib-card__icon" />
        <button type="button" className="lib-card__title" dir="auto" title={artifact.file_ref} onClick={open}>
          {artifact.title}
        </button>
        <ArtifactMenu client={client} artifact={artifact} onPreview={onPreview} onOpenThread={onOpenThread} className="lib-card__more" />
      </header>
      <button type="button" className="lib-card__body" onClick={open} tabIndex={-1} aria-hidden="true">
        <span dir="auto">{excerptOf(artifact).slice(0, 360)}</span>
      </button>
      <footer className="lib-card__foot">
        <span>{`${artifact.type} · ${formatBytes(artifact.size)}`}</span>
        <span className={verified ? "lib-card__check is-ok" : "lib-card__check"}>{translator.t(`p08.verification.${artifact.verification.status}`)}</span>
      </footer>
    </article>
  );
}

/** صفّ في عرض القائمة (مانوس 2.0): أيقونة، وعنوان وتحته المحادثة، وعلامة التحقّق، والوقت، و«⋯». */
function LibraryRow({ client, artifact, thread, time, onPreview, onOpenThread, favourite }: { readonly client: Phase08Client; readonly artifact: ArtifactV1; readonly thread: string; readonly time: string; onPreview(): void; onOpenThread(): void; readonly favourite?: { readonly on: boolean; toggle(): void } | undefined }) {
  const translator = useTranslator();
  const verified = artifact.verification.status === "VERIFIED";
  return (
    <li className="lib-row">
      <button type="button" className="lib-row__main" onClick={isExportable(artifact) ? onPreview : onOpenThread} title={artifact.file_ref}>
        <span className="lib-row__icon" aria-hidden="true">
          <Icon name={TYPE_ICONS[artifact.type] ?? "file"} size={16} />
        </span>
        <span className="lib-row__text">
          <span className="lib-row__title" dir="auto">
            {artifact.title}
          </span>
          <span className="lib-row__sub" dir="auto">
            {thread}
          </span>
        </span>
      </button>
      {/* الحقيقة قبل الشكل: ملف أعاد المضيف فتحه يحمل علامة، وغيره يقول حالته نصًّا لقارئ الشاشة. */}
      <span className={verified ? "lib-row__check is-ok" : "lib-row__check"} title={translator.t(`p08.verification.${artifact.verification.status}`)}>
        {verified ? <Icon name="check" size={14} /> : null}
        <span className="sr-only">{translator.t(`p08.verification.${artifact.verification.status}`)}</span>
      </span>
      <span className="lib-row__time">{time}</span>
      {favourite === undefined ? null : (
        <button type="button" className={favourite.on ? "mp-iconbtn mp-iconbtn--bare is-on" : "mp-iconbtn mp-iconbtn--bare"} aria-pressed={favourite.on} aria-label={translator.t("ui.creations.favourite")} title={translator.t("ui.creations.favourite")} onClick={favourite.toggle}>
          <Icon name="star" size={15} />
        </button>
      )}
      <ArtifactMenu client={client} artifact={artifact} onPreview={onPreview} onOpenThread={onOpenThread} className="lib-row__more" />
    </li>
  );
}

/** عنوان اليوم كما في مانوس: اسم اليوم خلال الأسبوع الأخير، وإلا اليوم والشهر. */
function dayLabel(locale: string, iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000;
  return days < 7 ? new Intl.DateTimeFormat(locale, { weekday: "long" }).format(d) : new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(d);
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function timeOf(locale: string, iso: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function PreviewDialog({ client, artifact, onClose }: { readonly client: Phase08Client; readonly artifact: ArtifactV1; onClose(): void }) {
  const translator = useTranslator();
  const preview = useHostQuery(() => client.previewFile(artifact.mission_id, artifact.file_ref), [client, artifact.artifact_id]);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog library-preview" role="dialog" aria-modal="true" aria-label={artifact.title}>
        <header className="dialog__head">
          <Icon name={TYPE_ICONS[artifact.type] ?? "file"} size={18} />
          <h2 className="dialog__title" dir="auto">
            {artifact.title}
          </h2>
          <button type="button" className="icon-button" aria-label={translator.t("ui.close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="library-preview__body">
          {preview.value === null ? null : <FilePreview preview={preview.value} />}
          {preview.error !== null ? <ErrorNote error={preview.error} onRetry={preview.reload} /> : null}
        </div>
      </div>
    </div>
  );
}

export function LibraryScreen({ client, phase03, variant = "library" }: { readonly client: Phase08Client; readonly phase03: Phase03Client; readonly variant?: "library" | "creations" }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const locale = translator.locale as LocaleCode;
  const list = useHostQuery(() => client.listArtifacts(), [client]);
  const missions = useHostQuery(() => phase03.listMissions(), [phase03]);
  const index = useHostQuery(() => client.conversationIndex(), [client]);
  const creations = variant === "creations";
  const tabs = creations ? CREATION_TABS : TABS;
  const [tab, setTab] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [previewing, setPreviewing] = useState<ArtifactV1 | null>(null);
  const [starred, setStarred] = useState(false);
  const [favourites, setFavourites] = useState<ReadonlySet<string>>(() => readFavourites());
  const toggleFavourite = (id: string) =>
    setFavourites((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      storeFavourites(next);
      return next;
    });

  const { days, threadOf, titleOf, total, shownCount } = useMemo(() => {
    const threadOf = new Map((index.value?.follow_ups ?? []).map((f) => [f.mission_id, f.thread_id]));
    const titleOf = new Map((missions.value?.missions ?? []).map((m) => [m.mission_id, m.title]));
    const needle = query.trim().toLocaleLowerCase();
    const scope = tabs["all"] ?? [];
    const scoped = (list.value?.artifacts ?? []).filter((a) => scope.length === 0 || scope.includes(a.type));
    const wanted = tabs[tab] ?? [];
    const shown = scoped
      .filter((a) => (!starred || favourites.has(a.artifact_id)) && (wanted.length === 0 || wanted.includes(a.type)) && (needle === "" || `${a.title} ${a.file_ref} ${excerptOf(a)}`.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const byDay = new Map<string, ArtifactV1[]>();
    for (const a of shown) byDay.set(dayKey(a.created_at), [...(byDay.get(dayKey(a.created_at)) ?? []), a]);
    return { days: [...byDay.values()], threadOf, titleOf, total: scoped.length, shownCount: shown.length };
  }, [list.value, missions.value, index.value, tab, query, tabs, starred, favourites]);

  const threadId = (a: ArtifactV1) => threadOf.get(a.mission_id) ?? a.mission_id;
  const threadTitle = (a: ArtifactV1) => titleOf.get(threadId(a)) ?? translator.t("ui.library.untitled");
  const searchKey = creations ? "ui.creations.search" : "ui.library.search";
  const search = (
    <label className="mp-search">
      <Icon name="search" size={15} />
      <span className="sr-only">{translator.t(searchKey)}</span>
      <input type="search" value={query} dir={query === "" ? undefined : "auto"} placeholder={translator.t(searchKey)} onChange={(event) => setQuery(event.target.value)} />
    </label>
  );
  const actions = creations ? (
    <>
      {search}
      <button type="button" className={starred ? "mp-iconbtn is-on" : "mp-iconbtn"} aria-pressed={starred} aria-label={translator.t("ui.creations.favourites")} title={translator.t("ui.creations.favourites")} onClick={() => setStarred((v) => !v)}>
        <Icon name="star" size={15} />
      </button>
    </>
  ) : (
    <>
      {search}
      <div className="library-view" role="group" aria-label={translator.t("ui.library.view")}>
        <button type="button" className="icon-button" aria-pressed={view === "list"} aria-label={translator.t("ui.library.view_list")} title={translator.t("ui.library.view_list")} onClick={() => setView("list")}>
          <Icon name="list" size={16} />
        </button>
        <button type="button" className="icon-button" aria-pressed={view === "grid"} aria-label={translator.t("ui.library.view_grid")} title={translator.t("ui.library.view_grid")} onClick={() => setView("grid")}>
          <Icon name="grid" size={16} />
        </button>
      </div>
    </>
  );
  return (
    <PageFrame title={translator.t(creations ? "ui.rail.creations" : "ui.rail.library")} actions={actions} className="mp--library">
      <div className="mp-tabs" role="group" aria-label={translator.t("ui.library.types")}>
        {Object.keys(tabs).map((t) => (
          <button key={t} type="button" className="mp-tab" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {translator.t(creations ? `ui.creations.tab.${t}` : `ui.library.tab.${t}`)}
          </button>
        ))}
      </div>
      {list.error !== null ? <ErrorNote error={list.error} onRetry={list.reload} /> : null}
      {starred && shownCount === 0 && !list.loading ? (
        <div className="mp-empty">
          <Icon name="file" size={24} />
          <p>{translator.t("ui.creations.no_favourites")}</p>
        </div>
      ) : total === 0 && !list.loading ? (
        <div className="mp-empty">
          <Icon name="file" size={24} />
          <p>{translator.t(creations ? "ui.creations.empty" : "p08.artifacts.empty")}</p>
          {creations ? (
            <button
              type="button"
              className="mp-cta"
              onClick={() => {
                openHomePanel("build");
                navigation.navigate("/");
              }}
            >
              {translator.t("ui.creations.start")}
            </button>
          ) : null}
        </div>
      ) : null}
      {total !== 0 && !starred && days.length === 0 ? <p className="panel__empty">{translator.t("ui.palette.empty")}</p> : null}
      {days.map((items) => {
        const first = items[0] as ArtifactV1;
        return (
          <section key={dayKey(first.created_at)} className="library-day">
            <h2 className="library-day__head">
              {dayLabel(locale, first.created_at)} <span className="library-day__count">({items.length})</span>
            </h2>
            {view === "list" ? (
              <ul className="lib-rows">
                {items.map((a) => (
                  <LibraryRow key={a.artifact_id} client={client} artifact={a} thread={threadTitle(a)} time={timeOf(locale, a.created_at)} onPreview={() => setPreviewing(a)} onOpenThread={() => navigation.navigate(missionPath(threadId(a)))} favourite={creations ? { on: favourites.has(a.artifact_id), toggle: () => toggleFavourite(a.artifact_id) } : undefined} />
                ))}
              </ul>
            ) : (
              <div className="library-grid">
                {items.map((a) => (
                  <LibraryCard key={a.artifact_id} client={client} artifact={a} onPreview={() => setPreviewing(a)} onOpenThread={() => navigation.navigate(missionPath(threadId(a)))} />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {previewing === null ? null : <PreviewDialog client={client} artifact={previewing} onClose={() => setPreviewing(null)} />}
    </PageFrame>
  );
}
