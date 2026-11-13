// قائمة منبثقة واحدة لكل القوائم الصغيرة (كما في مانوس): زرّ يفتحها، وتُطوى باختيار بند، وبـ Escape،
// وبالنقر خارجها. لا منطق عمل هنا: البنود يمرّرها من يستعملها.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PopoverProps {
  /** محتوى الزرّ الذي يفتح القائمة. */
  readonly trigger: ReactNode;
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly triggerClassName?: string;
  /** اتجاه الفتح: فوق الزرّ (المُنشئ في أسفل الصفحة) أو تحته. */
  readonly placement?: "up" | "down";
  /** محاذاة القائمة إلى بداية الزرّ أو نهايته (منطقيًّا، تتبع اتجاه اللغة). */
  readonly align?: "start" | "end";
  readonly disabled?: boolean;
  /** يبقي القائمة مفتوحة بعد النقر على بند (قوائم فيها مفاتيح تبديل). */
  readonly keepOpen?: boolean;
  /**
   * قائمة ثابتة الموضع فوق الصفحة: تُحسب من موضع الزرّ عند الفتح، فلا يقصّها حاوٍ يُمرَّر (الشريط الجانبي).
   * تُفتح لأسفل ما اتّسع المكان، وإلا لأعلى.
   */
  readonly floating?: boolean;
  onOpenChange?(open: boolean): void;
}

export function Popover({ trigger, label, children, className = "", triggerClassName = "icon-button", placement = "down", align = "start", disabled = false, keepOpen = false, floating = false, onOpenChange }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [fixed, setFixed] = useState<CSSProperties | undefined>(undefined);
  const root = useRef<HTMLDivElement | null>(null);
  // القائمة الثابتة تُرسم في جذر المستند: أيّ سلف فيه `transform` أو `overflow` (صفّ الشريط، والشريط نفسه)
  // يجعل `position: fixed` نسبيًّا إليه فيقصّها. قِيس 2026-10-01 في النسخة المبنية: «⋯» فُتحت ولم تظهر قائمتها.
  const menu = useRef<HTMLDivElement | null>(null);
  const set = (next: boolean) => {
    if (next && floating) setFixed(fixedPosition(root.current, placement, align));
    setOpen(next);
    onOpenChange?.(next);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") set(false);
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (root.current !== null && !root.current.contains(target) && !(menu.current?.contains(target) ?? false)) set(false);
    };
    const target = globalThis.document;
    target?.addEventListener("keydown", onKey);
    target?.addEventListener("mousedown", onDown);
    return () => {
      target?.removeEventListener("keydown", onKey);
      target?.removeEventListener("mousedown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <div className={`popover ${className}`} ref={root}>
      <button type="button" className={triggerClassName} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => set(!open)}>
        {trigger}
      </button>
      {open ? (
        portal(
        <div
          ref={menu}
          className={fixed === undefined ? `popover__menu popover__menu--${placement} popover__menu--${align}` : "popover__menu is-floating"}
          style={fixed}
          role="menu"
          aria-label={label}
          onClick={(event) => {
            if (keepOpen) return;
            const target = event.target as HTMLElement;
            if (target.closest("button:not([data-keep-open])") !== null) set(false);
          }}
        >
          {children}
        </div>,
          fixed !== undefined,
        )
      ) : null}
    </div>
  );
}

/** القائمة الثابتة في جذر المستند؛ غيرها في مكانها تحت الزرّ. */
function portal(node: ReactNode, toBody: boolean): ReactNode {
  const body = globalThis.document?.body;
  return toBody && body !== undefined && body !== null ? createPortal(node, body) : node;
}

/** أعرض قائمة منبثقة متوقَّعة، لإبقائها داخل النافذة. */
const MENU_ROOM = 248;

/** موضع القائمة الثابتة من مستطيل الزرّ واتجاه الكتابة. */
function fixedPosition(anchor: HTMLElement | null, placement: "up" | "down", align: "start" | "end"): CSSProperties | undefined {
  const rect = anchor?.getBoundingClientRect?.();
  const view = globalThis.window;
  if (rect === undefined || view === undefined || (rect.width === 0 && rect.height === 0)) return undefined;
  const rtl = view.getComputedStyle?.(anchor as HTMLElement).direction === "rtl";
  const room = view.innerHeight - rect.bottom;
  const fitsBelow = room > 360 || room > rect.top;
  const crampedAbove = rect.top < 360 && room > rect.top;
  const down = placement === "down" ? fitsBelow : crampedAbove;
  const style: CSSProperties = { position: "fixed" };
  if (down) style.top = rect.bottom + 6;
  else style.bottom = view.innerHeight - rect.top + 6;
  // «البداية» حافة الزرّ في اتجاه بداية السطر، و«النهاية» الحافة الأخرى.
  const atRight = rtl ? align === "start" : align === "end";
  if (atRight) style.right = Math.max(8, view.innerWidth - rect.right);
  // قائمة تبدأ قرب الحافة لا تخرج من النافذة (أدوات رأس «المهام» في الشريط مثلًا): تُزاح إلى الداخل.
  else style.left = Math.max(8, Math.min(rect.left, view.innerWidth - MENU_ROOM));
  return style;
}

/** بند في قائمة منبثقة: أيقونة، ونصّ، ووصف سطر واحد اختياري، وطرف (✓ أو سهم أو اختصار). */
export function MenuItem({ icon, label, detail, trailing, onSelect, danger = false, disabled = false, keepOpen = false }: { readonly icon?: ReactNode; readonly label: string; readonly detail?: string | undefined; readonly trailing?: ReactNode; onSelect?(): void; readonly danger?: boolean; readonly disabled?: boolean; readonly keepOpen?: boolean }) {
  return (
    <button type="button" role="menuitem" className={danger ? "menu-item is-danger" : "menu-item"} disabled={disabled} onClick={onSelect} {...(keepOpen ? { "data-keep-open": "" } : {})}>
      {icon === undefined ? null : <span className="menu-item__icon">{icon}</span>}
      <span className="menu-item__text">
        <span className="menu-item__label" dir="auto">
          {label}
        </span>
        {detail === undefined ? null : (
          <span className="menu-item__detail" dir="auto">
            {detail}
          </span>
        )}
      </span>
      {trailing === undefined ? null : <span className="menu-item__trailing">{trailing}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-separator" role="separator" />;
}

export function MenuHeading({ children }: { readonly children: ReactNode }) {
  return <p className="menu-heading">{children}</p>;
}
