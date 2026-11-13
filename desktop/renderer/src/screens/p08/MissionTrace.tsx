// تتبّع المهمّة (R-11، 2026-10-12): ما قاسه المضيف لكل وكيل ونداء نموذج وأداة، وأحداث الأمن، وسلامة سجلّ الجلسة.
// قراءة فقط من `mission.trace`. لا شيء هنا من نثر النموذج، ولا تصدير يُرسل إلى أيّ مكان.

import { useEffect, useState } from "react";

import { useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { MissionTraceResultV1 } from "../../generated/types/desktop-p08-result-v1";
import type { Phase08Client } from "../../ipc/p08-client";
import { formatDuration } from "../../p08/present";
import { Icon } from "../../ui/components/Icon";

/** خلاصة مقيسة للمهمّة كلها كما حسبها المضيف (CP-10-1): الصفحة جزء من الامتدادات، فلا تُحسب المجاميع منها. T-8: نداء تمّ ولم
 *  يبلّغ مزوّده رموزه يُعدّ في `unreported` ولا يُجمع صفرًا. */
export function traceTotals(trace: MissionTraceResultV1): { readonly agents: number; readonly modelCalls: number; readonly toolCalls: number; readonly inputTokens: number; readonly outputTokens: number; readonly unreported: number; readonly denied: number } {
  const t = trace.totals;
  return { agents: t.agents, modelCalls: t.model_calls, toolCalls: t.tool_calls, inputTokens: t.input_tokens, outputTokens: t.output_tokens, unreported: t.unreported, denied: t.denied };
}

export function MissionTrace({ phase08, missionId, refreshKey, onClose }: { readonly phase08: Phase08Client; readonly missionId: string; readonly refreshKey: string; onClose(): void }) {
  const translator = useTranslator();
  const query = useHostQuery(() => phase08.missionTrace(missionId), [phase08, missionId, refreshKey]);
  const trace = query.value;
  // الصفحات التالية تُلحق بما عُرض؛ تحديث التتبّع يبدأ من الصفحة الأولى.
  const [more, setMore] = useState<{ readonly spans: MissionTraceResultV1["spans"]; readonly next: number | null }>({ spans: [], next: null });
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => setMore({ spans: [], next: trace?.next_after ?? null }), [trace]);
  const shown = trace === null ? [] : [...trace.spans, ...more.spans];
  const loadMore = async (): Promise<void> => {
    if (more.next === null || loadingMore) return;
    setLoadingMore(true);
    const page = await phase08.missionTrace(missionId, false, more.next);
    setLoadingMore(false);
    if (page.ok) setMore((m) => ({ spans: [...m.spans, ...page.value.spans], next: page.value.next_after ?? null }));
  };
  return (
    <section className="steptree" aria-labelledby="trace-title">
      <header className="steptree__head">
        <h2 className="steptree__title" id="trace-title">
          {translator.t("p08.trace.title")}
        </h2>
        <button type="button" className="icon-button" aria-label={translator.t("ui.close")} title={translator.t("ui.close")} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </header>
      {query.error !== null ? <p className="note" role="alert">{translator.t("p08.trace.unavailable")}</p> : null}
      {trace === null ? null : (
        <>
          <p className={trace.session_chain.state === "INTACT" ? "note" : "note tone-bad"} role={trace.session_chain.state === "INTACT" ? undefined : "alert"}>
            {trace.session_chain.state === "INTACT"
              ? translator.t("p08.trace.chain_intact", { n: trace.session_chain.events ?? 0 })
              : translator.t("p08.trace.chain_broken", { seq: trace.session_chain.at_seq ?? 0 })}
          </p>
          <TraceSummary trace={trace} />
          {trace.security_events.length === 0 ? null : (
            <>
              <h3 className="steptree__title">{translator.t("p08.trace.security")}</h3>
              <ul className="steptree__calls">
                {trace.security_events.map((event) => (
                  <li key={event.seq} className="steptree__call">
                    <span className="steptree__verb" dir="ltr">{event.kind}</span>
                    <span className="steptree__status" dir="auto">{event.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className="steptree__title">{translator.t("p08.trace.spans")}</h3>
          <ol className="steptree__list">
            {shown.map((span) => (
              <li key={span.span_id} className={`steptree__call is-${span.status.toLowerCase()}`}>
                <span className="steptree__verb" dir="ltr">{span.name === "execute_tool" ? span.tool_id ?? span.name : span.name === "chat" ? span.model_id ?? span.name : translator.t("p08.trace.agent")}</span>
                <span className="steptree__status">{translator.t(`p08.trace.status.${span.status}`)}</span>
                {span.latency_ms === null || span.latency_ms === undefined ? null : <span className="steptree__time">{formatDuration(span.latency_ms)}</span>}
                {span.gate_decision === null || span.gate_decision === undefined || span.gate_decision === span.status ? null : <span className="oc-tag" dir="ltr">{span.gate_decision}</span>}
              </li>
            ))}
          </ol>
          {more.next === null ? null : (
            <button type="button" className="button" disabled={loadingMore} onClick={() => void loadMore()}>
              {translator.t("p08.trace.more", { shown: shown.length, total: trace.spans_total })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function TraceSummary({ trace }: { readonly trace: MissionTraceResultV1 }) {
  const translator = useTranslator();
  const totals = traceTotals(trace);
  return (
    <p className="note">
      {translator.t("p08.trace.summary", {
        agents: totals.agents,
        model: totals.modelCalls,
        tools: totals.toolCalls,
        denied: totals.denied,
        input: totals.inputTokens,
        output: totals.outputTokens,
      })}
      {totals.unreported > 0 ? (
        <>
          {" "}
          {translator.t("p08.trace.unreported", { count: totals.unreported })}
        </>
      ) : null}
    </p>
  );
}
