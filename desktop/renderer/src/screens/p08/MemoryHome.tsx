// صفحة الذاكرة: ما يتذكّره POLARIS عنك وعن مشاريعك، بلغة المستخدم لا بجدول تصفية.
//
// ثلاث طبقات كما هي في المضيف، كلٌّ باسمها الحقيقي:
//   1) عنك (نطاق USER): ما كتبته أنت بـ«تذكّر هذا»، أو ما اقترحه وكيل ووافقت عليه.
//   2) المشاريع (نطاق PROJECT): ما يخصّ مشروعًا بعينه، ولا يراه غيره.
//   3) سجلّ المهام الآلي (نطاق MISSION): ما يدوّنه زمن التشغيل عن كل مهمة لنفسها؛ يُعرض مطويًّا لأنه دفتر
//      تشغيل لا معرفة عنك (قِيس 2026-10-01: كل ذاكرة المالك كانت من هذا النوع).
// لكل بند مصدره (كتبتَه، اقترحه وكيل، سجلّ آلي) وتاريخه وحذفه الحقيقي. لا تعديل للنصّ ولا «اعتبرها صحيحة»: تغيير
// ذاكرة يكون بحذفها وكتابة غيرها. والعرض التقني القديم (تصفية بالنطاق والنوع والحالة) باقٍ في قسم مطويّ.

import { useCallback, useState } from "react";

import { useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { MemoryViewV1 } from "../../generated/types/desktop-p05-result-v1";
import type { Phase02Client } from "../../ipc/p02-client";
import type { Phase05Client } from "../../ipc/p05-client";
import type { Phase08Client } from "../../ipc/p08-client";
import type { LocaleCode } from "../../localization/types";
import { errorText } from "../../p08/threads";
import { Dialog } from "../../ui/components/Dialog";
import { Icon } from "../../ui/components/Icon";
import { ErrorNote } from "../../ui/components/Notes";
import { RememberDialog } from "../../ui/components/RememberDialog";
import { MemoryPanel } from "../p05/MemoryScreen";
import { listDate } from "./ProjectWorkspace";

function sourceKey(m: MemoryViewV1): string {
  if (m.trust_class === "USER_DERIVED") return "ui.memory.source.user";
  if (m.trust_class === "MODEL_GENERATED") return "ui.memory.source.agent";
  return "ui.memory.source.runtime";
}

export function MemoryHome({ phase05, phase08, phase02 }: { readonly phase05: Phase05Client; readonly phase08: Phase08Client; readonly phase02?: Phase02Client | undefined }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<MemoryViewV1 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = useHostQuery(() => phase05.listMemories({ scope: "USER", status: "ACTIVE" }), [phase05, tick]);
  const project = useHostQuery(() => phase05.listMemories({ scope: "PROJECT", status: "ACTIVE" }), [phase05, tick]);
  const missions = useHostQuery(() => phase05.listMemories({ scope: "MISSION", status: "ACTIVE", limit: 60 }), [phase05, tick]);
  const projects = useHostQuery(() => (phase02 === undefined ? Promise.resolve({ ok: true as const, value: { projects: [] } }) : phase02.listProjects({ include_archived: true })), [phase02]);
  const projectName = (id: string | undefined) => (projects.value?.projects ?? []).find((p) => p.project_id === id)?.name ?? translator.t("ui.memory.project_unknown");

  const item = (m: MemoryViewV1) => (
    <li key={m.memory_id} className="memory-item">
      <p className="memory-item__text" dir="auto">
        {m.summary}
      </p>
      <p className="memory-item__meta">
        <span>{translator.t(sourceKey(m))}</span>
        <span aria-hidden="true">{" · "}</span>
        <span>{listDate(locale, m.created_at)}</span>
      </p>
      <button type="button" className="icon-button memory-item__delete" aria-label={translator.t("ui.memory.delete")} title={translator.t("ui.memory.delete")} onClick={() => setDeleting(m)}>
        <Icon name="trash" size={15} />
      </button>
    </li>
  );

  const userRows = user.value?.memories ?? [];
  const projectRows = project.value?.memories ?? [];
  const missionRows = missions.value?.memories ?? [];
  const byProject = new Map<string, MemoryViewV1[]>();
  for (const m of projectRows) byProject.set(m.project_id ?? "", [...(byProject.get(m.project_id ?? "") ?? []), m]);

  return (
    <div className="memory-page">
      <header className="memory-page__head">
        <div>
          <h1 className="page-title">{translator.t("nav.memory")}</h1>
          <p className="page-subtitle">{translator.t("ui.memory.subtitle")}</p>
        </div>
        <button type="button" className="mbutton mbutton--primary memory-page__add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} />
          {translator.t("ui.memory.add")}
        </button>
      </header>
      {user.error !== null ? <ErrorNote error={user.error} onRetry={user.reload} /> : null}

      <section className="memory-section" aria-labelledby="memory-user">
        <h2 id="memory-user">{translator.t("ui.memory.user_title")}</h2>
        <p className="memory-section__hint">{translator.t("ui.memory.user_hint")}</p>
        {userRows.length === 0 ? <p className="memory-section__empty">{translator.t("ui.memory.user_empty")}</p> : <ul className="memory-list">{userRows.map(item)}</ul>}
      </section>

      <section className="memory-section" aria-labelledby="memory-projects">
        <h2 id="memory-projects">{translator.t("ui.memory.projects_title")}</h2>
        <p className="memory-section__hint">{translator.t("ui.memory.projects_hint")}</p>
        {projectRows.length === 0 ? (
          <p className="memory-section__empty">{translator.t("ui.memory.projects_empty")}</p>
        ) : (
          [...byProject.entries()].map(([id, rows]) => (
            <div key={id} className="memory-group">
              <h3 dir="auto">
                <Icon name="projects" size={14} /> {projectName(id)}
              </h3>
              <ul className="memory-list">{rows.map(item)}</ul>
            </div>
          ))
        )}
      </section>

      <details className="memory-fold">
        <summary>{translator.t("ui.memory.runtime_title", { count: missionRows.length })}</summary>
        <p className="memory-section__hint">{translator.t("ui.memory.runtime_hint")}</p>
        {missionRows.length === 0 ? null : <ul className="memory-list">{missionRows.map(item)}</ul>}
      </details>

      <details className="memory-fold">
        <summary>{translator.t("ui.memory.technical")}</summary>
        <MemoryPanel client={phase05} />
      </details>

      {adding ? <RememberDialog phase08={phase08} onSaved={reload} onClose={() => setAdding(false)} /> : null}
      {deleting !== null ? (
        <Dialog
          title={translator.t("ui.memory.delete_title")}
          hint={deleting.summary}
          confirmLabel={translator.t("ui.thread.delete")}
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
              reload();
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
