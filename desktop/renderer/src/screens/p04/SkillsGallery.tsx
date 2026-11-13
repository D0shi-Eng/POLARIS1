// المهارات كما في مانوس: عنوان «مهارات» وزرّا «مهاراتي» و«إنشاء»، وبحث، وألسنة الفئات، وشبكة ثلاثية من بطاقات بغلاف
// وعنوان ووصف ووسوم وزرّ إضافة.
//
// ما في البطاقة من المضيف: المهارة وهل هي مفعّلة. مهارات المكتبة (مكافئات مهارات Manus، 2026-11-13) تأخذ اسمها العربي
// ووصفها وفئتها وعنوان غلافها من `p04/skill-library.json`، وهو الملف نفسه الذي يحمّله المضيف في كتالوج المتخصّصين، فما
// يُعرض هو ما يعمل. الغلاف يُرسم من عنوانه ولونه (عمل أصلي؛ لا تُنسخ رسوم مانوس المحمية). لا عدّاد استعمال: المضيف لا
// يحصيه، فلا رقم يُخترع. «إضافة» تفعّل المهارة فيدخل منهجها التوجيه، و«إزالة» تعطّلها فتخرج منه.

import { useMemo, useState } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { Phase04Client } from "../../ipc/p04-client";
import library from "../../p04/skill-library.json";
import { Icon, type IconName } from "../../ui/components/Icon";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { SkillsScreen } from "./SkillsScreen";

const LIB_PREFIX = "polaris.skill.lib.";
const CATEGORIES = ["all", "programming", "data", "automation", "business", "design", "media", "content", "apps"] as const;
type Category = (typeof CATEGORIES)[number];

interface LibraryEntry {
  readonly slug: string;
  readonly name_ar: string;
  readonly name_en: string;
  readonly summary_ar: string;
  readonly summary_en: string;
  readonly category: string;
  readonly cover: string;
}
const LIBRARY = new Map<string, LibraryEntry>((library.specialists as readonly LibraryEntry[]).map((e) => [`${LIB_PREFIX}${e.slug}`, e]));

/** فئة المهارات المدمجة الأولى (غير المكتبة) بلغة فئات مانوس. */
const BUILTIN_CATEGORY: Readonly<Record<string, Category>> = {
  "polaris.skill.agentic-work": "automation",
  "polaris.skill.local-analysis": "data",
  "polaris.skill.evidence-gathering": "data",
  "polaris.skill.web-browse": "automation",
  "polaris.skill.web-transfer": "automation",
  "polaris.skill.desktop-operator": "automation",
  "polaris.skill.connector-operator": "apps",
  "polaris.skill.external-tooling": "programming",
  "polaris.skill.project-note": "content",
  "polaris.skill.memory-keeper": "content",
};

/** رمز الغلاف بحسب الفئة. */
const COVER_ICON: Readonly<Record<Category, IconName>> = {
  all: "sparkle",
  programming: "code",
  data: "data",
  automation: "automation",
  business: "report",
  design: "shapes",
  media: "slides",
  content: "edit",
  apps: "grid",
};

