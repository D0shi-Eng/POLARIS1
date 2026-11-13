// ملاحظة الموافقة على فعل موصل. الملخّص نفسه كتبه المضيف؛ هذه الملاحظة تقول ما تعنيه
// الموافقة بالضبط: نداء واحد، بهذه الحجج، إلى خدمة خارجية، ولا يُعاد تلقائيًّا.

import { useTranslator } from "../../app/context";

const CONNECTOR_ACTION = /^CONNECTOR_([A-Z_]+)$/;

export function ConnectorActionNote({ action }: { readonly action: string }) {
  const translator = useTranslator();
  const match = CONNECTOR_ACTION.exec(action);
  if (match === null) return null;
  const member = match[1] ?? "";
  return (
    <span className="p06-approval-note" data-connector-action={member}>
      <br />
      <strong>{translator.t(`p06.action.${member}`)}</strong>
      <br />
      <span className="muted">{translator.t(member === "READ" ? "conn.approval.read" : "conn.approval.side_effect")}</span>
    </span>
  );
}
