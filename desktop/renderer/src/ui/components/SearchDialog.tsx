// البحث كما في مانوس (Ctrl+K أو «بحث»): «ابحث عن المهام…»، و«مهمة جديدة» أوّلًا، ثم المحادثات مجمّعة بالزمن
// (اليوم، أمس، آخر 7 أيام، أقدم) بعنوانها ومقطع من جوابها أو من الموضع المطابق، ووقتها.
//
// البحث في المضيف (`conversation.search`): في العنوان والرسائل والأجوبة، بلا اعتبار لفروق الإملاء العربي. والصفحات
// تُعرض مجموعةً أخيرة حين يطابقها الطلب (بقيّة لوحة التنقّل القديمة). لا شيء هنا ينفّذ: الاختيار تنقّل فقط.

import { useEffect, useMemo, useRef, useState } from "react";

import { useTranslator } from "../../app/context";
import type { ConversationSearchResultV1 } from "../../generated/types/desktop-p08-result-v1";
import type { Phase08Client } from "../../ipc/p08-client";
import type { LocaleCode } from "../../localization/types";
import { missionPath } from "../../routes/registry";
import type { PaletteEntry } from "./CommandPalette";
import { Icon } from "./Icon";

type Hit = ConversationSearchResultV1["results"][number];

interface Row {
  readonly id: string;
  readonly path: string | null;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly time?: string | undefined;
  readonly kind: "new" | "thread" | "page";
}

function bucketOf(iso: string, now: Date): "today" | "yesterday" | "week" | "older" {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "older";
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return "today";
  if (t >= start - 86_400_000) return "yesterday";
  if (t >= start - 7 * 86_400_000) return "week";
  return "older";
}

function timeOf(locale: LocaleCode, iso: string, bucket: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (bucket === "today" || bucket === "yesterday") return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(d);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

export function SearchDialog({ open, phase08, pages, onSelect, onNew, onClose }: { readonly open: boolean; readonly phase08: Phase08Client; readonly pages: readonly PaletteEntry[]; onSelect(path: string): void; onNew(): void; onClose(): void }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly Hit[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const timer = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  // يُسأل المضيف بعد توقّف قصير عن الكتابة، وتُهمل أجوبة طلب تجاوزه طلب أحدث.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(() => {
      void phase08.searchConversations(query).then((result) => {
        if (alive && result.ok) setHits(result.value.results);
      });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, phase08, query]);

  const now = useMemo(() => new Date(), [open]);
  const groups = useMemo(() => {
    const order = ["today", "yesterday", "week", "older"] as const;
    const byBucket = new Map<string, Row[]>();
    for (const h of hits) {
      const bucket = bucketOf(h.updated_at, now);
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), { id: h.thread_id, path: missionPath(h.thread_id), title: h.title, detail: h.snippet, time: timeOf(locale, h.updated_at, bucket), kind: "thread" }]);
    }
    const needle = query.trim().toLocaleLowerCase();
    const pageRows: Row[] = needle === "" ? [] : pages.filter((p) => p.label.toLocaleLowerCase().includes(needle)).slice(0, 6).map((p) => ({ id: p.id, path: p.path, title: p.label, kind: "page" as const }));
    return [
      { key: "new", rows: [{ id: "new", path: null, title: translator.t("ui.rail.new_mission"), kind: "new" as const }] },
      ...order.filter((b) => byBucket.has(b)).map((b) => ({ key: b, rows: byBucket.get(b) ?? [] })),
      ...(pageRows.length === 0 ? [] : [{ key: "pages", rows: pageRows }]),
    ];
  }, [hits, now, locale, pages, query, translator]);
  const flat = groups.flatMap((g) => g.rows);

  if (!open) return null;

  const choose = (row: Row | undefined) => {
    if (row === undefined) return;
    if (row.kind === "new") onNew();
    else if (row.path !== null) onSelect(row.path);
    onClose();
  };

  let index = -1;
  return (
    <div className="palette__backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette search-dialog" role="dialog" aria-modal="true" aria-label={translator.t("ui.search.title")}>
        <div className="palette__search">
          <Icon name="search" />
          <input
            ref={input}
            className="palette__input"
            type="search"
            value={query}
            dir="auto"
            aria-label={translator.t("ui.search.title")}
            placeholder={translator.t("ui.search.placeholder")}
            aria-controls="search-results"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, flat.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(flat[active]);
              }
            }}
          />
          <button type="button" className="icon-button" aria-label={translator.t("ui.close")} title={translator.t("ui.close")} onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="search-dialog__body" id="search-results" role="listbox" aria-label={translator.t("ui.palette.results")}>
          {groups.map((g) => (
            <div key={g.key} className="search-group">
              {g.key === "new" ? null : <p className="search-group__title">{translator.t(`ui.search.group.${g.key}`)}</p>}
              {g.rows.map((row) => {
                index += 1;
                const at = index;
                return (
                  <div
                    key={`${g.key}-${row.id}`}
                    role="option"
                    aria-selected={at === active}
                    className={at === active ? "search-row is-active" : "search-row"}
                    onMouseEnter={() => setActive(at)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(row);
                    }}
                  >
                    <Icon name={row.kind === "new" ? "edit" : row.kind === "page" ? "grid" : "report"} size={16} className="search-row__icon" />
                    <span className="search-row__text">
                      <span className="search-row__title" dir="auto">
                        {row.title}
                      </span>
                      {row.detail === undefined || row.detail === "" ? null : (
                        <span className="search-row__detail" dir="auto">
                          {row.detail}
                        </span>
                      )}
                    </span>
                    {row.time === undefined ? null : <span className="search-row__time">{row.time}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {query.trim() !== "" && hits.length === 0 ? <p className="palette__empty">{translator.t("ui.search.empty")}</p> : null}
        </div>
      </div>
    </div>
  );
}
