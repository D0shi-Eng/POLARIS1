// «تخصيص» كما في مانوس 2.0 (قِيس 2026-10-06 في Manus Studio): لسانان، «الملف الشخصي» و«المعرفة».
//
// الملف الشخصي: بطاقة «استيراد الذاكرة من ذكاء اصطناعي آخر»، ثم اللقب والمهنة، و«مزيد عنك» (2000 حرف)، و«تعليمات
// مخصّصة» (3000). كل حقل يُحفظ في المضيف عند مغادرته (إعدادات profile.*)، ويقرؤه الوكيل في تعليمة النظام لكل مهمّة
// (ADR في جولة 2026-10-06)، فليس حقلًا للزينة. الاستيراد: طلب يُنسخ إلى المساعد الآخر، وردّه يُلصق فيملأ «مزيد عنك».
//
// المعرفة: بحث و«إضافة»، وقائمة ما يتذكّره POLARIS عنك وعن مشاريعك (ذاكرة USER وPROJECT النشطة). «إضافة معرفة»
// تكتب ذاكرة USER بموضوع هو الاسم، فيحدّث الاسم نفسه ما قيل عنه سابقًا بدل أن يتعارض معه.

import { useEffect, useMemo, useState } from "react";

import { useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { MemoryViewV1 } from "../../generated/types/desktop-p05-result-v1";
import type { IntegrationSettingKey } from "../../generated/types/desktop-p08-result-v1";
import type { Phase05Client } from "../../ipc/p05-client";
import type { Phase08Client } from "../../ipc/p08-client";
import type { LocaleCode } from "../../localization/types";
import { errorText } from "../../p08/threads";
import { Dialog } from "../../ui/components/Dialog";
import { Icon } from "../../ui/components/Icon";
import { ErrorNote } from "../../ui/components/Notes";
import { PageFrame } from "../../ui/components/PageFrame";
import { listDate } from "./ProjectWorkspace";

type Tab = "profile" | "knowledge";
const TAB_KEY = "polaris.customize.tab";

const LIMITS: Readonly<Record<string, number>> = { "profile.nickname": 80, "profile.profession": 80, "profile.about": 2000, "profile.instructions": 3000 };

function readTab(): Tab {
  try {
    return globalThis.localStorage?.getItem(TAB_KEY) === "knowledge" ? "knowledge" : "profile";
  } catch {
    return "profile";
  }
}

export function CustomizeScreen({ phase05, phase08 }: { readonly phase05: Phase05Client; readonly phase08: Phase08Client }) {
  const translator = useTranslator();
  const [tab, setTab] = useState<Tab>(readTab);
  const choose = (next: Tab) => {
    setTab(next);
    try {
      globalThis.localStorage?.setItem(TAB_KEY, next);
    } catch {
      // تفضيل عرض فقط
    }
  };
  return (
    <PageFrame title={translator.t("ui.rail.customize")} width={768} className="mp--customize">
      <div className="cz-tabs" role="group" aria-label={translator.t("ui.rail.customize")}>
        <button type="button" aria-pressed={tab === "profile"} className="cz-tab" onClick={() => choose("profile")}>
          {translator.t("ui.cz.profile")}
        </button>
        <button type="button" aria-pressed={tab === "knowledge"} className="cz-tab" onClick={() => choose("knowledge")}>
          {translator.t("ui.cz.knowledge")}
          <span className="cz-tab__help" title={translator.t("ui.cz.knowledge_help")} aria-label={translator.t("ui.cz.knowledge_help")}>
            ?
          </span>
        </button>
      </div>
      {tab === "profile" ? <ProfileTab phase08={phase08} /> : <KnowledgeTab phase05={phase05} phase08={phase08} />}
    </PageFrame>
  );
}

function ProfileTab({ phase08 }: { readonly phase08: Phase08Client }) {
  const translator = useTranslator();
  const t = (key: string, values?: Record<string, string | number>) => translator.t(key, values);
  const status = useHostQuery(() => phase08.executionStatus(), [phase08]);
  const stored = status.value?.settings as Readonly<Record<string, unknown>> | undefined;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // القيم المحفوظة تملأ الحقول مرّة عند وصولها؛ ما يكتبه المستخدم بعدها لا يُستبدل.
  useEffect(() => {
    if (stored === undefined) return;
    const next: Record<string, string> = {};
    for (const key of Object.keys(LIMITS)) next[key] = typeof stored[key] === "string" ? (stored[key] as string) : "";
    setSaved(next);
    setDraft((current) => ({ ...next, ...current }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.value]);

  const value = (key: string) => draft[key] ?? "";
  const set = (key: string, text: string) => setDraft((current) => ({ ...current, [key]: text.slice(0, LIMITS[key] ?? 400) }));

  async function save(key: string, override?: string): Promise<void> {
    const text = (override ?? value(key)).trim();
    if (text === (saved[key] ?? "").trim()) return;
    const result = await phase08.setIntegrationSetting(key as IntegrationSettingKey, text === "" ? null : text);
    if (!result.ok) {
      setError(errorText(translator, result.error));
      return;
    }
    setError(null);
    setSaved((current) => ({ ...current, [key]: text }));
    setNote(t("ui.cz.saved"));
  }

  const field = (key: string, labelKey: string, placeholderKey: string) => (
    <label className="cz-field">
      <span className="cz-field__label">{t(labelKey)}</span>
      <input className="cz-input" type="text" dir={value(key) === "" ? undefined : "auto"} value={value(key)} maxLength={LIMITS[key]} placeholder={t(placeholderKey)} onChange={(event) => set(key, event.target.value)} onBlur={() => void save(key)} />
    </label>
  );
  const area = (key: string, labelKey: string, placeholderKey: string, rows: number) => (
    <label className="cz-field">
      <span className="cz-field__label">{t(labelKey)}</span>
      <span className="cz-area">
        <textarea className="cz-area__input" dir={value(key) === "" ? undefined : "auto"} rows={rows} value={value(key)} maxLength={LIMITS[key]} placeholder={t(placeholderKey)} onChange={(event) => set(key, event.target.value)} onBlur={() => void save(key)} />
        <span className="cz-area__count">{`${value(key).length} / ${LIMITS[key] ?? 0}`}</span>
      </span>
    </label>
  );

  return (
    <div className="cz-profile">
      {status.error !== null ? <ErrorNote error={status.error} onRetry={status.reload} /> : null}
      <button type="button" className="cz-import" onClick={() => setImporting(true)}>
        <span className="cz-import__icon" aria-hidden="true">
          <Icon name="customize" size={18} />
        </span>
        <span className="cz-import__text">
          <span className="cz-import__title">{t("ui.cz.import_title")}</span>
          <span className="cz-import__sub">{t("ui.cz.import_sub")}</span>
        </span>
        <Icon name="chevron" size={14} className="cz-import__chev" />
      </button>
      <div className="cz-row">
        {field("profile.nickname", "ui.cz.nickname", "ui.cz.nickname_placeholder")}
        {field("profile.profession", "ui.cz.profession", "ui.cz.profession_placeholder")}
      </div>
      {area("profile.about", "ui.cz.about", "ui.cz.about_placeholder", 4)}
      <p className="cz-hint">{t("ui.cz.about_hint")}</p>
      <hr className="cz-rule" />
      {area("profile.instructions", "ui.cz.instructions", "ui.cz.instructions_placeholder", 4)}
      {error === null ? (note === null ? null : <p className="cz-note" role="status">{note}</p>) : <p className="alert" role="alert">{error}</p>}
      <div className="cz-foot">
        <button type="button" className="mp-btn" onClick={() => setImporting(true)}>
          <Icon name="customize" size={14} />
          {t("ui.cz.import")}
        </button>
      </div>
      {importing ? (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImport={(text) => {
            const merged = (value("profile.about").trim() === "" ? text : `${value("profile.about").trim()}\n${text}`).slice(0, LIMITS["profile.about"]);
            set("profile.about", merged);
            void save("profile.about", merged);
            setImporting(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** «استيراد الذاكرة» كما في مانوس: طلب يُنسخ إلى المساعد الآخر، ثم يُلصق ردّه فيملأ «مزيد عنك». لا يُرسل شيء خارج الجهاز. */
function ImportDialog({ onClose, onImport }: { onClose(): void; onImport(text: string): void }) {
  const translator = useTranslator();
  const t = (key: string) => translator.t(key);
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);
  const prompt = t("ui.cz.import_prompt");
  return (
    <Dialog title={t("ui.cz.import_dialog")} hint={t("ui.cz.import_dialog_hint")} confirmLabel={t("ui.cz.import")} canConfirm={pasted.trim() !== ""} className="mdialog--import" onConfirm={() => onImport(pasted.trim())} onClose={onClose}>
      <ol className="cz-steps">
        <li className="cz-step">
          <div className="cz-step__head">
            <span>
              <strong>{t("ui.cz.step_copy")}</strong>
              <span className="cz-step__sub">{t("ui.cz.step_copy_sub")}</span>
            </span>
            <button
              type="button"
              className="mp-btn mp-btn--light"
              onClick={() => {
                void globalThis.navigator?.clipboard?.writeText(prompt).then(() => setCopied(true));
              }}
            >
              <Icon name={copied ? "check" : "copy"} size={14} />
              {t(copied ? "ui.cz.copied" : "ui.cz.copy")}
            </button>
          </div>
          <pre className="cz-step__prompt" dir="auto">
            {prompt}
          </pre>
        </li>
        <li className="cz-step">
          <div className="cz-step__head">
            <span>
              <strong>{t("ui.cz.step_paste")}</strong>
              <span className="cz-step__sub">{t("ui.cz.step_paste_sub")}</span>
            </span>
          </div>
          <textarea className="mtextarea" rows={5} dir="auto" maxLength={2000} value={pasted} placeholder={t("ui.cz.paste_placeholder")} aria-label={t("ui.cz.step_paste")} onChange={(event) => setPasted(event.target.value)} />
        </li>
      </ol>
    </Dialog>
  );
}

function KnowledgeTab({ phase05, phase08 }: { readonly phase05: Phase05Client; readonly phase08: Phase08Client }) {
  const translator = useTranslator();
  const t = (key: string, values?: Record<string, string | number>) => translator.t(key, values);
  const locale = translator.locale as LocaleCode;
  const [tick, setTick] = useState(0);
  const user = useHostQuery(() => phase05.listMemories({ scope: "USER", status: "ACTIVE" }), [phase05, tick]);
  const project = useHostQuery(() => phase05.listMemories({ scope: "PROJECT", status: "ACTIVE" }), [phase05, tick]);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<MemoryViewV1 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return [...(user.value?.memories ?? []), ...(project.value?.memories ?? [])].filter((m) => needle === "" || m.summary.toLocaleLowerCase().includes(needle)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [user.value, project.value, query]);
  const loading = user.loading && user.value === null;

  return (
    <div className="cz-knowledge">
      <div className="cz-knowledge__bar">
        <label className="mp-search cz-knowledge__search">
          <Icon name="search" size={15} />
          <span className="sr-only">{t("ui.cz.search")}</span>
          <input type="search" dir={query === "" ? undefined : "auto"} value={query} placeholder={t("ui.cz.search")} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="mp-btn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
          {t("ui.cz.add")}
        </button>
      </div>
      {user.error !== null ? <ErrorNote error={user.error} onRetry={user.reload} /> : null}
      {!loading && rows.length === 0 ? (
        <div className="mp-empty cz-empty">
          <Icon name="search" size={24} />
          <p>{t(query.trim() === "" ? "ui.cz.empty" : "ui.palette.empty")}</p>
        </div>
      ) : (
        <ul className="cz-list">
          {rows.map((m) => (
            <li key={m.memory_id} className="cz-item">
              <span className="cz-item__text" dir="auto">
                {m.summary}
              </span>
              <span className="cz-item__meta">{`${t(m.scope === "PROJECT" ? "ui.cz.scope_project" : "ui.cz.scope_user")} · ${listDate(locale, m.created_at)}`}</span>
              <button type="button" className="icon-button cz-item__delete" aria-label={t("ui.memory.delete")} title={t("ui.memory.delete")} onClick={() => setDeleting(m)}>
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? <KnowledgeDialog phase08={phase08} onSaved={() => setTick((n) => n + 1)} onClose={() => setAdding(false)} /> : null}
      {deleting !== null ? (
        <Dialog
          title={t("ui.memory.delete_title")}
          hint={deleting.summary}
          confirmLabel={t("ui.thread.delete")}
          danger
          busy={busy}
          error={error}
          className="mdialog--small"
          onConfirm={() => {
            setBusy(true);
            void phase05.deleteMemory(deleting.memory_id).then((result) => {
              setBusy(false);
              if (!result.ok) {
                setError(errorText(translator, result.error));
                return;
              }
              setDeleting(null);
              setError(null);
              setTick((n) => n + 1);
            });
          }}
          onClose={() => {
            setDeleting(null);
            setError(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** «إضافة معرفة» كما في مانوس: الاسم، و«استخدام عندما»، والمحتوى (2000). تُحفظ ذاكرة USER موضوعها الاسم. */
function KnowledgeDialog({ phase08, onSaved, onClose }: { readonly phase08: Phase08Client; onSaved(): void; onClose(): void }) {
  const translator = useTranslator();
  const t = (key: string) => translator.t(key);
  const [name, setName] = useState("");
  const [when, setWhen] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    const body = when.trim() === "" ? content.trim() : `${content.trim()}\n${translator.t("ui.cz.when_line", { when: when.trim() })}`;
    const result = await phase08.rememberMemory({ text: body.slice(0, 2000), scope: "USER", ...(name.trim() === "" ? {} : { topic: name.trim().slice(0, 80) }) });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(translator, result.error));
      return;
    }
    onSaved();
    onClose();
  }
  return (
    <Dialog title={t("ui.cz.add_title")} confirmLabel={t("ui.cz.save")} canConfirm={name.trim() !== "" && content.trim() !== ""} busy={busy} error={error} className="mdialog--knowledge" onConfirm={() => void save()} onClose={onClose}>
      <label className="mfield__label" htmlFor="cz-k-name">
        {t("ui.cz.k_name")}
      </label>
      <input id="cz-k-name" className="cz-input" dir="auto" maxLength={80} value={name} placeholder={t("ui.cz.k_name_placeholder")} onChange={(event) => setName(event.target.value)} />
      <label className="mfield__label" htmlFor="cz-k-when">
        {t("ui.cz.k_when")}
      </label>
      <input id="cz-k-when" className="cz-input" dir="auto" maxLength={200} value={when} placeholder={t("ui.cz.k_when_placeholder")} onChange={(event) => setWhen(event.target.value)} />
      <label className="mfield__label" htmlFor="cz-k-content">
        {t("ui.cz.k_content")}
      </label>
      <span className="cz-area">
        <textarea id="cz-k-content" className="cz-area__input" dir="auto" rows={6} maxLength={2000} value={content} placeholder={t("ui.cz.k_content_placeholder")} onChange={(event) => setContent(event.target.value)} />
        <span className="cz-area__count">{`${content.length} / 2000`}</span>
      </span>
    </Dialog>
  );
}
