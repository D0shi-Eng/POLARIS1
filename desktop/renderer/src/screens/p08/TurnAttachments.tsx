// مرفقات دور في المحادثة (تكليف مكافأة Manus، 2026-10-19): ما أرفقه المستخدم برسالته يظهر فوقها كما في Manus — الصورة
// مصغّرةً والملف شريحةً باسمه وحجمه. قِيس في النسخة التنفيذية أن الرسالة كانت تظهر نصًّا وحده بعد إرسال صورة ملصوقة.
//
// القائمة من المضيف (`attachment.list` للمهمّة)، والمصغّرة من معاينة المساحة نفسها (`workspace.preview`) التي تعطي الصورة
// عنوان data بحدّ حجم؛ لا شيء هنا يفتح ملفًّا أو ينفّذه.

import { useHostQuery } from "../../app/useHostQuery";
import { useTranslator } from "../../app/context";
import type { AttachmentListResultV1, AttachmentV1, WorkspacePreviewResultV1 } from "../../generated/types/desktop-p08-result-v1";
import type { Phase08Client } from "../../ipc/p08-client";
import { formatBytes } from "../../p08/present";
import { Icon } from "../../ui/components/Icon";

export function TurnAttachments({ phase08, missionId }: { readonly phase08: Phase08Client; readonly missionId: string }) {
  const listed = useHostQuery<AttachmentListResultV1 | null>(() => phase08.listAttachments(missionId), [phase08, missionId]);
  const attachments = listed.value?.attachments ?? [];
  if (attachments.length === 0) return null;
  return (
    <ul className="msg-attachments">
      {attachments.map((a) => (a.model_access === "IMAGE_INPUT" ? <ImageAttachment key={a.attachment_id} phase08={phase08} missionId={missionId} attachment={a} /> : <FileAttachment key={a.attachment_id} attachment={a} />))}
    </ul>
  );
}

function ImageAttachment({ phase08, missionId, attachment }: { readonly phase08: Phase08Client; readonly missionId: string; readonly attachment: AttachmentV1 }) {
  const translator = useTranslator();
  const preview = useHostQuery<WorkspacePreviewResultV1 | null>(() => phase08.previewFile(missionId, attachment.workspace_ref), [phase08, missionId, attachment.workspace_ref]);
  const src = preview.value?.kind === "IMAGE" ? preview.value.data_url : undefined;
  if (src === undefined) return <FileAttachment attachment={attachment} />;
  return (
    <li className="msg-attachment msg-attachment--image" title={attachment.file_name}>
      <img src={src} alt={translator.t("p08.preview.image_alt", { name: attachment.file_name })} />
    </li>
  );
}

function FileAttachment({ attachment }: { readonly attachment: AttachmentV1 }) {
  return (
    <li className="msg-attachment chip chip--file" title={attachment.file_name}>
      <Icon name="file" size={14} />
      <span className="chip__name">{attachment.file_name}</span>
      <span className="chip__meta">{formatBytes(attachment.size_bytes)}</span>
    </li>
  );
}
