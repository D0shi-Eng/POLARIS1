// حوارات صغيرة على نمط مانوس: عنوان، ونصّ أو حقول، وزرّان. يُغلق بـ Escape وبالنقر خارجه وبزرّ ×.
//
// لا منطق عمل هنا: من يفتح الحوار يقرّر ما يحدث عند التأكيد. زرّ التأكيد يُعطَّل أثناء الطلب، والخطأ يُعرض
// داخل الحوار نفسه بنصّ المضيف، فلا يُغلق الحوار على فشل صامت.

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useTranslator } from "../../app/context";
import { Icon, type IconName } from "./Icon";

export interface DialogProps {
  readonly title: string;
  readonly hint?: string | undefined;
  /** أيقونة في رأس الحوار وسطه (حوارات المشروع)، أو لا شيء (حوارات المهمة). */
  readonly icon?: IconName | undefined;
  readonly children?: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string | undefined;
  readonly danger?: boolean;
  readonly busy?: boolean;
  readonly canConfirm?: boolean;
  readonly error?: string | null | undefined;
  /** أزرار بعرض الحوار كلّه (حوارات المشروع) أو في الطرف (حوارات المهمة). */
  readonly wide?: boolean;
  readonly className?: string;
  /** حوار إعلام بزرّ واحد («إغلاق»)، بلا «إلغاء» لا معنى له. */
  readonly single?: boolean;
  onConfirm(): void;
  onClose(): void;
}

export function Dialog({ title, hint, icon, children, confirmLabel, cancelLabel, danger = false, busy = false, canConfirm = true, error, wide = false, className = "", single = false, onConfirm, onClose }: DialogProps) {
  const translator = useTranslator();
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.document?.addEventListener("keydown", onKey);
    // التركيز على أول حقل، وإلا على الحوار نفسه.
    const first = box.current?.querySelector<HTMLElement>("input, textarea");
    (first ?? box.current)?.focus();
    return () => globalThis.document?.removeEventListener("keydown", onKey);
  }, [onClose]);
  const titleId = `mdialog-${title.length}-${confirmLabel.length}`;
  // في جذر المستند: حوار يُفتح من صفّ في الشريط (سلفه فيه `transform`) لا يغطّي الصفحة إن بقي في مكانه.
  const body = globalThis.document?.body;
  const view = (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} className={`mdialog ${icon === undefined ? "" : "mdialog--centered"} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="icon-button mdialog__close" aria-label={translator.t("ui.close")} title={translator.t("ui.close")} onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
        {icon === undefined ? null : (
          <span className="mdialog__icon" aria-hidden="true">
            <Icon name={icon} size={22} />
          </span>
        )}
        <h2 className="mdialog__title" id={titleId}>
          {title}
        </h2>
        {hint === undefined ? null : <p className="mdialog__hint">{hint}</p>}
        {children}
        {error === null || error === undefined ? null : (
          <p className="mdialog__error" role="alert" dir="auto">
            {error}
          </p>
        )}
        <form
          className={wide ? "mdialog__actions is-wide" : "mdialog__actions"}
          onSubmit={(event) => {
            event.preventDefault();
            if (canConfirm && !busy) onConfirm();
          }}
        >
          <button type="submit" className={danger ? "mbutton mbutton--danger" : "mbutton mbutton--primary"} disabled={!canConfirm || busy} aria-busy={busy}>
            {confirmLabel}
          </button>
          {single ? null : (
            <button type="button" className="mbutton" onClick={onClose}>
              {cancelLabel ?? translator.t("ui.thread.cancel")}
            </button>
          )}
        </form>
      </div>
    </div>
  );
  return body === undefined || body === null ? view : createPortal(view, body);
}

/** حقل نصّ بزرّ مسح داخله، كحقل العنوان في مانوس. Enter يؤكّد الحوار. */
export function ClearableInput({ id, value, onChange, placeholder, maxLength, onEnter }: { readonly id: string; readonly value: string; onChange(next: string): void; readonly placeholder?: string; readonly maxLength: number; onEnter?(): void }) {
  const translator = useTranslator();
  return (
    <div className="minput">
      <input
        id={id}
        className="minput__field"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        dir="auto"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onEnter?.();
          }
        }}
      />
      {value === "" ? null : (
        <button type="button" className="minput__clear" aria-label={translator.t("ui.thread.clear")} title={translator.t("ui.thread.clear")} onClick={() => onChange("")}>
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  );
}
