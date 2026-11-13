// «تذكّر هذا» (ADR-032): نصّ يكتبه المستخدم أو يختاره من رسالته، يحفظه POLARIS عنه أو عن مشروع المحادثة.
//
// المضيف يقرّر الحفظ بسياسة الذاكرة نفسها (حدود، أسرار، تكرار) ويقول ما فعل؛ الحوار يعرض قراره كما هو، فلا يقول
// «حُفظ» لما رُفض. ما يُحفظ يصل الوكيل في المهام اللاحقة بيانات موسومة غير موثوقة، لا تعليمات.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import type { Phase08Client } from "../../ipc/p08-client";
import { errorText } from "../../p08/threads";
import { Dialog } from "./Dialog";

const OUTCOME: Readonly<Record<string, string>> = {
  PROMOTED: "ui.memory.saved",
  DUPLICATE: "ui.memory.duplicate",
  COALESCED: "ui.memory.coalesced",
};

/** سبب الرفض بجملة يفهمها المستخدم؛ غير المعروف يُعرض برمزه. */
const REJECTED: Readonly<Record<string, string>> = {
  SECRET_LIKE_CONTENT: "ui.memory.reject.secret",
  CONTENT_TOO_LARGE: "ui.memory.reject.large",
  PAGE_DUMP: "ui.memory.reject.large",
  RAW_REASONING: "ui.memory.reject.reasoning",
};

export function RememberDialog({ phase08, initialText = "", projectId, missionId, onSaved, onClose }: { readonly phase08: Phase08Client; readonly initialText?: string; readonly projectId?: string | undefined; readonly missionId?: string | undefined; onSaved?(): void; onClose(): void }) {
  const translator = useTranslator();
  const [text, setText] = useState(initialText.slice(0, 2000));
  const [scope, setScope] = useState<"USER" | "PROJECT">("USER");
  // الموضوع (D2): بتسميته يحدّث المستخدم ما قاله سابقًا عن الموضوع نفسه بدل أن يتعارض معه.
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await phase08.rememberMemory({
      text: text.trim(),
      ...(topic.trim() === "" ? {} : { topic: topic.trim() }),
      scope,
      ...(scope === "PROJECT" && projectId !== undefined ? { project_id: projectId } : {}),
      ...(missionId === undefined ? {} : { mission_id: missionId }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(translator, result.error));
      return;
    }
    const { decision, reason } = result.value;
    if (decision === "REJECTED") {
      setError(translator.t(REJECTED[reason] ?? "ui.memory.reject.other", { reason }));
      return;
    }
    setOutcome(translator.t(decision === "PROMOTED" && reason === "SUPERSEDED_BY_USER" ? "ui.memory.replaced" : (OUTCOME[decision] ?? "ui.memory.saved")));
    onSaved?.();
  }

  if (outcome !== null) {
    return <Dialog title={translator.t("ui.memory.remember")} hint={outcome} confirmLabel={translator.t("ui.close")} className="mdialog--small" single onConfirm={onClose} onClose={onClose} />;
  }
  return (
    <Dialog
      title={translator.t("ui.memory.remember")}
      hint={translator.t("ui.memory.remember_hint")}
      confirmLabel={translator.t("ui.project.save")}
      canConfirm={text.trim() !== ""}
      busy={busy}
      error={error}
      className="mdialog--instructions"
      onConfirm={() => void save()}
      onClose={onClose}
    >
      <textarea className="mtextarea mtextarea--short" value={text} maxLength={2000} rows={4} dir="auto" aria-label={translator.t("ui.memory.remember")} placeholder={translator.t("ui.memory.placeholder")} onChange={(event) => setText(event.target.value)} />
      <label className="mfield">
        <span className="mfield__label">{translator.t("ui.memory.topic")}</span>
        <input className="minput" value={topic} maxLength={80} dir="auto" placeholder={translator.t("ui.memory.topic_placeholder")} onChange={(event) => setTopic(event.target.value)} />
        <span className="mfield__note">{translator.t("ui.memory.topic_hint")}</span>
      </label>
      {projectId === undefined ? null : (
        <div className="mchoice" role="radiogroup" aria-label={translator.t("ui.memory.scope")}>
          <label className="mchoice__item">
            <input type="radio" name="memory-scope" checked={scope === "USER"} onChange={() => setScope("USER")} />
            {translator.t("ui.memory.scope_user")}
          </label>
          <label className="mchoice__item">
            <input type="radio" name="memory-scope" checked={scope === "PROJECT"} onChange={() => setScope("PROJECT")} />
            {translator.t("ui.memory.scope_project")}
          </label>
        </div>
      )}
      <p className="mfield__note">{translator.t("ui.memory.note")}</p>
    </Dialog>
  );
}