/** لون غلاف ثابت لكل مهارة من اسمها: البطاقة نفسها بالألوان نفسها في كل تشغيل. */
function hue(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function SkillsGallery({ client, embedded = false }: { readonly client: Phase04Client; readonly embedded?: boolean }) {
  const translator = useTranslator();
  const arabic = translator.locale === "ar";
  const action = useAction();
  const query = useHostQuery(() => client.listSkills(), [client, action.state]);
  const [tab, setTab] = useState<Category>("all");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const text = (id: string, field: "name" | "desc", fallback: string) => {
    const key = `ui.skill.${id}.${field}`;
    return translator.has(key) ? translator.t(key) : fallback;
  };
  const cards = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (query.value?.skills ?? [])
      .map((s) => {
        const lib = LIBRARY.get(s.skill_id);
        const name = lib !== undefined ? (arabic ? lib.name_ar : lib.name_en) : text(s.skill_id, "name", s.name);
        const desc = lib !== undefined ? (arabic ? lib.summary_ar : lib.summary_en) : text(s.skill_id, "desc", s.description);
        const category = (lib?.category ?? BUILTIN_CATEGORY[s.skill_id] ?? "automation") as Category;
        const cover = lib?.cover ?? s.name;
        return { s, name, desc, category, cover, english: lib?.name_en ?? s.name };
      })
      .filter((x) => (tab === "all" || x.category === tab) && (!mine || x.s.enabled) && (needle === "" || `${x.name} ${x.desc} ${x.english}`.toLocaleLowerCase().includes(needle)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.value, tab, mine, search, translator]);

  return (
    <div className="skills-page">
      <header className="skills-page__bar">
        {embedded ? <span /> : <h1 className="page-title">{translator.t("ui.skills.lib.title")}</h1>}
        <div className="skills-page__actions">
          <label className="library__search skills-page__search">
            <Icon name="search" size={15} />
            <span className="sr-only">{translator.t("ui.skills.search")}</span>
            <input type="search" value={search} dir="auto" placeholder={translator.t("ui.skills.search")} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <button type="button" className="mbutton" aria-pressed={mine} onClick={() => setMine((m) => !m)}>
            {translator.t("ui.skills.lib.my")}
          </button>
          <details className="skills-page__create">
            <summary className="mbutton">{translator.t("ui.skills.lib.create")}</summary>
            <div className="skills-page__create-body">
              <SkillsScreen client={client} embedded />
            </div>
          </details>
        </div>
      </header>
      <div className="library-tabs skills-tabs" role="group" aria-label={translator.t("ui.skills.categories")}>
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className="library-tab" aria-pressed={tab === c} onClick={() => setTab(c)}>
            {translator.t(`ui.skills.category.${c}`)}
          </button>
        ))}
      </div>
      <ActionNote state={action.state} />
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      {query.value !== null && cards.length === 0 ? <p className="muted">{translator.t("ui.skills.lib.empty")}</p> : null}
      <div className="skills-grid">
        {cards.map(({ s, name, desc, category, cover }) => {
          const h = hue(cover);
          return (
            <article key={s.skill_id} className={s.enabled ? "skill-card" : "skill-card is-off"}>
              <div className="skill-card__cover" aria-hidden="true">
                <span className="skill-card__poster" style={{ background: `linear-gradient(160deg, hsl(${h} 62% 78%), hsl(${(h + 40) % 360} 55% 52%))` }}>
                  <span className="skill-card__poster-title">{cover}</span>
                  <span className="skill-card__poster-mark" style={{ background: `hsl(${(h + 180) % 360} 55% 38%)` }}>
                    <Icon name={COVER_ICON[category]} size={28} />
                  </span>
                </span>
              </div>
              <h2 className="skill-card__name" dir="auto">
                {name}
              </h2>
              <p className="skill-card__desc" dir="auto">
                {desc}
              </p>
              <div className="skill-card__tags">
                <span className="skill-tag skill-tag--author">
                  <Icon name="sparkle" size={11} /> {translator.t("ui.skills.lib.builtin")}
                </span>
                <span className="skill-tag">{translator.t(`ui.skills.category.${category}`)}</span>
              </div>
              <footer className="skill-card__foot">
                <button
                  type="button"
                  className={s.enabled ? "skill-card__add is-on" : "skill-card__add"}
                  aria-pressed={s.enabled}
                  aria-label={`${translator.t(s.enabled ? "ui.skills.lib.remove" : "ui.skills.lib.add")} ${name}`}
                  title={translator.t(s.enabled ? "ui.skills.lib.added" : "ui.skills.lib.add")}
                  onClick={() => void action.run(() => client.configureSkill(s.skill_id, !s.enabled), () => ({ phase: "DONE", messageKey: "p04.action.saved" }), query.reload)}
                >
                  <Icon name={s.enabled ? "check" : "plus"} size={15} />
                </button>
                <span className="skill-card__state">{translator.t(s.enabled ? "ui.skills.lib.added" : "skills.disabled")}</span>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
