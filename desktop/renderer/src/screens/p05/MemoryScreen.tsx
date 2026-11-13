// الذاكرة: ما حُفظ، ومن كتبه، وهل رُبط بدليل، ومن أين جاء — وحذفه حقًّا.
//
// ما لا يوجد هنا مقصود: لا زرّ «اعتبرها صحيحة»، ولا حقل يحرّر المحتوى، ولا عرض لتفكير
// مخفي. الحذف يمرّ بحوار تأكيد، ويمحو من المخزن لا من الشاشة.

import { useEffect, useRef, useState } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { MemoryListInput, Phase05Client } from "../../ipc/p05-client";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { memoryStatusTone, originTone, verificationTone } from "../../p05/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { P05Pill } from "./P05Pill";

const SCOPES = ["MISSION", "PROJECT", "USER", "SYSTEM"] as const;
const TYPES = ["WORKING", "EPISODIC", "SEMANTIC", "PREFERENCE", "PROJECT"] as const;
const STATUSES = ["ACTIVE", "SUPERSEDED", "EXPIRED", "DELETED"] as const;

export function MemoryScreen({ client }: { readonly client: Phase05Client }) {
  const translator = useTranslator();
  return (
    <>
      <h1 className="page-title">{translator.t("nav.memory")}</h1>
      <p className="page-subtitle">{translator.t("memory.subtitle")}</p>
      <MemoryPanel client={client} />
    </>
  );
}

