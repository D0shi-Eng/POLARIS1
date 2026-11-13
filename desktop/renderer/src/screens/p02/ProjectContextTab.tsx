// سياق المشروع: المصادر، وإضافتها، ومعاينتها، وتجميع الحزمة.
//
// المراجع نسبية إلى جذر مساحة العمل، والمضيف يرفض الصعود والمسارات المطلقة
// والملفات الحساسة. المعاينة محتوى غير موثوق يُعرض نصًّا خامًا.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import type { ActionState } from "../../app/useHostQuery";
import type { AddableSourceType } from "../../generated/types/desktop-p02-request-v1";
import type {
  ContextBundleView,
  ContextPreviewResultV1,
  ContextSourceView,
} from "../../generated/types/desktop-p02-result-v1";
import { formatNumber } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { availabilityTone } from "../../p02/present";
import { ActionNote } from "../../ui/components/Notes";
import type { ProjectTabProps } from "./ProjectOverviewTab";

const ADDABLE: readonly AddableSourceType[] = ["FILE", "FOLDER", "TEXT_NOTE", "USER_INSTRUCTION"];

export function ProjectContextTab({ client, detail, onChanged }: ProjectTabProps) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const project = detail.project;
  const readOnly = project.status === "ARCHIVED";
  const [type, setType] = useState<AddableSourceType>("FILE");
  const [reference, setReference] = useState("");
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [action, setAction] = useState<ActionState>({ phase: "IDLE" });
  const [preview, setPreview] = useState<ContextPreviewResultV1 | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [bundle, setBundle] = useState<ContextBundleView | null>(null);
  const isPath = type === "FILE" || type === "FOLDER";
  const canAdd = !readOnly && (isPath ? reference.trim() !== "" : text.trim() !== "" && label.trim() !== "");

  async function add(): Promise<void> {
    setAction({ phase: "RUNNING" });
    const result = await client.addContext({
      project_id: project.project_id,
      source_type: type,
      ...(isPath ? { reference: reference.trim() } : { text: text.trim(), display_name: label.trim() }),
    });
    if (result.ok) {
      setAction({ phase: "DONE", messageKey: "context.added" });
      setReference("");
      setText("");
      setLabel("");
    } else {
      setAction({ phase: "FAILED", error: result.error });
    }
    onChanged();
  }

  async function remove(source: ContextSourceView): Promise<void> {
    setAction({ phase: "RUNNING" });
    const result = await client.removeContext(project.project_id, source.source_id);
    setAction(result.ok ? { phase: "DONE", messageKey: "context.removed" } : { phase: "FAILED", error: result.error });
    setSelected((current) => current.filter((id) => id !== source.source_id));
    onChanged();
  }

  async function show(source: ContextSourceView): Promise<void> {
    setAction({ phase: "RUNNING" });
    const result = await client.previewContext(project.project_id, source.source_id);
    if (result.ok) {
      setPreview(result.value);
      setAction({ phase: "IDLE" });
    } else {
      setAction({ phase: "FAILED", error: result.error });
    }
  }

  async function assemble(): Promise<void> {
    setAction({ phase: "RUNNING" });
    const result = await client.assembleContext({
      project_id: project.project_id,
      source_ids: selected,
      instruction: instruction.trim() === "" ? translator.t("context.assemble.default_instruction") : instruction.trim(),
    });
    if (result.ok) {
      setBundle(result.value.bundle);
      setAction({ phase: "IDLE" });
    } else {
      setAction({ phase: "FAILED", error: result.error });
    }
  }

  function toggleSelected(id: string): void {
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }

  return (
    <>
      <p className="note">{translator.t("context.trust.note")}</p>

      {readOnly ? null : (
        <section className="section card" aria-labelledby="context-add">
          <h2 className="section__title" id="context-add">
            {translator.t("context.add.title")}
          </h2>
          <div className="form">
            <label className="form__row" htmlFor="context-type">
              {translator.t("context.add.type")}
              <select id="context-type" className="select" value={type} onChange={(event) => setType(event.target.value as AddableSourceType)}>
                {ADDABLE.map((value) => (
                  <option key={value} value={value}>
                    {translator.t(`context.type.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            {isPath ? (
              <>
                <label className="form__row" htmlFor="context-reference">
                  {translator.t("context.add.reference")}
                  <input
                    id="context-reference"
                    className="input input--mono"
                    value={reference}
                    spellCheck={false}
                    maxLength={1024}
                    aria-describedby="context-reference-hint"
                    onChange={(event) => setReference(event.target.value)}
                  />
                </label>
                <p className="row__hint" id="context-reference-hint">
                  {translator.t(project.workspace_root === undefined ? "context.add.no_workspace" : "context.add.reference.hint")}
                </p>
              </>
            ) : (
              <>
                <label className="form__row" htmlFor="context-label">
                  {translator.t("context.add.label")}
                  <input id="context-label" className="input" value={label} maxLength={160} onChange={(event) => setLabel(event.target.value)} />
                </label>
                <label className="form__row" htmlFor="context-text">
                  {translator.t("context.add.text")}
                  <textarea id="context-text" className="textarea" value={text} maxLength={16000} onChange={(event) => setText(event.target.value)} />
                </label>
              </>
            )}
            <div className="toolbar">
              <button type="button" className="button button--primary" disabled={!canAdd || action.phase === "RUNNING"} onClick={() => void add()}>
                {translator.t("context.add.submit")}
              </button>
            </div>
          </div>
        </section>
      )}
      <ActionNote state={action} />

      <section className="section" aria-labelledby="context-sources">
        <h2 className="section__title" id="context-sources">
          {translator.t("context.sources")}
        </h2>
        {detail.sources.length === 0 ? (
          <p className="row__hint">{translator.t("context.sources.empty")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{translator.t("context.col.select")}</th>
                  <th scope="col">{translator.t("context.col.name")}</th>
                  <th scope="col">{translator.t("context.col.type")}</th>
                  <th scope="col">{translator.t("context.col.trust")}</th>
                  <th scope="col">{translator.t("context.col.availability")}</th>
                  <th scope="col">{translator.t("context.col.size")}</th>
                  <th scope="col">{translator.t("context.col.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.sources.map((source) => (
                  <tr key={source.source_id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(source.source_id)}
                        aria-label={translator.t("context.select_named", { name: source.display_name })}
                        onChange={() => toggleSelected(source.source_id)}
                      />
                    </td>
                    <td>
                      <span className="mono" dir="auto">
                        {source.display_name}
                      </span>
                      {source.source_type === "FILE" || source.source_type === "FOLDER" ? (
                        <span className="row__hint mono">{source.reference}</span>
                      ) : null}
                    </td>
                    <td>{translator.t(`context.type.${source.source_type}`)}</td>
                    <td>{translator.t(`p02.trust.${source.trust_class}`)}</td>
                    <td>
                      <span className={`pill pill--${availabilityTone(source.availability)}`}>
                        {translator.t(`context.availability.${source.availability}`)}
                      </span>
                    </td>
                    <td>
                      {source.byte_count === undefined
                        ? translator.t("p02.value.unknown")
                        : translator.t("context.bytes", { value: formatNumber(locale, source.byte_count) })}
                    </td>
                    <td>
                      <div className="toolbar">
                        <button
                          type="button"
                          className="button button--secondary"
                          aria-label={translator.t("context.preview_named", { name: source.display_name })}
                          onClick={() => void show(source)}
                        >
                          {translator.t("context.preview")}
                        </button>
                        {readOnly || source.source_type === "WORKSPACE_ROOT" ? null : (
                          <button
                            type="button"
                            className="button button--secondary"
                            aria-label={translator.t("context.remove_named", { name: source.display_name })}
                            onClick={() => void remove(source)}
                          >
                            {translator.t("context.remove")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {preview === null ? null : (
        <section className="section card" aria-labelledby="context-preview">
          <h2 className="section__title" id="context-preview">
            {translator.t("context.preview.title", { name: preview.source.display_name })}
          </h2>
          <p className="row__hint">{translator.t(`context.encoding.${preview.encoding}`)}</p>
          {preview.entries === undefined ? null : (
            <ul className="rows">
              {preview.entries.map((entry) => (
                <li className="row mono" key={entry}>
                  {entry}
                </li>
              ))}
            </ul>
          )}
          {preview.preview === undefined ? null : (
            <>
              <p className="untrusted__label">{translator.t("context.preview.untrusted")}</p>
              <pre className="untrusted" dir="auto">
                {preview.preview}
              </pre>
              {preview.preview_truncated === true ? <p className="row__hint">{translator.t("context.preview.truncated")}</p> : null}
            </>
          )}
          <div className="toolbar">
            <button type="button" className="button button--secondary" onClick={() => setPreview(null)}>
              {translator.t("context.preview.close")}
            </button>
          </div>
        </section>
      )}

      <section className="section card" aria-labelledby="context-assemble">
        <h2 className="section__title" id="context-assemble">
          {translator.t("context.assemble.title")}
        </h2>
        <p className="row__hint">{translator.t("context.assemble.hint")}</p>
        <div className="form">
          <label className="form__row" htmlFor="context-instruction">
            {translator.t("context.assemble.instruction")}
            <textarea
              id="context-instruction"
              className="textarea"
              value={instruction}
              maxLength={16000}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
          <div className="toolbar">
            <button
              type="button"
              className="button button--secondary"
              disabled={selected.length === 0 || action.phase === "RUNNING"}
              onClick={() => void assemble()}
            >
              {translator.t("context.assemble.submit")}
            </button>
          </div>
        </div>
        {bundle === null ? null : (
          <div role="status" aria-live="polite">
            <p className="success">
              {translator.t("context.bundle.summary", {
                items: bundle.items.length,
                omitted: bundle.omitted.length,
                bytes: formatNumber(locale, bundle.total_bytes),
                tokens: formatNumber(locale, bundle.estimated_tokens.value),
              })}
            </p>
            <p className="row__hint mono">{translator.t("context.bundle.digest", { digest: bundle.bundle_digest })}</p>
            {bundle.truncated ? <p className="note">{translator.t("context.bundle.truncated")}</p> : null}
            <ul className="rows">
              {bundle.items.map((item) => (
                <li className="row" key={`${item.source_id}:${item.item_reference}`}>
                  <span className="row__label mono">{item.item_reference}</span>
                  <span className="row__value">
                    {translator.t("context.bundle.item", {
                      bytes: formatNumber(locale, item.included_bytes),
                      trust: translator.t(`p02.trust.${item.trust_class}`),
                    })}
                  </span>
                </li>
              ))}
              {bundle.omitted.map((item) => (
                <li className="row" key={`omitted:${item.source_id}:${item.item_reference}`}>
                  <span className="row__label mono">{item.item_reference}</span>
                  <span className="row__value">{translator.t(`context.omission.${item.reason}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}
