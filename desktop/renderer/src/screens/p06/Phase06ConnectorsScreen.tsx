// «الإضافات» كما في مانوس 2.0 (قِيس 2026-10-05 في التطبيق نفسه): صفّ الرأس بالعنوان في البداية، وفي النهاية «إدارة
// الموصلات» و«إنشاء ▾». الجسم عمود 768px: بطاقات مميّزة عريضة تمرّ أفقيًّا، ثم بحث بعرض العمود، ثم ألسنة الفئات، ثم
// شبكة بعمودين من بطاقات 75px (أيقونة، اسم، وصف بسطرين، و«✓» لما يعمل أو «+» لما يُضاف). النقر على بطاقة يفتح
// تفاصيلها في حوار وسطيّ (أيقونة، اسم، وصف، «جرّبه»، والتفاصيل). «إدارة الموصلات» تفتح «الموصلات المضافة» بأدواتها
// الكاملة (تسجيل، اختبار، اعتماد، استيراد، خوادم الأدوات)، و«إنشاء» يفتحها على النموذج المطلوب.
//
// ما في البطاقات من المضيف كما هو: المهارات المسجّلة، والموصلات التي سجّلها المستخدم، وخوادم الأدوات. لا بطاقة لخدمة
// بلا شيء حقيقي وراءها؛ «✓» لما هو مفعّل فعلًا، و«+» على مهارة معطّلة يفعّلها، وعلى موصل معطّل يفعّله.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { ConnectorCategory, ConnectorPresetV1, ConnectorViewV1 } from "../../generated/types/desktop-p06-result-v1";
import type { McpServerViewV1, SkillViewV1 } from "../../generated/types/desktop-p04-result-v1";
import type { Phase08Client } from "../../ipc/p08-client";
import type { Phase04Client } from "../../ipc/p04-client";
import type { Phase06Client } from "../../ipc/p06-client";
import { Icon, type IconName } from "../../ui/components/Icon";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { PageFrame, Sheet } from "../../ui/components/PageFrame";
import { MenuHeading, MenuItem, Popover } from "../../ui/components/Popover";
import { ConnectorsScreen } from "../p04/ConnectorsScreen";
import { seedHome } from "../p08/HomeWorkspace";
import { ConnectorsPanel } from "./ConnectorsPanel";
import catalogData from "../../p06/connector-catalog.json";

/** كتالوج الإضافات بترتيب Manus (جُرد 2026-11-13). ما له `preset_id` إعداد جاهز يعمل في المضيف (قراءة فقط)؛ والباقي
 *  بطاقة صادقة تقول إنه يحتاج إعدادًا يدويًا (موصل REST أو خادم MCP)، لا «متّصل» كاذبًا. الأيقونة رمز دلالي بلون ثابت:
 *  شعارات الخدمات علامات أصحابها ولا تُنسخ (TRADEMARK.md). */
interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly preset_id: string | null;
  readonly desc_ar: string;
  readonly color: string;
  readonly mark: string;
  /** أيقونة دلالية من مجموعة الواجهة (بريد، تقويم، شيفرة، بيانات…) على لون الإضافة الثابت. */
  readonly icon: IconName;
}
const CATALOG: readonly CatalogEntry[] = catalogData.connectors as readonly CatalogEntry[];
const LIBRARY_SKILL = "polaris.skill.lib.";

const CATEGORY_ICONS: Readonly<Record<ConnectorCategory, IconName>> = {
  EMAIL: "report",
  CALENDAR: "schedule",
  FILES: "projects",
  MESSAGING: "globe",
  PROJECT_MANAGEMENT: "list",
  CODE_HOSTING: "code",
  DATABASE: "database",
  CUSTOM_API: "connectors",
};

/** فئة كل مهارة مدمجة وأيقونتها، بفئات مانوس 2.0 (الإنتاجية، الإبداع، الأعمال، التطوير، المال، السفر، الصحة). المستوردة
 *  فئتها «أخرى». لا لسان لفئة بلا عنصر حقيقي فيها. */
