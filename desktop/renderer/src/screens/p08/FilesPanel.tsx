// ملفات المهمّة: inputs/ (ما أرفقته)، work/ (مسودّات الوكيل)، outputs/ (المخرجات)، downloads/
// (تنزيلات معزولة لا تُفتح). اختيار ملف يعرض معاينته، و«صدّر» ينسخه إلى مجلد التصدير.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { Phase08Client } from "../../ipc/p08-client";
import { fileGlyph, formatBytes } from "../../p08/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { FilePreview } from "./FilePreview";

export function FilesPanel({ client, missionId, refreshKey }: { readonly client: Phase08Client; readonly missionId: string; readonly refreshKey: string }) {
  const translator = useTranslator();
  const [selected, setSelected] = useState<string | null>(null);
  const action = useAction();
  const listing = useHostQuery(() => client.listWorkspace(missionId), [client, missionId, refreshKey]);
  const preview = useHostQuery(
    () => (selected === null ? Promise.resolve({ ok: true as const, value: null }) : client.previewFile(missionId, selected)),
    [client, missionId, selected],
  );
  const entries = listing.value?.entries ?? [];
  return (
    <div className="files">
      {listing.error !== null ? <ErrorNote error={listing.error} onRetry={listing.reload} /> : null}
      {entries.length === 0 && !listing.loading ? <p className="panel__empty">{translator.t("p08.files.empty")}</p> : null}
      <ul className="tree">
        {entries.map((e) => {
          const depth = e.path.split("/").length - 1;
          return (
            <li key={e.path}>
              <button
                type="button"
                className={`tree__item${selected === e.path ? " is-current" : ""}`}
                style={{ paddingInlineStart: `${0.5 + depth * 1}rem` }}
                disabled={e.is_dir}
                onClick={() => setSelected(e.path)}
              >
                <span className="tree__glyph" aria-hidden="true">
                  {fileGlyph(e.path, e.is_dir)}
                </span>
                <span className="tree__name">{e.path.split("/").pop()}</span>
                {e.is_dir ? null : <span className="tree__meta">{formatBytes(e.size_bytes)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {selected === null || preview.value === null ? null : (
        <>
          <div className="toolbar">
            <button
              type="button"
              className="button button--secondary"
              onClick={() =>
                void action.run(
                  () => client.exportFile(missionId, selected),
                  (value) => ({ phase: "DONE", messageKey: "p08.files.exported", values: { name: value.file_label } }),
                )
              }
            >
              {translator.t("p08.files.export")}
            </button>
          </div>
          <ActionNote state={action.state} />
          <FilePreview preview={preview.value} />
        </>
      )}
      {preview.error !== null ? <ErrorNote error={preview.error} onRetry={preview.reload} /> : null}
    </div>
  );
}
