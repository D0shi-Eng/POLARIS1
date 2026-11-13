// الشريط الجانبي: يعرض السجل، ولا يملكه.
//
// لا منطق توجيه هنا ولا قائمة وجهات مكتوبة بيد: الوجهات تأتي من `ROUTES` وحالتها من المضيف. الغلاف يرتّبها
// في مجموعات (الأدوات، المشاريع، المهامّ، «المزيد»، الإعدادات) ويستعمل `NavItem` لكل وجهة، فتبقى الوجهات
// العشر كلها بنودًا حقيقية بحالتها المقروءة.

import type { AvailabilityPresentation } from "../../app/availability";
import { explain } from "../../app/availability";
import { useNavigation, useTranslator } from "../../app/context";
import { ROUTES, type RouteId } from "../../routes/registry";
import { Icon, ROUTE_ICONS, type IconName } from "./Icon";

export interface NavItemProps {
  readonly routeId: RouteId;
  readonly availability: Readonly<Record<string, AvailabilityPresentation>>;
  readonly currentId: RouteId | undefined;
  /** تسمية بديلة تُعرض (مثل «كل المهامّ»)؛ التسمية المقروءة تبقى اسم الوجهة وحالتها. */
  readonly labelKey?: string;
  /** «head»: البند عنوانُ مجموعة في الشريط (المشاريع، المهامّ) يفتح صفحتها كاملة، كما في مانوس. */
  readonly variant?: "head";
  /** أيقونة بديلة حين تُعرض الوجهة باسم مانوس (أجهزة الكمبيوتر، الإضافات). */
  readonly icon?: IconName;
}

export function NavItem({ routeId, availability, currentId, labelKey, variant, icon }: NavItemProps) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const route = ROUTES.find((r) => r.id === routeId);
  if (route === undefined) return null;
  const presentation = availability[route.capabilityId];
  const isCurrent = route.id === currentId;
  const status = presentation === undefined ? "" : explain(translator, presentation);
  const shown = translator.t(labelKey ?? route.labelKey);
  return (
    <li>
      <button
        type="button"
        className={variant === "head" ? "nav__item nav__item--head" : "nav__item"}
        onClick={() => navigation.navigate(route.path)}
        {...(isCurrent ? { "aria-current": "page" as const } : {})}
        // الحالة تُقال لقارئ الشاشة نصًّا: النقطة الملوّنة وحدها ليست معلومة.
        aria-label={status === "" ? shown : `${shown} — ${status}`}
      >
        <Icon name={icon ?? ROUTE_ICONS[route.id] ?? "sparkle"} className="nav__icon" />
        <span className="nav__label">{shown}</span>
        {/* النقطة تظهر بصريًا فقط حين لا تكون الوجهة متاحة (CSS)؛ الحالة مقروءة نصًّا دائمًا */}
        <span className={`nav__dot nav__dot--${presentation?.tone ?? "MUTED"}`} aria-hidden="true" />
        {isCurrent ? <Icon name="check" size={15} className="nav__check" /> : null}
      </button>
    </li>
  );
}

export interface SidebarProps {
  readonly availability: Readonly<Record<string, AvailabilityPresentation>>;
  readonly currentId: RouteId | undefined;
}

/** كل الوجهات بترتيب السجل، في قائمة واحدة. للأغلفة التي لا تحتاج مجموعات. */
export function Sidebar({ availability, currentId }: SidebarProps) {
  const translator = useTranslator();
  return (
    <nav className="nav" aria-label={translator.t("nav.landmark")}>
      <ul className="nav__list">
        {ROUTES.map((route) => (
          <NavItem key={route.id} routeId={route.id} availability={availability} currentId={currentId} />
        ))}
      </ul>
    </nav>
  );
}