const SKILLS: Readonly<Record<string, { readonly category: string; readonly icon: IconName }>> = {
  "polaris.skill.agentic-work": { category: "work", icon: "sparkle" },
  "polaris.skill.local-analysis": { category: "business", icon: "data" },
  "polaris.skill.evidence-gathering": { category: "work", icon: "research" },
  "polaris.skill.web-browse": { category: "work", icon: "globe" },
  "polaris.skill.web-transfer": { category: "development", icon: "upload" },
  "polaris.skill.desktop-operator": { category: "work", icon: "browser" },
  "polaris.skill.connector-operator": { category: "development", icon: "connectors" },
  "polaris.skill.external-tooling": { category: "development", icon: "code" },
  "polaris.skill.project-note": { category: "work", icon: "projects" },
  "polaris.skill.memory-keeper": { category: "work", icon: "memory" },
};

/** فئة الموصل بفئات مانوس: البريد والتقويم والملفات والمراسلة إنتاجية، وإدارة المشاريع أعمال، والبقية تطوير. */
const CONNECTOR_TABS: Readonly<Record<ConnectorCategory, string>> = {
  EMAIL: "work",
  CALENDAR: "work",
  FILES: "work",
  MESSAGING: "work",
  PROJECT_MANAGEMENT: "business",
  CODE_HOSTING: "development",
  DATABASE: "development",
  CUSTOM_API: "development",
};

/** CP-12-3: هل أُضيف هذا القالب من قبل؟ موصل من قالب مدمج بالعنوان نفسه (المضيف يرفض الثاني بتعارض، والواجهة لا تعرضه). */
export function presetAdded(preset: Pick<ConnectorPresetV1, "base_url"> & { readonly display_name?: string }, connectors: readonly ConnectorViewV1[]): boolean {
  // قوالب تشترك في العنوان (Google Calendar وDrive، وبريد Outlook وتقويمه) يُميّزها اسمها.
  return connectors.some(
    (c) => c.descriptor.provenance.origin === "BUILT_IN_PRESET" && c.rest?.base_url === preset.base_url && (preset.display_name === undefined || c.descriptor.display_name === preset.display_name),
  );
}

/** البطاقات المميّزة أعلى الصفحة: مهارات موجودة فعلًا تُعرض بجملة تقول ما تفعله. */
const FEATURED: readonly { readonly id: string; readonly icon: IconName }[] = [
  { id: "polaris.skill.desktop-operator", icon: "browser" },
  { id: "polaris.skill.web-browse", icon: "globe" },
  { id: "polaris.skill.connector-operator", icon: "connectors" },
];

const TABS = ["all", "work", "creativity", "business", "development", "finance", "travel", "health", "other"] as const;
type Tab = (typeof TABS)[number];

interface Item {
  readonly key: string;
  readonly kind: "skill" | "connector" | "server" | "catalog";
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly icon: IconName;
  readonly category: string;
  readonly on: boolean;
  readonly skill?: SkillViewV1;
  readonly connector?: ConnectorViewV1;
  readonly server?: McpServerViewV1;
  readonly entry?: CatalogEntry;
  readonly preset?: ConnectorPresetV1;
}

