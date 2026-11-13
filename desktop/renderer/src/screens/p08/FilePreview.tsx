// معاينة ملف من مساحة المهمّة: نصّ، أو نصّ مستخرج من مستند، أو صورة، أو صفحة HTML في إطار
// معزول بلا نصوص برمجية ولا وصول إلى أي شيء (`sandbox` فارغ). المحتوى بيانات غير موثوقة.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import type { WorkspacePreviewResultV1 } from "../../generated/types/desktop-p08-result-v1";
import { formatBytes } from "../../p08/present";
import { Markdown } from "../../ui/components/Markdown";

/** تقرير Markdown يُعرض منسّقًا افتراضيًا، ومصدره متاح بنقرة. */
const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

export function FilePreview({ preview }: { readonly preview: WorkspacePreviewResultV1 }) {
  const translator = useTranslator();
  const markdown = preview.kind === "TEXT" && preview.text !== undefined && isMarkdown(preview.path);
  const [source, setSource] = useState(false);
  return (
    <div className="preview">
      <div className="preview__head">
        <span className="preview__name">{preview.path}</span>
        <span className="preview__meta">
          {translator.t(`p08.preview.kind.${preview.kind}`)}
          {` · ${formatBytes(preview.size_bytes)}`}
        </span>
        {markdown ? (
          <button type="button" className="link-button preview__toggle" aria-pressed={source} onClick={() => setSource((v) => !v)}>
            {translator.t(source ? "ui.preview.rendered" : "ui.preview.source")}
          </button>
        ) : null}
      </div>
      {markdown && !source ? <Markdown source={preview.text ?? ""} /> : null}
      {preview.kind === "IMAGE" && preview.data_url !== undefined ? <img className="preview__image" src={preview.data_url} alt={translator.t("p08.preview.image_alt", { name: preview.path })} /> : null}
      {preview.kind === "HTML" && preview.text !== undefined ? (
        <iframe className="preview__frame" sandbox="" srcDoc={preview.text} title={translator.t("p08.preview.frame_title", { name: preview.path })} />
      ) : null}
      {(preview.kind === "TEXT" || preview.kind === "DOCUMENT") && preview.text !== undefined && !(markdown && !source) ? <pre className="preview__text" dir="auto">{preview.text}</pre> : null}
      {preview.kind === "BINARY" ? <p className="panel__empty">{translator.t("p08.preview.binary")}</p> : null}
      {preview.truncated ? <p className="note">{translator.t("p08.preview.truncated")}</p> : null}
    </div>
  );
}
