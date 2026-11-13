// الاسترجاع الدلالي للذاكرة (PHASE-12 بقرار المالك): خادم تضمين على هذا الجهاز ونموذجه، والحدّ الأدنى للتشابه، وفحص صادق.
// بلا اختيار صريح يبقى الاسترجاع معجميًا ولا يُرسل نصّ ذاكرة إلى أي نموذج. «نشط» يقوله المضيف (يرتّب بالتشابه الآن)، لا
// الإعداد المحفوظ وحده؛ والفحص يضمّن جملة ثابتة لا شيئًا من الذاكرة.

import { useEffect, useState } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { MemorySemanticTestResultV1 } from "../../generated/types/desktop-p08-result-v1";
import type { Phase08Client } from "../../ipc/p08-client";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";

export function SemanticMemoryPanel({ client }: { readonly client: Phase08Client }) {
  const translator = useTranslator();
  const t = (key: string, values?: Record<string, string | number>) => translator.t(key, values);
  const action = useAction();
  const status = useHostQuery(() => client.memorySemanticStatus(), [client, action.state]);
  const s = status.value;
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [threshold, setThreshold] = useState("0.6");
  const [queryPrefix, setQueryPrefix] = useState("");
  const [documentPrefix, setDocumentPrefix] = useState("");
  const [test, setTest] = useState<MemorySemanticTestResultV1 | "FAILED" | null>(null);
  const [testing, setTesting] = useState(false);

  // الحقول تبدأ بما حفظه المضيف، وتُحدَّث كلّما أعاد حالة جديدة.
  useEffect(() => {
    if (s === null) return;
    setEnabled(s.enabled);
    setEndpoint(s.endpoint ?? "");
    setModel(s.model ?? "");
    setThreshold(String(s.min_similarity));
    setQueryPrefix(s.query_prefix);
    setDocumentPrefix(s.document_prefix);
  }, [s]);

  const min = Number(threshold);
  // ضمن [0.3، 0.95] كما يفرضه العقد والمضيف.
  const thresholdValid = Number.isFinite(min) && Math.min(Math.max(min, 0.3), 0.95) === min;
  const canSave = thresholdValid && (!enabled || (endpoint.trim() !== "" && model.trim() !== ""));

  const save = () =>
    void action.run(
      () =>
        client.setMemorySemantic({
          enabled,
          ...(endpoint.trim() === "" ? {} : { endpoint: endpoint.trim() }),
          ...(model.trim() === "" ? {} : { model: model.trim() }),
          min_similarity: min,
          query_prefix: queryPrefix,
          document_prefix: documentPrefix,
        }),
      () => ({ phase: "DONE", messageKey: "p08.saved" }),
    );

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    const result = await client.testMemorySemantic();
    setTesting(false);
    setTest(result.ok ? result.value : "FAILED");
  };

  const state = s === null ? t("state.loading") : s.active ? t("p08.semantic.state.active", { retrievals: s.retrievals, failures: s.failures }) : s.enabled ? t("p08.semantic.state.saved_inactive") : t("p08.semantic.state.off");

  return (
    <div className="card" data-panel="semantic-memory">
      <h3 className="section__title">{t("p08.semantic.title")}</h3>
      <p className="note">{t("p08.semantic.note")}</p>
      {status.error !== null ? <ErrorNote error={status.error} onRetry={status.reload} /> : null}
      <p className={s?.active === true ? "success" : "note"} role="status">
        {state}
      </p>
      <label className="check" htmlFor="semantic-enabled">
        <input id="semantic-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {t("p08.semantic.enabled")}
      </label>
      <div className="form-grid">
        <label htmlFor="semantic-endpoint">{t("p08.semantic.endpoint")}</label>
        <input id="semantic-endpoint" dir="ltr" placeholder={t("p08.semantic.endpoint_placeholder")} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
        <p className="note">{t("p08.semantic.endpoint_hint")}</p>
        <label htmlFor="semantic-model">{t("p08.semantic.model")}</label>
        <input id="semantic-model" dir="ltr" placeholder={t("p08.semantic.model_placeholder")} value={model} onChange={(e) => setModel(e.target.value)} />
        <label htmlFor="semantic-threshold">{t("p08.semantic.threshold")}</label>
        <input id="semantic-threshold" type="number" dir="ltr" min={0.3} max={0.95} step={0.05} value={threshold} aria-invalid={!thresholdValid} onChange={(e) => setThreshold(e.target.value)} />
        <p className="note">{t("p08.semantic.threshold_hint")}</p>
        <label htmlFor="semantic-query-prefix">{t("p08.semantic.query_prefix")}</label>
        <input id="semantic-query-prefix" dir="ltr" maxLength={40} placeholder={t("p08.semantic.query_prefix_placeholder")} value={queryPrefix} onChange={(e) => setQueryPrefix(e.target.value)} />
        <label htmlFor="semantic-document-prefix">{t("p08.semantic.document_prefix")}</label>
        <input id="semantic-document-prefix" dir="ltr" maxLength={40} placeholder={t("p08.semantic.document_prefix_placeholder")} value={documentPrefix} onChange={(e) => setDocumentPrefix(e.target.value)} />
        <p className="note">{t("p08.semantic.prefix_hint")}</p>
      </div>
      <div className="toolbar">
        <button type="button" className="button button--primary" disabled={!canSave} onClick={save}>
          {t("p08.save")}
        </button>
        <button type="button" className="button" disabled={testing || (s?.endpoint ?? null) === null} onClick={() => void runTest()}>
          {t(testing ? "p08.semantic.testing" : "p08.semantic.test")}
        </button>
      </div>
      {test === null ? null : (
        <p className={test !== "FAILED" && test.outcome === "OK" ? "success" : "note tone-bad"} role="status" aria-live="polite">
          {test === "FAILED" ? t("p08.semantic.test.FAILED") : t(`p08.semantic.test.${test.outcome}`, { dimensions: test.dimensions ?? 0, ms: test.duration_ms })}
        </p>
      )}
      <ActionNote state={action.state} />
    </div>
  );
}
