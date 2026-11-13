// الوكلاء المتخصّصون في العارض: كتالوج يُقرأ مرّة من المضيف، ووكيل اختاره المستخدم للمهمّة التالية.
//
// الاختيار تفضيل عرض محفوظ في هذا المتصفّح فقط (مثل النموذج المختار)؛ المضيف يحفظه للمهمّة نفسها حين
// تُنشأ (`mission.specialist.set`)، ومن ثمّ يصل إلى زمن التشغيل.

import { useEffect, useState } from "react";

import type { AgentCatalogResultV1 } from "../generated/types/desktop-p08-result-v1";
import type { Phase08Client } from "../ipc/p08-client";

export type Specialist = AgentCatalogResultV1["specialists"][number];
export type SpecialistDomain = AgentCatalogResultV1["domains"][number];

const NEXT_KEY = "polaris.specialist.next";
/** نسخة في الذاكرة: الاختيار يبقى لهذه الجلسة حين يكون تخزين المتصفّح محجوبًا أو غائبًا. */
let inMemory = "";

export function readStoredSpecialist(): string {
  try {
    return globalThis.localStorage?.getItem(NEXT_KEY) ?? inMemory;
  } catch {
    return inMemory;
  }
}

export function storeSpecialist(id: string): void {
  inMemory = id;
  try {
    if (id === "") globalThis.localStorage?.removeItem(NEXT_KEY);
    else globalThis.localStorage?.setItem(NEXT_KEY, id);
  } catch {
    // تخزين المتصفّح غير متاح: تكفي النسخة في الذاكرة لهذه الجلسة.
  }
}

/** الكتالوج ثابت طوال عمر البناء: يُطلب مرّة ويُشارك بين الشاشات. */
let cached: Promise<AgentCatalogResultV1 | null> | null = null;

export function useAgentCatalog(phase08: Phase08Client | undefined): AgentCatalogResultV1 | null {
  const [catalog, setCatalog] = useState<AgentCatalogResultV1 | null>(null);
  useEffect(() => {
    if (phase08 === undefined) return;
    let alive = true;
    if (cached === null) {
      cached = phase08.agentCatalog().then((r) => (r.ok ? r.value : null));
      // فشل الطلب لا يُحفظ: محاولة لاحقة تطلبه من جديد.
      void cached.then((value) => {
        if (value === null) cached = null;
      });
    }
    void cached.then((value) => {
      if (alive) setCatalog(value);
    });
    return () => {
      alive = false;
    };
  }, [phase08]);
  return catalog;
}

/** الاسم بلغة الواجهة. */
export function specialistName(s: { readonly name_ar: string; readonly name_en: string }, locale: string): string {
  return locale === "ar" ? s.name_ar : s.name_en;
}

export function specialistSummary(s: Specialist, locale: string): string {
  return locale === "ar" ? s.summary_ar : s.summary_en;
}
