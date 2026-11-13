// تجميع أقسام الإعدادات.
//
// القسم يحمل مجموعته كبادئة في معرّفه (`general.appearance`)، والعقد جمّد شكل
// المعرّف وترك الفهرسة لهذه المرحلة. البادئة مُعلَنة من المضيف، فالتجميع قراءة
// لما قاله المضيف لا تخمينًا من الواجهة (P01-DEC-05).

import type { SettingSectionDescriptor } from "../generated/types/desktop-result-v1";

export const GROUP_ORDER = ["general", "ai", "agents", "data", "tools", "security", "advanced"] as const;

export type GroupId = (typeof GROUP_ORDER)[number];

/** القسم التعريفي «حول». ليس قسم إعدادات في العقد، ولا يدّعي أن يكون. */
export const ABOUT_ROUTE_ID = "about";

export function groupOf(sectionId: string): string {
  const [prefix] = sectionId.split(".");
  return prefix ?? sectionId;
}

export interface SettingsGroup {
  readonly id: string;
  readonly labelKey: string;
  readonly sections: readonly SettingSectionDescriptor[];
}

/** يجمع الأقسام في مجموعات بترتيب مُعلَن، ويضع أي بادئة غير معروفة في آخر القائمة. */
export function groupSections(sections: readonly SettingSectionDescriptor[]): readonly SettingsGroup[] {
  const byGroup = new Map<string, SettingSectionDescriptor[]>();
  for (const section of sections) {
    const id = groupOf(section.section_id);
    const bucket = byGroup.get(id);
    if (bucket === undefined) byGroup.set(id, [section]);
    else bucket.push(section);
  }

  const known = GROUP_ORDER.filter((id) => byGroup.has(id));
  const unknown = [...byGroup.keys()].filter((id) => !(GROUP_ORDER as readonly string[]).includes(id)).sort();

  return [...known, ...unknown].map((id) => ({
    id,
    labelKey: `settings.group.${id}`,
    sections: byGroup.get(id) ?? [],
  }));
}
