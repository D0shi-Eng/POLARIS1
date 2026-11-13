// قطع مشتركة لصفحتي «المزوّدون» و«النماذج» في الإعدادات (ADR-037، على نمط OpenCode): شعار المزوّد، ومفتاح التشغيل،
// ونافذة فوق نافذة الإعدادات يغلقها Esc وحدها.
//
// لا شعارات تجارية: الشعار حرف من اسم المزوّد، والمزوّد المخصّص نجمة كما في OpenCode. الأسماء العلم تأتي من المضيف.

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useTranslator } from "../../../app/context";
import { Icon } from "../../../ui/components/Icon";

export function ProviderGlyph({ name, custom = false }: { readonly name: string; readonly custom?: boolean }) {
  if (custom) {
    return (
      <span className="oc-glyph oc-glyph--custom" aria-hidden="true">
        <Icon name="sparkle" size={14} />
      </span>
    );
  }
  const letter = name.replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase();
  return (
    <span className="oc-glyph" aria-hidden="true">
      {letter}
    </span>
  );
}

export function Toggle({ on, label, disabled = false, onChange }: { readonly on: boolean; readonly label: string; readonly disabled?: boolean; onChange(next: boolean): void }) {
  return (
    <button type="button" role="switch" className="oc-switch" aria-checked={on} aria-label={label} title={label} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="oc-switch__knob" aria-hidden="true" />
    </button>
  );
}

/**
 * نافذة فوق نافذة الإعدادات. Esc يغلقها هي وحدها: يُلتقط في مرحلة الالتقاط ويُعلَّم، فلا يغلق مستمع نافذة الإعدادات
 * (الذي يتجاهل حدثًا معلَّمًا) الإعدادات معها.
 */
export function Sheet({ labelledBy, onClose, onBack, children }: { readonly labelledBy: string; onClose(): void; onBack?: (() => void) | undefined; readonly children: ReactNode }) {
  const translator = useTranslator();
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (onBack !== undefined) onBack();
      else onClose();
    };
    globalThis.addEventListener?.("keydown", onKey, true);
    const first = box.current?.querySelector<HTMLElement>("input");
    (first ?? box.current)?.focus();
    return () => globalThis.removeEventListener?.("keydown", onKey, true);
  }, [onClose, onBack]);
  const view = (
    <div className="dialog-backdrop oc-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} className="oc-sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <div className="oc-sheet__bar">
          {onBack === undefined ? <span /> : (
            <button type="button" className="icon-button oc-sheet__back" aria-label={translator.t("ui.oc.back")} title={translator.t("ui.oc.back")} onClick={onBack}>
              <span aria-hidden="true">→</span>
            </button>
          )}
          <button type="button" className="icon-button oc-sheet__close" aria-label={translator.t("ui.close")} title={translator.t("ui.close")} onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
  const body = globalThis.document?.body;
  return body === undefined ? view : createPortal(view, body);
}