/** لوحة الذاكرة. في تفاصيل مهمّة تُقيَّد بها؛ وفي الصفحة العامّة تُرشَّح بما يختاره المستخدم. */
export function MemoryPanel({ client, missionId }: { readonly client: Phase05Client; readonly missionId?: string }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const [draft, setDraft] = useState<MemoryListInput>({});
  const [filter, setFilter] = useState<MemoryListInput>({});
  const [viewing, setViewing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const action = useAction();
  const query = useHostQuery(
    () => client.listMemories({ ...filter, ...(missionId === undefined ? {} : { mission_id: missionId }) }),
    [client, missionId, filter.scope, filter.memory_type, filter.status, filter.text],
  );
  const memories = query.value?.memories ?? [];

  const select = (key: keyof MemoryListInput, value: string) =>
    setDraft((current) => ({ ...current, [key]: value === "" ? undefined : value }));

  return (
    <>
      <p className="note" role="note">
        {translator.t(missionId === undefined ? "memory.note.untrusted" : "mission.memory.note")}
      </p>
      <form
        className="filters"
        aria-label={translator.t("memory.filter.legend")}
        onSubmit={(event) => {
          event.preventDefault();
          setFilter(draft);
        }}
      >
        <label>
          {translator.t("memory.filter.text")}{" "}
          <input type="search" id="memory-filter-text" maxLength={200} value={draft.text ?? ""} onChange={(event) => select("text", event.target.value)} />
        </label>{" "}
        <label>
          {translator.t("memory.filter.scope")}{" "}
          <select id="memory-filter-scope" value={draft.scope ?? ""} onChange={(event) => select("scope", event.target.value)}>
            <option value="">{translator.t("memory.filter.any")}</option>
            {SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {translator.t(`p05.scope.${scope}`)}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          {translator.t("memory.filter.type")}{" "}
          <select id="memory-filter-type" value={draft.memory_type ?? ""} onChange={(event) => select("memory_type", event.target.value)}>
            <option value="">{translator.t("memory.filter.any")}</option>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {translator.t(`p05.type.${type}`)}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          {translator.t("memory.filter.status")}{" "}
          <select id="memory-filter-status" value={draft.status ?? ""} onChange={(event) => select("status", event.target.value)}>
            <option value="">{translator.t("memory.filter.any")}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {translator.t(`p05.status.${status}`)}
              </option>
            ))}
          </select>
        </label>{" "}
        <button type="submit" className="button button--secondary">
          {translator.t("memory.filter.apply")}
        </button>
      </form>

      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      <ActionNote state={action.state} />

      {memories.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey="memory.empty" />
      ) : (
        <table className="table">
          <caption className="sr-only">{translator.t("nav.memory")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("memory.column.subject")}</th>
              <th scope="col">{translator.t("memory.column.type")}</th>
              <th scope="col">{translator.t("memory.column.scope")}</th>
              <th scope="col">{translator.t("memory.column.origin")}</th>
              <th scope="col">{translator.t("memory.column.verification")}</th>
              <th scope="col">{translator.t("memory.column.source")}</th>
              <th scope="col">{translator.t("memory.column.status")}</th>
              <th scope="col">{translator.t("memory.column.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {memories.map((memory) => (
              <tr key={memory.memory_id} data-memory-id={memory.memory_id}>
                <th scope="row">
                  {memory.subject === "" ? <span className="muted">—</span> : memory.subject}
                  <br />
                  <span className="muted">{memory.summary}</span>
                </th>
                <td>
                  <P05Pill namespace="type" member={memory.memory_type} tone="MUTED" />
                </td>
                <td>
                  <P05Pill namespace="scope" member={memory.scope} tone="MUTED" />
                </td>
                <td>
                  <P05Pill namespace="trust" member={memory.trust_class} tone={originTone(memory.trust_class)} />
                </td>
                <td>
                  <P05Pill namespace="verification" member={memory.verification} tone={verificationTone(memory.verification)} />
                </td>
                <td>
                  <code className="muted">{memory.source}</code>
                </td>
                <td>
                  <P05Pill namespace="status" member={memory.status} tone={memoryStatusTone(memory.status)} />
                </td>
                <td>
                  {formatInstant(locale, memory.updated_at)}{" "}
                  <button
                    type="button"
                    className="button button--secondary"
                    aria-label={`${translator.t("memory.action.view")} ${memory.subject}`}
                    onClick={() => setViewing(memory.memory_id)}
                  >
                    {translator.t("memory.action.view")}
                  </button>{" "}
                  {memory.status === "DELETED" ? null : (
                    <button
                      type="button"
                      className="button button--secondary memory-delete"
                      aria-label={`${translator.t("memory.action.delete")} ${memory.subject}`}
                      onClick={() => setConfirming(memory.memory_id)}
                    >
                      {translator.t("memory.action.delete")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {viewing === null ? null : <MemoryDetail client={client} memoryId={viewing} onClose={() => setViewing(null)} />}
      {confirming === null ? null : (
        <ConfirmDelete
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const id = confirming;
            setConfirming(null);
            if (viewing === id) setViewing(null);
            void action.run(
              () => client.deleteMemory(id),
              () => ({ phase: "DONE", messageKey: "memory.deleted" }),
              query.reload,
            );
          }}
        />
      )}
    </>
  );
}

function MemoryDetail({ client, memoryId, onClose }: { readonly client: Phase05Client; readonly memoryId: string; onClose(): void }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(() => client.getMemory(memoryId), [client, memoryId]);
  const memory = query.value?.memory;
  const conflicts = query.value?.conflicts ?? [];
  return (
    <section className="section memory-detail" role="region" aria-labelledby="memory-detail-title">
      <h2 className="section__title" id="memory-detail-title">
        {translator.t("memory.detail.title")}
      </h2>
      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      {memory === undefined ? null : (
        <dl className="facts">
          <dt>{translator.t("memory.detail.label")}</dt>
          <dd>
            <span className="pill pill--WARNING">{memory.label}</span>
          </dd>
          <dt>{translator.t("memory.column.subject")}</dt>
          <dd>{memory.subject}</dd>
          <dt>{translator.t("memory.detail.content")}</dt>
          <dd className="memory-content">{memory.content}</dd>
          <dt>{translator.t("memory.column.origin")}</dt>
          <dd>
            <P05Pill namespace="trust" member={memory.trust_class} tone={originTone(memory.trust_class)} />
          </dd>
          <dt>{translator.t("memory.column.verification")}</dt>
          <dd>
            <P05Pill namespace="verification" member={memory.verification} tone={verificationTone(memory.verification)} />
          </dd>
          <dt>{translator.t("memory.detail.confidence")}</dt>
          <dd>{translator.t(`p05.confidence.${memory.confidence_source}`)}</dd>
          <dt>{translator.t("memory.detail.taint")}</dt>
          <dd>
            {memory.taint.length === 0
              ? translator.t("memory.detail.none")
              : memory.taint.map((flag) => <P05Pill key={flag} namespace="taint" member={flag} tone="WARNING" />)}
          </dd>
          <dt>{translator.t("memory.detail.sources")}</dt>
          <dd>
            {memory.source_refs.length === 0 ? (
              translator.t("memory.detail.none")
            ) : (
              <ul>
                {memory.source_refs.map((ref) => (
                  <li key={`${ref.kind}:${ref.reference}`}>
                    {translator.t(`p05.source.${ref.kind}`)} <code>{ref.reference}</code>
                  </li>
                ))}
              </ul>
            )}
          </dd>
          <dt>{translator.t("memory.detail.importance")}</dt>
          <dd>{memory.importance}</dd>
          <dt>{translator.t("memory.detail.version")}</dt>
          <dd>{memory.version}</dd>
          <dt>{translator.t("memory.detail.created")}</dt>
          <dd>{formatInstant(locale, memory.created_at)}</dd>
          <dt>{translator.t("memory.detail.accessed")}</dt>
          <dd>{memory.last_accessed_at === undefined ? translator.t("memory.detail.none") : formatInstant(locale, memory.last_accessed_at)}</dd>
          <dt>{translator.t("memory.detail.conflicts")}</dt>
          <dd>
            {conflicts.length === 0 ? (
              translator.t("memory.detail.no_conflicts")
            ) : (
              <ul>
                {conflicts.map((conflict) => (
                  <li key={conflict.conflict_id}>
                    <P05Pill namespace="conflict" member={conflict.state} tone="WARNING" /> <code>{conflict.memory_a}</code> ↔{" "}
                    <code>{conflict.memory_b}</code>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
      )}
      <button type="button" className="button button--secondary" onClick={onClose}>
        {translator.t("memory.action.close")}
      </button>
    </section>
  );
}

/** حوار تأكيد الحذف: التركيز ينتقل إليه، وEscape يلغي، ولا حذف بنقرة واحدة. */
function ConfirmDelete({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  const translator = useTranslator();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div
      className="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="memory-delete-title"
      aria-describedby="memory-delete-body"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <h2 id="memory-delete-title" className="section__title">
        {translator.t("memory.delete.title")}
      </h2>
      <p id="memory-delete-body">{translator.t("memory.delete.body")}</p>
      <button type="button" className="button button--secondary" ref={cancelRef} onClick={onCancel}>
        {translator.t("memory.delete.cancel")}
      </button>{" "}
      <button type="button" className="button button--primary memory-delete-confirm" onClick={onConfirm}>
        {translator.t("memory.delete.confirm")}
      </button>
    </div>
  );
}
