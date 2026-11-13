// أدوات MCP أُعيد تعريفها بعد اكتشافها (R-11، 2026-10-12): تبقى معطّلة حتى يقبل المستخدم تعريفها الجديد. القبول قرار المستخدم
// وحده، والمضيف يعيد التحقّق من الحجج بالمخطط الجديد بعده. لا قبول آلي ولا قبول جماعي صامت.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import type { Phase08Client } from "../../ipc/p08-client";

export function RedefinitionNotice({ pending, client, onAccepted }: { readonly pending: readonly string[]; readonly client: Phase08Client | undefined; onAccepted(toolId: string): void }) {
  const translator = useTranslator();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (pending.length === 0) return null;
  async function accept(toolId: string): Promise<void> {
    if (client === undefined) return;
    setBusy(toolId);
    setFailed(null);
    const result = await client.acceptToolRedefinition(toolId);
    setBusy(null);
    if (result.ok && result.value.accepted) onAccepted(toolId);
    else setFailed(toolId);
  }
  return (
    <section className="section" aria-labelledby="mcp-redefined">
      <h2 className="section__title" id="mcp-redefined">
        {translator.t("mcp.redefined.title")}
      </h2>
      <p className="note">{translator.t("mcp.redefined.note")}</p>
      <ul className="list">
        {pending.map((toolId) => (
          <li key={toolId} className="row">
            <code dir="ltr">{toolId}</code>{" "}
            <button type="button" className="button button--secondary" disabled={client === undefined || busy !== null} aria-label={translator.t("mcp.redefined.accept_named", { tool: toolId })} onClick={() => void accept(toolId)}>
              {translator.t("mcp.redefined.accept")}
            </button>
            {failed === toolId ? <span className="note" role="alert"> {translator.t("mcp.redefined.failed")}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
