// إطار صفحات مانوس 2.0 (قِيس 2026-10-05 في التطبيق نفسه): صفّ رأس بارتفاع 46px فيه عنوان الصفحة صغيرًا (17px) في
// البداية وأفعالها في النهاية، ثم جسم الصفحة في عمود وسطه بعرض تحدّده الصفحة (الإنشاءات 1000px، الإضافات 768px).
// لا هوامش علوية كبيرة ولا عنوان ضخم: هكذا تبدو أجهزة الكمبيوتر والإنشاءات والأتمتة والإضافات في مانوس.

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useTranslator } from "../../app/context";
import { Icon } from "./Icon";

export function PageFrame({ title, actions, children, className = "", width = 1000 }: { readonly title: string; readonly actions?: ReactNode; readonly children: ReactNode; readonly className?: string; readonly width?: number }) {
  return (
    <div className={`mp ${className}`} style={{ ["--mp-width" as string]: `${width}px` }}>
      <header className="mp__bar">
        <h1 className="page-title mp__title">{title}</h1>
        {actions === undefined ? null : <div className="mp__actions">{actions}</div>}
      </header>
      <div className="mp__body">{children}</div>
    </div>
  );
}

/** حوار مانوس بلا أزرار سفلية (تفاصيل إضافة، مهامّ جهاز، إعداداته): يُغلق بـ Escape وبالنقر خارجه وبزرّ ×. */
export function Sheet({ label, children, onClose, className = "" }: { readonly label: string; readonly children: ReactNode; onClose(): void; readonly className?: string }) {
  const translator = useTranslator();
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.document?.addEventListener("keydown", onKey);
    box.current?.focus();
    return () => globalThis.document?.removeEventListener("keydown", onKey);
  }, [onClose]);
  const view = (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} className={`mp-sheet ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        <button type="button" className="icon-button mp-sheet__close" aria-label={translator.t("ui.close")} title={translator.t("ui.close")} onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
        {children}
      </div>
    </div>
  );
  const body = globalThis.document?.body;
  return body === undefined || body === null ? view : createPortal(view, body);
}
