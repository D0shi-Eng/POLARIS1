// مخرجات المهمّة: كل ملف أعاد المضيف فتحه وتحقّق منه، بنوعه وحالة تحقّقه ومقتطف منه. المعاينة
// تفتح الملف نفسه من المساحة؛ «صدّر» ينسخه إلى مجلد التصدير؛ «انشر» اقتراح ينتظر قرارك.

import { useMemo, useState } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { ArtifactV1 } from "../../generated/types/desktop-p08-result-v1";
import type { Phase08Client } from "../../ipc/p08-client";
import { formatBytes } from "../../p08/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { Icon, type IconName } from "../../ui/components/Icon";
import { FilePreview } from "./FilePreview";

/** أيقونة كل نوع مخرَج. */
const TYPE_ICONS: Readonly<Record<string, IconName>> = { DOCX: "report", PDF: "file", XLSX: "data", CSV: "data", PPTX: "slides", HTML: "web", WEB_SITE: "web", MARKDOWN: "report", CODE_PROJECT: "code", CODE: "code" };

function ArtifactCard({ client, artifact }: { readonly client: Phase08Client; readonly artifact: ArtifactV1 }) {
  const translator = useTranslator();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const preview = useHostQuery(
    () => (!open || artifact.type === "WEB_SITE" || artifact.type === "CODE_PROJECT" ? Promise.resolve({ ok: true as const, value: null }) : client.previewFile(artifact.mission_id, artifact.file_ref)),
    [client, artifact.artifact_id, open],
  );
  const excerpt = typeof (artifact.preview as { excerpt?: unknown }).excerpt === "string" ? ((artifact.preview as { excerpt: string }).excerpt) : "";
  const verified = artifact.verification.status === "VERIFIED";
  return (
    <article className="artifact">
      <header className="artifact__head">
        <span className="artifact__icon">
          <Icon name={TYPE_ICONS[artifact.type] ?? "file"} />
        </span>
        <span className="artifact__type">{artifact.type}</span>
        <h4 className="artifact__title">{artifact.title}</h4>
        <span className={`badge ${verified ? "badge--ok" : "badge--bad"}`}>{translator.t(`p08.verification.${artifact.verification.status}`)}</span>
      </header>
      <p className="artifact__meta">
        {artifact.file_ref}
        {` · ${formatBytes(artifact.size)}`}
        {` · ${translator.t("p08.artifact.checks", { count: artifact.verification.checks.length })}`}
      </p>
      {excerpt === "" ? null : <p className="artifact__excerpt" dir="auto">{excerpt.slice(0, 400)}</p>}
      <div className="toolbar">
        <button type="button" className="button button--secondary" onClick={() => setOpen((v) => !v)}>
          {translator.t(open ? "p08.artifact.hide" : "p08.artifact.preview")}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={artifact.type === "WEB_SITE" || artifact.type === "CODE_PROJECT"}
          onClick={() => void action.run(() => client.exportFile(artifact.mission_id, artifact.file_ref), (v) => ({ phase: "DONE", messageKey: "p08.files.exported", values: { name: v.file_label } }))}
        >
          {translator.t("p08.files.export")}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={!verified}
          onClick={() =>
            void action.run(
              async () => {
                const proposed = await client.proposePublication(artifact.artifact_id, "local-folder");
                return proposed;
              },
              () => ({ phase: "DONE", messageKey: "p08.publish.proposed" }),
            )
          }
        >
          {translator.t("p08.publish.propose")}
        </button>
      </div>
      <ActionNote state={action.state} />
      {open && preview.value !== null ? <FilePreview preview={preview.value} /> : null}
      {preview.error !== null ? <ErrorNote error={preview.error} onRetry={preview.reload} /> : null}
    </article>
  );
}

export function ArtifactsPanel({ client, missionId, refreshKey, library = false }: { readonly client: Phase08Client; readonly missionId?: string; readonly refreshKey: string; readonly library?: boolean }) {
  const translator = useTranslator();
  const list = useHostQuery(() => client.listArtifacts(missionId), [client, missionId, refreshKey]);
  const artifacts = useMemo(() => list.value?.artifacts ?? [], [list.value]);
  // المكتبة: بحث بالعنوان والمسار، وتصفية بالنوع. تصفية عرض فقط؛ لا تغيّر ما يقوله المضيف.
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string | null>(null);
  const types = useMemo(() => [...new Set(artifacts.map((a) => a.type))].sort(), [artifacts]);
  const needle = query.trim().toLocaleLowerCase();
  const shown = artifacts.filter((a) => (type === null || a.type === type) && (needle === "" || `${a.title} ${a.file_ref}`.toLocaleLowerCase().includes(needle)));
  return (
    <>
      {library && artifacts.length !== 0 ? (
        <div className="library__bar">
          <label className="library__search">
            <Icon name="search" size={16} />
            <span className="sr-only">{translator.t("ui.library.search")}</span>
            <input type="search" value={query} placeholder={translator.t("ui.library.search")} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="library__filters" role="group" aria-label={translator.t("ui.library.search")}>
            <button type="button" className="library__filter" aria-pressed={type === null} onClick={() => setType(null)}>
              {translator.t("ui.library.all")}
            </button>
            {types.map((t) => (
              <button key={t} type="button" className="library__filter" aria-pressed={type === t} onClick={() => setType(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className={library ? "artifacts artifacts--library" : "artifacts"}>
        {list.error !== null ? <ErrorNote error={list.error} onRetry={list.reload} /> : null}
        {artifacts.length === 0 && !list.loading ? <p className="panel__empty">{translator.t("p08.artifacts.empty")}</p> : null}
        {shown.length === 0 && artifacts.length !== 0 ? <p className="panel__empty">{translator.t("ui.palette.empty")}</p> : null}
        {shown.map((a) => (
          <ArtifactCard key={a.artifact_id} client={client} artifact={a} />
        ))}
      </div>
    </>
  );
}