export function Phase06ConnectorsScreen({ client, phase04, phase08 }: { readonly client: Phase06Client; readonly phase04?: Phase04Client | undefined; readonly phase08?: Phase08Client | undefined }) {
  const translator = useTranslator();
  const t = (key: string, values?: Record<string, string | number>) => translator.t(key, values);
  const navigation = useNavigation();
  const action = useAction();
  const connectors = useHostQuery(() => client.listConnectors(), [client, action.state]);
  const skills = useHostQuery(() => (phase04 === undefined ? Promise.resolve({ ok: true as const, value: { skills: [] as SkillViewV1[] } }) : phase04.listSkills()), [phase04, action.state]);
  const servers = useHostQuery(() => (phase04 === undefined ? Promise.resolve({ ok: true as const, value: { servers: [] as McpServerViewV1[] } }) : phase04.listServers()), [phase04, action.state]);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [open, setOpen] = useState<Item | null>(null);
  const [manage, setManage] = useState<null | "rest" | "import" | "mcp" | "top">(null);
  const [presets, setPresets] = useState(false);
  const presetList = useHostQuery(() => client.listPresets(), [client]);

  const skillText = (s: SkillViewV1, field: "name" | "desc") => {
    const key = `ui.skill.${s.skill_id}.${field}`;
    return translator.has(key) ? translator.t(key) : field === "name" ? s.name : s.description;
  };

  const items = useMemo<readonly Item[]>(() => {
    const out: Item[] = [];
    const known = new Map((presetList.value?.presets ?? []).map((p) => [p.preset_id, p]));
    const registered = connectors.value?.connectors ?? [];
    for (const e of CATALOG) {
      const preset = e.preset_id === null ? undefined : known.get(e.preset_id);
      // قالب أُضيف فعلًا يظهر بطاقةَ موصله الحقيقية أدناه، لا بطاقتين.
      if (preset !== undefined && presetAdded(preset, registered)) continue;
      out.push({ key: `k:${e.id}`, kind: "catalog", id: e.preset_id ?? e.id, name: e.name, desc: e.desc_ar, icon: "connectors", category: e.category, on: false, entry: e, ...(preset === undefined ? {} : { preset }) });
    }
    for (const s of skills.value?.skills ?? []) {
      // مهارات المكتبة لها صفحة «المهارات»؛ «الإضافات» للخدمات كما في Manus.
      if (s.skill_id.startsWith(LIBRARY_SKILL)) continue;
      const known = SKILLS[s.skill_id];
      out.push({ key: `s:${s.skill_id}`, kind: "skill", id: s.skill_id, name: skillText(s, "name"), desc: skillText(s, "desc"), icon: known?.icon ?? "skills", category: known?.category ?? "other", on: s.enabled, skill: s });
    }
    for (const c of connectors.value?.connectors ?? []) {
      out.push({
        key: `c:${c.descriptor.connector_id}`,
        kind: "connector",
        id: c.descriptor.connector_id,
        name: c.descriptor.display_name,
        desc: `${t(`p06.category.${c.descriptor.category}`)} · ${t("ui.connectors.operations", { count: c.operation_count })}`,
        icon: CATEGORY_ICONS[c.descriptor.category] ?? "connectors",
        category: CONNECTOR_TABS[c.descriptor.category] ?? "development",
        on: c.descriptor.enabled,
        connector: c,
      });
    }
    for (const m of servers.value?.servers ?? []) {
      out.push({ key: `m:${m.server_id}`, kind: "server", id: m.server_id, name: m.name, desc: m.endpoint, icon: "code", category: "development", on: m.state === "ENABLED", server: m });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills.value, connectors.value, servers.value, presetList.value, translator]);

  const needle = search.trim().toLocaleLowerCase();
  const shown = items.filter((i) => (tab === "all" || i.category === tab) && (needle === "" || `${i.name} ${i.desc} ${i.id}`.toLocaleLowerCase().includes(needle)));
  const present = new Set(items.map((i) => i.category));
  const tabs = TABS.filter((x) => x === "all" || present.has(x));

  /** «+»: يفعّل ما هو معطّل. ما لا يُفعَّل من هنا (خادم أدوات) يفتح تفاصيله. */
  function add(item: Item): void {
    if (item.kind === "catalog") {
      if (item.preset !== undefined) {
        const preset = item.preset;
        void action.run(() => client.registerPreset(preset.preset_id, item.name), () => ({ phase: "DONE", messageKey: "ui.addons.preset.added" }), presetList.reload);
      } else {
        setOpen(item);
      }
      return;
    }
    if (item.kind === "skill" && phase04 !== undefined) {
      void action.run(() => phase04.configureSkill(item.id, true), () => ({ phase: "DONE", messageKey: "p04.action.saved" }));
    } else if (item.kind === "connector") {
      void action.run(() => client.configureConnector({ connector_id: item.id, enabled: true }), () => ({ phase: "DONE", messageKey: "conn.enabled" }));
    } else {
      setOpen(item);
    }
  }

  function setOn(item: Item, on: boolean): void {
    if (item.kind === "catalog") {
      if (item.preset !== undefined) add(item);
      else {
        setOpen(null);
        setManage("rest");
      }
      return;
    }
    if (item.kind === "skill" && phase04 !== undefined) void action.run(() => phase04.configureSkill(item.id, on), () => ({ phase: "DONE", messageKey: "p04.action.saved" }));
    if (item.kind === "connector") void action.run(() => client.configureConnector({ connector_id: item.id, enabled: on }), () => ({ phase: "DONE", messageKey: on ? "conn.enabled" : "conn.disabled" }));
  }

  const actions = (
    <>
      <button type="button" className="mp-btn addons-manage" onClick={() => setManage("top")}>
        {t("ui.connectors.manage")}
      </button>
      <Popover
        label={t("ui.addons.create")}
        trigger={
          <>
            {t("ui.addons.create")}
            <Icon name="chevron" size={12} className="mp-btn__chev" />
          </>
        }
        triggerClassName="mp-btn"
        align="end"
      >
        <MenuHeading>{t("ui.addons.create.heading")}</MenuHeading>
        <MenuItem icon={<Icon name="sparkle" size={16} />} label={t("ui.addons.create.preset")} onSelect={() => setPresets(true)} />
        <MenuItem icon={<Icon name="connectors" size={16} />} label={t("ui.addons.create.rest")} onSelect={() => setManage("rest")} />
        <MenuItem icon={<Icon name="upload" size={16} />} label={t("ui.addons.create.import")} onSelect={() => setManage("import")} />
        {phase04 === undefined ? null : <MenuItem icon={<Icon name="code" size={16} />} label={t("ui.addons.create.mcp")} onSelect={() => setManage("mcp")} />}
      </Popover>
    </>
  );

  if (manage !== null) return <ManageView client={client} phase04={phase04} phase08={phase08} focus={manage} onBack={() => setManage(null)} />;

  return (
    <PageFrame title={t("ui.rail.addons")} actions={actions} width={768} className="mp--addons">
      <FeatureRail label={t("ui.addons.featured")} backLabel={t("ui.addons.featured.back")} moreLabel={t("ui.addons.featured.more")}>
        {FEATURED.map((f) => {
          const item = items.find((i) => i.kind === "skill" && i.id === f.id);
          return (
            <button key={f.id} type="button" role="listitem" className="mp-feature__card" disabled={item === undefined} onClick={() => item !== undefined && setOpen(item)}>
              <span className="mp-addon__icon">
                <Icon name={f.icon} size={18} />
              </span>
              <span className="mp-feature__text">{t(`ui.addons.featured.${f.id}`)}</span>
            </button>
          );
        })}
      </FeatureRail>
      <label className="mp-search mp-search--wide mp-addons__search">
        <Icon name="search" size={16} />
        <span className="sr-only">{t("ui.connectors.search")}</span>
        <input type="search" value={search} dir={search === "" ? undefined : "auto"} placeholder={t("ui.addons.search")} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <div className="mp-tabs mp-addons__tabs" role="group" aria-label={t("ui.addons.tabs")}>
        {tabs.map((x) => (
          <button key={x} type="button" className="mp-tab" aria-pressed={tab === x} onClick={() => setTab(x)}>
            {t(`ui.addons.cat.${x}`)}
          </button>
        ))}
      </div>
      <ActionNote state={action.state} />
      {connectors.error !== null ? <ErrorNote error={connectors.error} onRetry={connectors.reload} /> : null}
      {skills.error !== null ? <ErrorNote error={skills.error} onRetry={skills.reload} /> : null}
      {shown.length === 0 && !connectors.loading && !skills.loading ? <p className="mp-addons__empty">{t(needle === "" ? "ui.connectors.none_yet" : "ui.palette.empty")}</p> : null}
      <ul className="mp-addons">
        {shown.map((item) => (
          <li key={item.key} className="mp-addon" data-kind={item.kind} data-connector-id={item.kind === "connector" ? item.id : undefined}>
            <button type="button" className="mp-addon__open" onClick={() => setOpen(item)}>
              {item.entry !== undefined ? (
                <span className="mp-addon__icon mp-addon__icon--brand" aria-hidden="true" style={{ background: item.entry.color }}>
                  <Icon name={item.entry.icon} size={18} />
                </span>
              ) : (
                <span className="mp-addon__icon" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                </span>
              )}
              <span className="mp-addon__text">
                <span className="mp-addon__name" dir="auto">
                  {item.name}
                </span>
                <span className="mp-addon__desc" dir="auto">
                  {item.desc}
                </span>
              </span>
            </button>
            {item.on ? (
              <span className="mp-addon__state" title={t("ui.addons.on")}>
                <Icon name="check" size={15} />
                <span className="sr-only">{t("ui.addons.on")}</span>
              </span>
            ) : (
              <button type="button" className="mp-addon__add" aria-label={`${t("ui.addons.add")} ${item.name}`} title={t("ui.addons.add")} onClick={() => add(item)}>
                <Icon name="plus" size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {open === null ? null : (
        <AddonSheet
          item={items.find((i) => i.key === open.key) ?? open}
          onClose={() => setOpen(null)}
          onTry={(text) => {
            seedHome(text);
            navigation.navigate("/");
          }}
          onSet={(item, on) => setOn(item, on)}
          onManage={() => {
            setOpen(null);
            setManage("top");
          }}
        />
      )}
      {presets ? (
        <PresetSheet
          client={client}
          connectors={connectors.value?.connectors ?? []}
          onClose={() => setPresets(false)}
          onAdd={(preset) => void action.run(() => client.registerPreset(preset.preset_id), () => ({ phase: "DONE", messageKey: "ui.addons.preset.added" }), () => setPresets(false))}
        />
      ) : null}
    </PageFrame>
  );
}

/** تفاصيل إضافة كما في مانوس: أيقونة ووصف و«جرّبه»، ثم «التفاصيل» شبكة حقول. */
// شريط البطاقات المميّزة كما في مانوس (قِيس 2026-10-05): ما لا يتّسع يُقصّ عند حافة العمود ويتلاشى، وعند مرور الفأرة
// يظهر سهم دائريّ صغير في الجهة التي فيها بطاقات مخفية فقط. الضغط عليه يمرّر الشريط، فينتقل السهم والتلاشي إلى الجهة
// الأخرى. في العربية scrollLeft صفر عند البداية وسالب نحو النهاية، فالمسافة المقطوعة قيمته المطلقة.
function FeatureRail({ label, backLabel, moreLabel, children }: { readonly label: string; readonly backLabel: string; readonly moreLabel: string; readonly children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ back: false, more: false });

  useEffect(() => {
    const el = track.current;
    if (el === null) return undefined;
    const measure = () => {
      const gone = Math.abs(el.scrollLeft);
      const left = el.scrollWidth - el.clientWidth - gone;
      setEdges((was) => (was.back === gone > 1 && was.more === left > 1 ? was : { back: gone > 1, more: left > 1 }));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    sizes?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      sizes?.disconnect();
    };
  }, []);

  const step = (toEnd: boolean) => {
    const el = track.current;
    if (el === null) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: (toEnd === rtl ? -1 : 1) * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="mp-feature" data-back={edges.back} data-more={edges.more}>
      <div ref={track} className="mp-feature__track" role="list" aria-label={label}>
        {children}
      </div>
      {edges.back ? (
        <button type="button" className="mp-feature__nav mp-feature__nav--back" aria-label={backLabel} onClick={() => step(false)}>
          <Icon name="chevron" size={14} />
        </button>
      ) : null}
      {edges.more ? (
        <button type="button" className="mp-feature__nav mp-feature__nav--more" aria-label={moreLabel} onClick={() => step(true)}>
          <Icon name="chevron" size={14} />
        </button>
      ) : null}
    </div>
  );
}

function AddonSheet({ item, onClose, onTry, onSet, onManage }: { readonly item: Item; onClose(): void; onTry(text: string): void; onSet(item: Item, on: boolean): void; onManage(): void }) {
  const translator = useTranslator();
  const t = (key: string, values?: Record<string, string | number>) => translator.t(key, values);
  const facts: { readonly label: string; readonly value: string }[] = [
    { label: t("ui.addons.fact.category"), value: t(`ui.addons.cat.${item.category}`) },
    { label: t("ui.addons.fact.kind"), value: t(`ui.addons.kind.${item.kind}`) },
  ];
  if (item.skill !== undefined) {
    facts.push({ label: t("ui.addons.fact.source"), value: t(`ui.skills.source.${item.skill.source}`) });
    facts.push({ label: t("ui.addons.fact.tools"), value: t("skills.tools.count", { count: item.skill.allowed_tools.length }) });
    facts.push({ label: t("ui.addons.fact.version"), value: item.skill.version });
  }
  if (item.connector !== undefined) {
    facts.push({ label: t("ui.addons.fact.health"), value: t(`p06.health.${item.connector.health.state}`) });
    facts.push({ label: t("ui.addons.fact.version"), value: item.connector.descriptor.version });
  }
  if (item.server !== undefined) facts.push({ label: t("ui.addons.fact.state"), value: item.server.state });
  if (item.kind === "catalog") {
    facts.push({ label: t("ui.addons.fact.state"), value: t(item.preset !== undefined ? "ui.addons.catalog.ready" : "ui.addons.catalog.manual") });
    if (item.preset !== undefined) {
      facts.push({ label: t("ui.addons.preset.operations"), value: item.preset.operations.map((o) => o.title).join(" · ") });
      facts.push({ label: t("ui.addons.preset.setup"), value: item.preset.setup_hint });
    }
  }
  facts.push({ label: t("ui.addons.fact.id"), value: item.id });
  // PHASE-12: ما يحقّ للإضافة أن تفعله، كما يعرفه المضيف: أدوات المهارة وخطرها، وآثار الخادم ونقله، ومصادقة الموصل.
  const permissions: { readonly label: string; readonly value: string }[] = [];
  if (item.skill !== undefined) {
    permissions.push({ label: t("ui.addons.perm.risk"), value: t(`p04.risk.${item.skill.risk_class}`) });
    permissions.push({ label: t("ui.addons.perm.tools"), value: item.skill.allowed_tools.length === 0 ? t("ui.addons.perm.none") : item.skill.allowed_tools.join(" · ") });
  }
  if (item.server !== undefined) {
    permissions.push({ label: t("ui.addons.perm.transport"), value: t(`p04.transport.${item.server.transport}`) });
    permissions.push({ label: t("ui.addons.perm.effects"), value: item.server.granted_effects.length === 0 ? t("ui.addons.perm.none") : item.server.granted_effects.map((e) => t(`p04.effect.${e}`)).join(" · ") });
    if (item.server.transport === "REMOTE_HTTPS") permissions.push({ label: t("ui.addons.perm.approval"), value: t("ui.addons.perm.every_call") });
  }
  if (item.connector !== undefined) {
    permissions.push({ label: t("ui.addons.perm.auth"), value: t(`p06.auth_mode.${item.connector.auth.mode}`) });
    permissions.push({ label: t("ui.addons.perm.key"), value: t(item.connector.auth.required ? (item.connector.auth.configured ? "ui.addons.perm.key_set" : "ui.addons.perm.key_missing") : "ui.addons.perm.key_none") });
  }
  const tryText = t("ui.addons.try_prompt", { name: item.name });
  // أمثلة مانوس «أمثلة على التلميحات»: طلبات جاهزة للمهارات المدمجة، كلّ واحد يملأ المُنشئ ولا يُرسل وحده.
  const examples = item.kind === "skill" ? [1, 2, 3, 4].map((n) => `ui.addons.example.${item.id}.${n}`).filter((key) => translator.has(key)).map((key) => translator.t(key)) : [];
  return (
    <Sheet label={item.name} onClose={onClose} className="mp-addon-sheet">
      <span className={item.entry !== undefined ? "mp-addon-sheet__icon mp-addon__icon--brand" : "mp-addon-sheet__icon"} aria-hidden="true" style={item.entry !== undefined ? { background: item.entry.color } : undefined}>
        <Icon name={item.entry?.icon ?? item.icon} size={24} />
      </span>
      <h2 className="mp-addon-sheet__name" dir="auto">
        {item.name}
      </h2>
      <p className="mp-addon-sheet__desc" dir="auto">
        {item.desc}
      </p>
      <div className="mp-addon-sheet__actions">
        {item.kind === "server" || item.kind === "catalog" ? null : (
          <button type="button" className="mp-btn mp-btn--light" disabled={!item.on} onClick={() => onTry(`${tryText} `)}>
            <Icon name="chat" size={14} />
            {t("ui.addons.try")}
          </button>
        )}
        {item.kind === "server" ? (
          <button type="button" className="mp-btn" onClick={onManage}>
            {t("ui.connectors.manage")}
          </button>
        ) : (
          <button type="button" className="mp-btn" onClick={() => onSet(item, !item.on)}>
            {item.kind === "catalog" ? t(item.preset !== undefined ? "ui.addons.preset.add" : "ui.addons.catalog.setup") : t(item.on ? "skills.action.disable" : "skills.action.enable")}
          </button>
        )}
      </div>
      {examples.length === 0 ? null : (
        <>
          <h3 className="mp-addon-sheet__head">{t("ui.addons.examples")}</h3>
          <div className="mp-addon-sheet__examples">
            {examples.map((text) => (
              <button key={text} type="button" className="mp-addon-sheet__example" disabled={!item.on} onClick={() => onTry(text)}>
                <Icon name="chat" size={15} />
                <span dir="auto">{text}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {permissions.length === 0 ? null : (
        <>
          <h3 className="mp-addon-sheet__head">{t("ui.addons.permissions")}</h3>
          <dl className="mp-addon-sheet__facts" aria-label={t("ui.addons.permissions")}>
            {permissions.map((f) => (
              <div key={f.label} className="mp-addon-sheet__fact">
                <dt>{f.label}</dt>
                <dd dir="auto">{f.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <h3 className="mp-addon-sheet__head">{t("ui.addons.details")}</h3>
      <dl className="mp-addon-sheet__facts">
        {facts.map((f) => (
          <div key={f.label} className="mp-addon-sheet__fact">
            <dt>{f.label}</dt>
            <dd dir="auto">{f.value}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}

/** PHASE-12: قوالب الموصلات المدمجة (PHASE-05: Slack وNotion للقراءة) كما يعيدها المضيف. «أضف» يسجّل الموصل بعنوان الخدمة
 *  الرسمي وعملياته الموثّقة، بلا اعتماد: المفتاح يُضاف بعدها من «إدارة الموصلات»، والحالة تقول ذلك ولا تدّعي اتصالًا. */
function PresetSheet({ client, connectors, onClose, onAdd }: { readonly client: Phase06Client; readonly connectors: readonly ConnectorViewV1[]; onClose(): void; onAdd(preset: ConnectorPresetV1): void }) {
  const translator = useTranslator();
  const t = (key: string, values?: Record<string, string | number>) => translator.t(key, values);
  const list = useHostQuery(() => client.listPresets(), [client]);
  const presets = list.value?.presets ?? [];
  return (
    <Sheet label={t("ui.addons.preset.title")} onClose={onClose} className="mp-addon-sheet">
      <span className="mp-addon-sheet__icon" aria-hidden="true">
        <Icon name="connectors" size={24} />
      </span>
      <h2 className="mp-addon-sheet__name">{t("ui.addons.preset.title")}</h2>
      <p className="mp-addon-sheet__desc">{t("ui.addons.preset.intro")}</p>
      {list.error !== null ? <ErrorNote error={list.error} onRetry={list.reload} /> : null}
      {!list.loading && list.error === null && presets.length === 0 ? <p className="mp-addon-sheet__desc">{t("ui.addons.preset.none")}</p> : null}
      {presets.map((p) => (
        <section key={p.preset_id} className="mp-addon-sheet__preset" aria-label={p.display_name} data-preset-id={p.preset_id}>
          <h3 className="mp-addon-sheet__head" dir="auto">
            {p.display_name}
          </h3>
          <dl className="mp-addon-sheet__facts">
            <div className="mp-addon-sheet__fact">
              <dt>{t("ui.addons.fact.category")}</dt>
              <dd>{t(`p06.category.${p.category}`)}</dd>
            </div>
            <div className="mp-addon-sheet__fact">
              <dt>{t("ui.addons.perm.auth")}</dt>
              <dd>{t(`p06.auth_mode.${p.auth_mode}`)}</dd>
            </div>
            <div className="mp-addon-sheet__fact">
              <dt>{t("ui.addons.preset.operations")}</dt>
              <dd dir="auto">{p.operations.map((o) => `${o.title} (${t(`p06.action.${o.action}`)})`).join(" · ")}</dd>
            </div>
            <div className="mp-addon-sheet__fact">
              <dt>{t("ui.addons.preset.setup")}</dt>
              <dd dir="auto">{p.setup_hint}</dd>
            </div>
          </dl>
          <div className="mp-addon-sheet__actions">
            {presetAdded(p, connectors) ? (
              <button type="button" className="mp-btn" disabled>
                {t("ui.addons.preset.already")}
              </button>
            ) : (
              <button type="button" className="mp-btn" aria-label={`${t("ui.addons.preset.add")} ${p.display_name}`} onClick={() => onAdd(p)}>
                {t("ui.addons.preset.add")}
              </button>
            )}
          </div>
        </section>
      ))}
    </Sheet>
  );
}

/** «الموصلات المضافة»: الإدارة الكاملة كما كانت (موصلات الخدمات ثم خوادم الأدوات)، بعنوان ورجوع كصفحة مانوس. */
function ManageView({ client, phase04, phase08, focus, onBack }: { readonly client: Phase06Client; readonly phase04?: Phase04Client | undefined; readonly phase08?: Phase08Client | undefined; readonly focus: "rest" | "import" | "mcp" | "top"; onBack(): void }) {
  const translator = useTranslator();
  const ref = (node: HTMLDivElement | null) => {
    if (node === null || focus === "top") return;
    // يُفتح النموذج المطلوب ويُمرَّر إليه بعد الرسم.
    setTimeout(() => {
      const target =
        focus === "mcp"
          ? node.querySelector<HTMLElement>("#mcp-register")
          : node.querySelector<HTMLDetailsElement>(focus === "rest" ? 'details[aria-labelledby="conn-register-title"]' : 'details[aria-labelledby="conn-import-title"]');
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ block: "start" });
    }, 0);
  };
  return (
    <PageFrame
      title={translator.t("nav.connectors")}
      width={1000}
      className="mp--manage"
      actions={
        <button type="button" className="mp-btn" onClick={onBack}>
          <Icon name="chevron" size={12} className="mp-btn__back" />
          {translator.t("ui.rail.addons")}
        </button>
      }
    >
      <div ref={ref} className="connectors-page__manage">
        <ConnectorsPanel client={client} />
        {phase04 === undefined ? null : <ConnectorsScreen client={phase04} {...(phase08 !== undefined ? { phase08 } : {})} embedded />}
      </div>
    </PageFrame>
  );
}
