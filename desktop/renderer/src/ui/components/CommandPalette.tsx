// لوحة البحث السريع (Ctrl+K): تنقّل بين الصفحات والمهامّ الأخيرة من لوحة المفاتيح.
//
// لا تنفّذ شيئًا ولا تسأل المضيف: تعرض ما أعطاها الغلاف (الوجهات من السجل، والمهامّ كما قرأها
// المضيف)، واختيار عنصر تنقّلٌ فقط. الحوار نموذجي: التركيز يبقى داخله، وEscape يغلقه ويعيد التركيز.

import { useEffect, useMemo, useRef, useState } from "react";

import { useTranslator } from "../../app/context";
import { Icon, type IconName } from "./Icon";

export interface PaletteEntry {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly icon: IconName;
  readonly path: string;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly entries: readonly PaletteEntry[];
  onSelect(path: string): void;
  onClose(): void;
}

export function CommandPalette({ open, entries, onSelect, onClose }: CommandPaletteProps) {
  const translator = useTranslator();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = globalThis.document?.activeElement ?? null;
    setQuery("");
    setActive(0);
    // التركيز على حقل البحث عند الفتح
    const timer = setTimeout(() => input.current?.focus(), 0);
    return () => {
      clearTimeout(timer);
      (returnFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matched = needle === "" ? entries : entries.filter((e) => `${e.label} ${e.hint}`.toLocaleLowerCase().includes(needle));
    return matched.slice(0, 12);
  }, [entries, query]);

  if (!open) return null;

  const choose = (entry: PaletteEntry | undefined) => {
    if (entry === undefined) return;
    onSelect(entry.path);
    onClose();
  };

  return (
    <div className="palette__backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={translator.t("ui.palette.title")}>
        <div className="palette__search">
          <Icon name="search" />
          <input
            ref={input}
            className="palette__input"
            type="search"
            value={query}
            aria-label={translator.t("ui.palette.title")}
            placeholder={translator.t("ui.palette.placeholder")}
            aria-controls="palette-results"
            aria-activedescendant={shown[active] === undefined ? undefined : `palette-${shown[active].id}`}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, shown.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(shown[active]);
              } else if (event.key === "Tab") event.preventDefault();
            }}
          />
          <kbd className="palette__kbd">{translator.t("ui.palette.esc")}</kbd>
        </div>
        {shown.length === 0 ? (
          <p className="palette__empty">{translator.t("ui.palette.empty")}</p>
        ) : (
          <ul className="palette__list" id="palette-results" role="listbox" aria-label={translator.t("ui.palette.results")}>
            {shown.map((entry, index) => (
              <li
                key={entry.id}
                id={`palette-${entry.id}`}
                role="option"
                aria-selected={index === active}
                className={index === active ? "palette__item is-active" : "palette__item"}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(entry);
                }}
              >
                <Icon name={entry.icon} />
                <span className="palette__label">{entry.label}</span>
                <span className="palette__hint">{entry.hint}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
