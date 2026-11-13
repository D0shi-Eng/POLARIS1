// «الأتمتة» كما في مانوس 2.0 (قِيس 2026-10-05 في التطبيق نفسه): أول مرّة «أنشئ أتمتتك الأولى» بثلاث بطاقات (جدول
// المهام، مشغّل، الأتمتة المتقدّمة) وزرّ «ابدأ الآن» الأبيض. «ابدأ الآن» يفتح صفحة «أتمتة عملك»: مُنشئ في الوسط، وتحته
// «اختر كيفية بدئه» ثم «الاقتراحات». ما ليس في POLARIS (المشغّلات والأتمتة المتقدّمة) يُعرض كما في مانوس لكن «غير متاح بعد».
//
// مكافأة 2026-10-23 (قِيس في Manus 2.0.7 على الشاشة، وأُكّد من كتالوج ترجمته المشحون بأداة REA، بلا نسخ شيفرة):
// - اختيار «جدول المهام» يحوّل المُنشئ إلى بطاقة «عندما»: [التكرار ▾] في [اليوم] عند [الوقت]، ثم «سيقوم POLARIS بـ» والطلب.
//   التكرار: يوميًا، أسبوعيًا، شهريًا، لا تكرار (وPOLARIS يزيد «كل N دقيقة»).
// - «إعدادات الأتمتة» قائمة: التأكيدات، التشغيل في (مهمّة منفصلة أو نفس المهمّة)، المشروع، تاريخ الانتهاء، المنطقة الزمنية.
//   مانوس يعرض «لا حاجة للموافقة»؛ POLARIS لا يتخطّى موافقة، فخياره الثاني «ألغِ التشغيل وسجّل السبب».
// - صفحة الأتمتة: الجدول بجملته («يتكرر أسبوعيًا في … الساعة …»)، و«تشغيل الآن»، و«إيقاف مؤقت» بتأكيد، و«تاريخ التشغيل»
//   بمرشّحات الكل والناجحة والفاشلة، و«اسأل عن السبب» لتشغيل فشل.
//
// الجدول لا يمنح إذنًا: سياسة الموافقة تقول ماذا يحدث حين تحتاج المهمّة موافقة — تنتظرك، أو
// تُلغى ويُسجَّل السبب. المنطقة الزمنية إزاحة ثابتة عن UTC (حدّ مُعلن).

import { NumberField } from "../../ui/components/NumberField";
import { useEffect, useState, type ReactNode } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { ScheduleRunV1, ScheduleV1 } from "../../generated/types/desktop-p08-result-v1";
import type { ScheduleSpecV1 } from "../../generated/types/desktop-p08-request-v1";
import type { Phase08Client } from "../../ipc/p08-client";
import type { Phase02Client } from "../../ipc/p02-client";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { missionPath } from "../../routes/registry";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { Icon, type IconName } from "../../ui/components/Icon";
import { ModelPicker } from "../../ui/components/ModelPicker";
import { PageFrame } from "../../ui/components/PageFrame";
import { Dialog } from "../../ui/components/Dialog";
import { MenuItem, Popover } from "../../ui/components/Popover";
import { onceInstant, onceParts } from "../../p08/schedule-time";
import { seedHome } from "./HomeWorkspace";

type Kind = "ONCE" | "INTERVAL" | "DAILY" | "WEEKLY" | "MONTHLY";
type RunTarget = "SEPARATE_TASK" | "SAME_TASK";
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
/** ترتيب التكرار كما في قائمة مانوس، ثم ما يزيده POLARIS. */
const KIND_ORDER: readonly Kind[] = ["DAILY", "WEEKLY", "MONTHLY", "ONCE", "INTERVAL"];
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

interface Draft {
  readonly id?: string;
  readonly name: string;
  readonly title: string;
  readonly objective: string;
  readonly kind: Kind;
  /** «مرة واحدة»: تاريخ ووقت حائطيّان في إزاحة الجدول (D-MP-14)، يُحوَّلان إلى لحظة UTC عند الحفظ. */
  readonly date: string;
  readonly onceTime: string;
  readonly minutes: number;
  readonly time: string;
  readonly days: readonly string[];
  readonly monthDays: readonly number[];
  readonly timezone: string;
  readonly policy: "WAIT_FOR_APPROVAL" | "FAIL_ON_APPROVAL";
  readonly runTarget: RunTarget;
  /** تاريخ الانتهاء (يوم في إزاحة الجدول، آخر دقيقة فيه)، أو "" بلا انتهاء. */
  readonly endDate: string;
  /** المشروع الذي تُنشأ فيه المهمّة ("" = بلا مشروع)، والنموذج المحفوظ في القالب: يبقيان عند التعديل. */
  readonly project: string;
  readonly model: string | null;
  /** اختير «جدول المهام» في «اختر كيفية بدئه» (التعديل يبدأ مختارًا). */
  readonly chosen: boolean;
}

/** مشروع تُفتح عليه مسوّدة جدول جديدة عند الوصول من صفحة المشروع («+ إضافة» في بطاقة المهام المجدولة). */
let pendingProject: string | null = null;

export function newScheduleIn(projectId: string): void {
  pendingProject = projectId;
}

/** فاصل إعادة قراءة الجداول والصفحة مفتوحة: نبضة المجدول نفسها (30 ثانية). */
let refreshMs = 30_000;

/** للاختبار فقط: فاصل إعادة القراءة. */
export function scheduleRefreshForTest(ms: number): void {
  refreshMs = ms;
}

function localOffset(): string {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

const EMPTY: Draft = { name: "", title: "", objective: "", kind: "DAILY", date: "", onceTime: "09:00", minutes: 60, time: "08:00", days: ["SUN"], monthDays: [1], timezone: localOffset(), policy: "WAIT_FOR_APPROVAL", runTarget: "SEPARATE_TASK", endDate: "", project: "", model: null, chosen: false };

/** نهاية يوم الانتهاء (23:59 في إزاحة الجدول) لحظةَ UTC، أو لا شيء. */
function endInstant(d: Pick<Draft, "endDate" | "timezone">): string | null {
  return d.endDate === "" ? null : onceInstant(d.endDate, "23:59", d.timezone);
}

function toDraft(s: ScheduleV1): Draft {
  const spec = s.schedule as { kind: Kind; at?: string; minutes?: number; time?: string; days?: (string | number)[] };
  const once = spec.at === undefined ? { date: "", time: "09:00" } : onceParts(spec.at, s.timezone);
  return {
    id: s.schedule_id,
    name: s.name,
    title: s.mission_template.title,
    objective: s.mission_template.objective,
    kind: spec.kind,
    date: once.date,
    onceTime: once.time,
    minutes: spec.minutes ?? 60,
    time: spec.time ?? "08:00",
    days: spec.kind === "WEEKLY" ? (spec.days as string[]) : ["SUN"],
    monthDays: spec.kind === "MONTHLY" ? (spec.days as number[]) : [1],
    timezone: s.timezone,
    policy: s.approval_policy,
    runTarget: s.run_target,
    endDate: s.end_at === null || s.end_at === undefined ? "" : onceParts(s.end_at, s.timezone).date,
    project: s.mission_template.project_id ?? "",
    model: s.mission_template.model_id ?? null,
    chosen: true,
  };
}

function specOf(d: Draft): ScheduleSpecV1 {
  switch (d.kind) {
    case "ONCE":
      return { kind: "ONCE", at: onceInstant(d.date, d.onceTime, d.timezone) ?? "" };
    case "INTERVAL":
      return { kind: "INTERVAL", minutes: d.minutes };
    case "WEEKLY":
      return { kind: "WEEKLY", days: [...d.days] as ("MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN")[], time: d.time } as ScheduleSpecV1;
    case "MONTHLY":
      return { kind: "MONTHLY", days: [...d.monthDays].sort((a, b) => a - b), time: d.time } as ScheduleSpecV1;
    default:
      return { kind: "DAILY", time: d.time };
  }
}

/** اقتراحات «أتمتة عملك»: كلّ واحد يملأ المُنشئ ويختار «جدول المهام» بتوقيته؛ لا شيء يُحفظ قبل «إنشاء». */
const SUGGESTIONS: readonly { readonly key: string; readonly title: string; readonly when: string; readonly patch: Partial<Draft> }[] = [
  { key: "ui.schedule.template.digest", title: "ui.automation.sug.digest", when: "ui.automation.sug.digest_when", patch: { kind: "DAILY", time: "08:00" } },
  { key: "ui.schedule.template.watch", title: "ui.automation.sug.watch", when: "ui.automation.sug.watch_when", patch: { kind: "WEEKLY", days: ["MON"], time: "09:00" } },
  { key: "ui.schedule.template.cleanup", title: "ui.automation.sug.cleanup", when: "ui.automation.sug.cleanup_when", patch: { kind: "WEEKLY", days: ["FRI"], time: "17:00" } },
];

type T = (key: string, values?: Record<string, string | number>) => string;

/** اسم الجدول من أول سطر في الطلب، كما يسمّي مانوس الأتمتة من وصفها. */
function nameOf(objective: string): string {
  const line = objective.trim().split(/\r?\n/)[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

/** الوقت والتاريخ معزولان LTR (LRI…PDI): في سطر RTL كان «2026-10-21 09:30» يُعرض «09:30 2026-10-21» (قِيس أصليًّا). */
const ltr = (text: string) => `⁦${text}⁩`;

/** الجدول بجملة، كما يكتبه مانوس: «يتكرر أسبوعيًا في {days} الساعة {time}». */
function summaryOf(t: T, locale: string, spec: { kind: string; at?: string; minutes?: number; time?: string; days?: (string | number)[] }, zone: string): string {
  const list = (items: readonly string[]) => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
  switch (spec.kind) {
    case "ONCE":
      return spec.at === undefined ? t("ui.automation.freq.ONCE") : t("ui.automation.sum.ONCE", { at: ltr(`${onceParts(spec.at, zone).date} ${onceParts(spec.at, zone).time}`) });
    case "INTERVAL":
      return t("ui.automation.every_minutes", { n: spec.minutes ?? 0 });
    case "WEEKLY":
      return t("ui.automation.sum.WEEKLY", { days: list((spec.days ?? []).map((d) => t(`p08.day.${String(d)}`))), time: ltr(spec.time ?? "") });
    case "MONTHLY":
      return t("ui.automation.sum.MONTHLY", { dates: list((spec.days ?? []).map((d) => String(d))), time: ltr(spec.time ?? "") });
    default:
      return t("ui.automation.sum.DAILY", { time: ltr(spec.time ?? "") });
  }
}

/** ما يُحسب نجاحًا وفشلًا في «تاريخ التشغيل». التخطّي والانتظار ليسا هذا ولا ذاك. */
const SUCCEEDED = new Set(["COMPLETED"]);
const FAILED = new Set(["FAILED", "BLOCKED", "CANCELLED", "LAUNCHER_UNAVAILABLE", "CREATE_FAILED", "START_FAILED", "FAILED_APPROVAL_REQUIRED"]);

type KindId = "schedule" | "trigger" | "advanced";

const KINDS: readonly { readonly id: KindId; readonly icon: IconName }[] = [
  { id: "schedule", icon: "schedule" },
  { id: "trigger", icon: "automation" },
  { id: "advanced", icon: "sparkle" },
];

/** رسوم بطاقات «أنشئ أتمتتك الأولى»: بطاقتان صغيرتان بينهما سهم، من رسمنا لا صورة من مانوس. */
function FirstRunArt({ kind }: { readonly kind: KindId }) {
  const translator = useTranslator();
  const t: T = (key, values) => translator.t(key, values);
  const today = new Date();
  const week = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  const month = new Intl.DateTimeFormat(translator.locale, { month: "long" }).format(today);
  const weekday = (d: Date) => new Intl.DateTimeFormat(translator.locale, { weekday: "long" }).format(d);
  return (
    <div className="mp-auto-art" aria-hidden="true">
      <div className="mp-auto-art__card">
        {kind === "schedule" ? (
          <>
            <span className="mp-auto-art__month">{month}</span>
            <span className="mp-auto-art__week">
              {week.map((d, i) => (
                <span key={i} className="mp-auto-art__day">
                  <span className="mp-auto-art__dname">{weekday(d)}</span>
                  <span className={i === 0 ? "mp-auto-art__dnum is-today" : "mp-auto-art__dnum"}>{d.getDate()}</span>
                  <span className="mp-auto-art__dot" />
                </span>
              ))}
            </span>
          </>
        ) : kind === "trigger" ? (
          <>
            <Icon name="folder" size={15} className="mp-auto-art__brand" />
            <strong className="mp-auto-art__line">
              {t("ui.automation.art.trigger_event")} <span className="mp-auto-art__red">•</span>
            </strong>
            <span className="mp-auto-art__chip">
              <Icon name="file" size={12} /> report-q3.pdf
            </span>
          </>
        ) : (
          <>
            <span className="mp-auto-art__tag">
              <Icon name="sparkle" size={11} /> {t("ui.automation.art.condition")}
            </span>
            <strong className="mp-auto-art__line">{t("ui.automation.art.advanced_rule")}</strong>
          </>
        )}
      </div>
      <span className="mp-auto-art__arrow">⌄</span>
      <div className="mp-auto-art__card">
        <span className="mp-auto-art__logo">
          <Icon name="sparkle" size={15} />
        </span>
        {kind === "advanced" ? (
          <span className="mp-auto-art__flow">
            <span className="mp-auto-art__pill is-gold">{t("ui.automation.art.flow_watch")}</span>
            <span className="mp-auto-art__pill is-gold">{t("ui.automation.art.flow_detect")}</span>
            <span className="mp-auto-art__pill is-green">{t("ui.automation.art.flow_update")}</span>
            <span className="mp-auto-art__pill">{t("ui.automation.art.flow_compare")}</span>
          </span>
        ) : (
          <>
            <span className="mp-auto-art__text">
              <strong>{t(kind === "schedule" ? "ui.automation.art.schedule_done" : "ui.automation.art.trigger_done")}</strong>{" "}
              {t(kind === "schedule" ? "ui.automation.art.schedule_body" : "ui.automation.art.trigger_body")}
            </span>
            <span className="mp-auto-art__chip">
              <Icon name="report" size={12} />
              {kind === "schedule" ? "weekly-report.md" : t("ui.automation.art.trigger_file")}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

interface ProjectOption {
  readonly project_id: string;
  readonly name: string;
  readonly status: string;
}

type Section = "approvals" | "target" | "project" | "end" | "zone";

/** بند في «إعدادات الأتمتة»: الاسم وقيمته الحالية، ويفتح خياراته في القائمة نفسها. */
function SettingRow({ icon, label, value, onOpen }: { readonly icon: IconName; readonly label: string; readonly value: string; onOpen(): void }) {
  return (
    <button type="button" className="menu-item mp-auto-menu__row" data-keep-open="" onClick={onOpen}>
      <span className="menu-item__icon">
        <Icon name={icon} size={16} />
      </span>
      <span className="menu-item__text">
        <span className="menu-item__label">{label}</span>
      </span>
      <span className="mp-auto-menu__value" dir="auto">
        {value}
      </span>
      <Icon name="chevron" size={14} className="mp-auto-menu__chev" />
    </button>
  );
}

/** خيار في قائمة فرعية بعلامة ✓ للمختار. */
function Choice({ label, detail, selected, onSelect }: { readonly label: string; readonly detail?: string; readonly selected: boolean; onSelect(): void }) {
  return <MenuItem label={label} detail={detail} trailing={selected ? <Icon name="check" size={14} /> : undefined} onSelect={onSelect} keepOpen />;
}

/** «إعدادات الأتمتة»: قائمة كما في مانوس، كل بند يفتح خياراته في القائمة نفسها. */
function AutomationSettings({ draft, set, phase02, projects }: { readonly draft: Draft; set(patch: Partial<Draft>): void; readonly phase02?: Phase02Client | undefined; readonly projects: readonly ProjectOption[] }) {
  const translator = useTranslator();
  const t: T = (key, values) => translator.t(key, values);
  const [section, setSection] = useState<Section | null>(null);
  const projectName = draft.project === "" ? t("ui.schedule.no_project") : (projects.find((p) => p.project_id === draft.project)?.name ?? t("ui.schedule.project"));
  const title = (s: Section) => t(`ui.automation.set.${s}`);
  return (
    <Popover label={t("ui.automation.settings")} trigger={<Icon name="sliders" size={16} />} triggerClassName="icon-button mp-compose__set" keepOpen align="start" className="mp-auto-set" onOpenChange={(open) => (open ? null : setSection(null))}>
      <div className="mp-auto-set__panel">
        {section === null ? (
          <>
            <SettingRow icon="shield" label={title("approvals")} value={t(`ui.automation.policy.${draft.policy}`)} onOpen={() => setSection("approvals")} />
            <SettingRow icon="list" label={title("target")} value={t(`ui.automation.target.${draft.runTarget}`)} onOpen={() => setSection("target")} />
            {phase02 === undefined ? null : <SettingRow icon="folder" label={title("project")} value={projectName} onOpen={() => setSection("project")} />}
            <SettingRow icon="schedule" label={title("end")} value={draft.endDate === "" ? t("ui.automation.end.none") : ltr(draft.endDate)} onOpen={() => setSection("end")} />
            <SettingRow icon="globe" label={title("zone")} value={ltr(draft.timezone)} onOpen={() => setSection("zone")} />
          </>
        ) : (
          <>
            <button type="button" className="mp-auto-menu__back" data-keep-open="" onClick={() => setSection(null)}>
              <Icon name="chevron" size={14} className="mp-auto-menu__chev is-back" />
              {title(section)}
            </button>
            {section === "approvals" ? (
              <>
                {(["WAIT_FOR_APPROVAL", "FAIL_ON_APPROVAL"] as const).map((p) => (
                  <Choice key={p} label={t(`ui.automation.policy.${p}`)} detail={t(`ui.automation.policy.${p}_detail`)} selected={draft.policy === p} onSelect={() => set({ policy: p })} />
                ))}
                <p className="mp-auto-set__note">{t("ui.automation.policy.note")}</p>
              </>
            ) : null}
            {section === "target"
              ? (["SEPARATE_TASK", "SAME_TASK"] as const).map((r) => <Choice key={r} label={t(`ui.automation.target.${r}`)} detail={t(`ui.automation.target.${r}_detail`)} selected={draft.runTarget === r} onSelect={() => set({ runTarget: r })} />)
              : null}
            {section === "project" ? (
              <>
                <Choice label={t("ui.schedule.no_project")} selected={draft.project === ""} onSelect={() => set({ project: "" })} />
                {projects
                  .filter((p) => p.status === "ACTIVE" || p.project_id === draft.project)
                  .map((p) => (
                    <Choice key={p.project_id} label={p.name} selected={draft.project === p.project_id} onSelect={() => set({ project: p.project_id })} />
                  ))}
              </>
            ) : null}
            {section === "end" ? (
              <>
                <Choice label={t("ui.automation.end.none")} selected={draft.endDate === ""} onSelect={() => set({ endDate: "" })} />
                <label className="mp-auto-menu__field">
                  <span>{t("ui.automation.end.on")}</span>
                  <input id="sch-end" type="date" dir="ltr" value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} />
                </label>
                <p className="mp-auto-set__note">{t("ui.automation.end.note")}</p>
              </>
            ) : null}
            {section === "zone" ? (
              <>
                <label className="mp-auto-menu__field">
                  <span>{t("p08.schedule.timezone")}</span>
                  <input id="sch-tz" aria-label={t("p08.schedule.timezone")} dir="ltr" pattern="^UTC([+-](0[0-9]|1[0-4]):[0-5][0-9])?$" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} />
                </label>
                <p className="mp-auto-set__note">{t("p08.schedule.note")}</p>
              </>
            ) : null}
          </>
        )}
        <p className="mp-auto-set__note">{t("p08.schedule.note_app_open")}</p>
      </div>
    </Popover>
  );
}

/** «عندما»: [التكرار ▾] في [اليوم] عند [الوقت]، كما في مانوس. */
function WhenRow({ draft, set }: { readonly draft: Draft; set(patch: Partial<Draft>): void }) {
  const translator = useTranslator();
  const t: T = (key, values) => translator.t(key, values);
  return (
    <div className="mp-auto-when__row">
      <Icon name="schedule" size={16} className="mp-auto-when__icon" />
      <select id="sch-kind" aria-label={t("p08.schedule.kind")} value={draft.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
        {KIND_ORDER.map((k) => (
          <option key={k} value={k}>
            {t(`ui.automation.freq.${k}`)}
          </option>
        ))}
      </select>
      {draft.kind === "WEEKLY" ? (
        <>
          <span className="mp-auto-when__word">{t("ui.automation.on")}</span>
          <span className="mp-auto-set__days" role="group" aria-label={t("p08.schedule.days")}>
            {DAYS.map((day) => (
              <button key={day} type="button" className="mp-auto-set__day" aria-pressed={draft.days.includes(day)} onClick={() => set({ days: draft.days.includes(day) ? draft.days.filter((x) => x !== day) : [...draft.days, day] })}>
                {t(`p08.day.${day}`)}
              </button>
            ))}
          </span>
        </>
      ) : null}
      {draft.kind === "MONTHLY" ? (
        <>
          <span className="mp-auto-when__word">{t("ui.automation.on_day")}</span>
          <Popover label={t("ui.automation.month_days")} trigger={<span className="mp-auto-when__pick">{draft.monthDays.length === 0 ? t("ui.automation.pick_days") : new Intl.ListFormat(translator.locale, { style: "narrow", type: "unit" }).format([...draft.monthDays].sort((a, b) => a - b).map(String))}</span>} triggerClassName="mp-auto-when__picker" keepOpen align="start">
            <div className="mp-auto-when__month" role="group" aria-label={t("ui.automation.month_days")}>
              {MONTH_DAYS.map((d) => (
                <button key={d} type="button" className="mp-auto-set__day" data-keep-open="" aria-pressed={draft.monthDays.includes(d)} onClick={() => set({ monthDays: draft.monthDays.includes(d) ? draft.monthDays.filter((x) => x !== d) : [...draft.monthDays, d] })}>
                  {d}
                </button>
              ))}
            </div>
            <p className="mp-auto-set__note">{t("ui.automation.month_note")}</p>
          </Popover>
        </>
      ) : null}
      {draft.kind === "ONCE" ? (
        <>
          <span className="mp-auto-when__word">{t("ui.automation.on")}</span>
          <input id="sch-date" type="date" required dir="ltr" aria-label={t("p08.schedule.date")} value={draft.date} onChange={(e) => set({ date: e.target.value })} />
          <span className="mp-auto-when__word">{t("ui.automation.at")}</span>
          <input id="sch-once-time" type="time" required dir="ltr" aria-label={t("p08.schedule.time")} value={draft.onceTime} onChange={(e) => set({ onceTime: e.target.value })} />
        </>
      ) : null}
      {draft.kind === "INTERVAL" ? <NumberField id="sch-minutes" min={15} max={525600} value={draft.minutes} onChange={(v) => set({ minutes: Number(v) })} /> : null}
      {draft.kind === "DAILY" || draft.kind === "WEEKLY" || draft.kind === "MONTHLY" ? (
        <>
          <span className="mp-auto-when__word">{t("ui.automation.at")}</span>
          <input id="sch-time" type="time" required dir="ltr" aria-label={t("p08.schedule.time")} value={draft.time} onChange={(e) => set({ time: e.target.value })} />
        </>
      ) : null}
    </div>
  );
}

/** «أتمتة عملك»: المُنشئ، ثم «اختر كيفية بدئه» حتى يُختار نوع، ثم «الاقتراحات». */
function AutomationCompose({ draft, set, onSave, onCancel, busy, phase02, projects, note }: { readonly draft: Draft; set(patch: Partial<Draft>): void; onSave(): void; onCancel(): void; readonly busy: boolean; readonly phase02?: Phase02Client | undefined; readonly projects: readonly ProjectOption[]; readonly note: ReactNode }) {
  const translator = useTranslator();
  const t: T = (key, values) => translator.t(key, values);
  const endOk = draft.endDate === "" || endInstant(draft) !== null;
  const ready =
    draft.chosen &&
    draft.objective.trim() !== "" &&
    endOk &&
    (draft.kind !== "ONCE" || onceInstant(draft.date, draft.onceTime, draft.timezone) !== null) &&
    (draft.kind !== "WEEKLY" || draft.days.length > 0) &&
    (draft.kind !== "MONTHLY" || draft.monthDays.length > 0);
  const objective = (
    <>
      <label htmlFor="sch-objective" className={draft.chosen ? "mp-auto-when__do" : "sr-only"}>
        {draft.chosen ? t("ui.automation.will_do") : t("p08.schedule.objective")}
      </label>
      <textarea id="sch-objective" className="mp-compose__input" required rows={draft.chosen ? 3 : 2} maxLength={8_000} dir={draft.objective === "" ? undefined : "auto"} value={draft.objective} placeholder={t(draft.chosen ? "ui.automation.will_do_placeholder" : "ui.automation.placeholder")} onChange={(e) => set({ objective: e.target.value })} />
    </>
  );
  return (
    <div className="mp mp-auto-create">
      <div className="topbar">
        <ModelPicker phase02={phase02} value={draft.model ?? ""} onChange={(id) => set({ model: id === "" ? null : id })} nativeId="sch-model" />
        <span className="topbar__spacer" />
        <button type="button" className="mp-btn mp-btn--ghost" onClick={onCancel}>
          {t("p08.schedule.cancel")}
        </button>
      </div>
      <div className="mp-auto-create__stage">
        <h1 className="mp-auto-create__title">{t("ui.automation.create_title")}</h1>
        {note}
        <form
          className={draft.chosen ? "mp-compose mp-auto-when" : "mp-compose"}
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) onSave();
          }}
        >
          {draft.chosen ? (
            <>
              <div className="mp-auto-when__head">
                <span className="mp-auto-when__title">{t("ui.automation.when_title")}</span>
                {draft.id === undefined ? (
                  <button type="button" className="icon-button" aria-label={t("ui.automation.change_kind")} title={t("ui.automation.change_kind")} onClick={() => set({ chosen: false })}>
                    <Icon name="close" size={14} />
                  </button>
                ) : null}
              </div>
              <WhenRow draft={draft} set={set} />
            </>
          ) : null}
          {objective}
          {endOk ? null : <p className="mp-auto-set__note">{t("ui.automation.end.invalid")}</p>}
          <div className="mp-compose__bar">
            <span className="mp-compose__chip">
              <Icon name="automation" size={14} />
              {t("ui.automation.chip")}
            </span>
            {draft.chosen ? <AutomationSettings draft={draft} set={set} phase02={phase02} projects={projects} /> : null}
            <span className="mp-compose__spacer" />
            <button type="submit" className="mp-compose__create" disabled={!ready || busy} aria-busy={busy}>
              {t(draft.id === undefined ? "ui.automation.create" : "p08.schedule.save")}
            </button>
          </div>
        </form>

        {draft.chosen ? null : (
          <section className="mp-auto-how" aria-labelledby="mp-auto-how">
            <h2 id="mp-auto-how" className="mp-auto-how__title">
              {t("ui.automation.how")}
            </h2>
            <div className="mp-auto-how__grid">
              {KINDS.map((k) => (
                <button key={k.id} type="button" className="mp-auto-how__opt" disabled={k.id !== "schedule"} onClick={() => set({ chosen: true })}>
                  <Icon name={k.icon} size={16} className="mp-auto-how__icon" />
                  <span className="mp-auto-how__name">
                    {t(`ui.automation.kind.${k.id}`)}
                    {k.id === "schedule" ? null : <span className="mp-badge">{t("ui.automation.unavailable")}</span>}
                  </span>
                  <span className="mp-auto-how__sub">{t(`ui.automation.kind.${k.id}_sub`)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {draft.chosen || draft.id !== undefined ? null : (
          <section className="mp-auto-sug" aria-labelledby="mp-auto-sug">
            <h2 id="mp-auto-sug" className="mp-auto-sug__title">
              {t("ui.automation.suggestions")}
            </h2>
            <div className="mp-auto-sug__grid">
              {SUGGESTIONS.map((sug) => (
                <button key={sug.key} type="button" className="mp-auto-sug__card" onClick={() => set({ ...sug.patch, objective: t(sug.key), chosen: true })}>
                  <span className="mp-auto-sug__art" aria-hidden="true">
                    <span className="mp-auto-sug__step">
                      <Icon name="schedule" size={12} />
                      {t(sug.when)}
                    </span>
                    <span className="mp-auto-art__arrow">⌄</span>
                    <span className="mp-auto-sug__step">
                      <Icon name="sparkle" size={12} />
                      {t(sug.key)}
                    </span>
                  </span>
                  <span className="mp-auto-sug__name">{t(sug.title)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

type RunFilter = "all" | "ok" | "failed";

export function SchedulesScreen({ client, phase02 }: { readonly client: Phase08Client; readonly phase02?: Phase02Client | undefined }) {
  const translator = useTranslator();
  const t: T = (key, values) => translator.t(key, values);
  const navigation = useNavigation();
  const locale = translator.locale as LocaleCode;
  const action = useAction();
  const list = useHostQuery(() => client.listSchedules(), [client, action.state]);
  // «شغّل الآن» يبدأ المهمّة ويعود، والتشغيل يُسجَّل حين ينتهي. قِيس 2026-10-19 في النسخة التنفيذية أن الصفحة بقيت بلا سطر التشغيل حتى
  // يُعاد فتحها. بعد «شغّل الآن» تُعاد القراءة كل 4 ثوانٍ حتى يظهر تشغيل أحدث لهذا الجدول، ولعشر دقائق في الأكثر.
  const [watching, setWatching] = useState<{ readonly id: string; readonly runs: number; readonly until: number } | null>(null);
  const reloadList = list.reload;
  useEffect(() => {
    if (watching === null) return;
    const current = (list.value?.schedules ?? []).find((s) => s.schedule_id === watching.id);
    if ((current?.recent_runs ?? []).length > watching.runs || Date.now() > watching.until) {
      setWatching(null);
      return;
    }
    const timer = setTimeout(reloadList, 4_000);
    return () => clearTimeout(timer);
  }, [watching, list.value, reloadList]);
  // CP-14-6: ما تطلقه النبضة (موعد، إعادة محاولة، متأخّر) يُسجَّل والصفحة مفتوحة؛ فتُعاد القراءة كل نبضة ما دام جدول مفعّلًا.
  const anyEnabled = (list.value?.schedules ?? []).some((s) => s.enabled);
  useEffect(() => {
    if (!anyEnabled) return;
    const timer = setInterval(reloadList, refreshMs);
    return () => clearInterval(timer);
  }, [anyEnabled, reloadList]);
  function runNow(id: string, runs: number): void {
    setWatching({ id, runs, until: Date.now() + 10 * 60_000 });
    void action.run(() => client.runScheduleNow(id), () => ({ phase: "DONE", messageKey: "ui.automation.test_started" }));
  }
  /** حالة التشغيل بلغة الواجهة: حالة المهمّة إن بدأت، وإلا ما قرّره المجدول (تخطٍّ، فشل إطلاق…) بتسميته؛ الرمز نفسه إن لم يُعرف. */
  const runState = (status: string) => (translator.has(`p03.mission_state.${status}`) ? t(`p03.mission_state.${status}`) : translator.has(`p08.schedule.status.${status}`) ? t(`p08.schedule.status.${status}`) : status);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunFilter>("all");
  // D-MP-16: الحذف يسأل أولًا بحوار الحذف نفسه الذي تستعمله المهامّ، ولا يُرسل شيئًا قبل التأكيد.
  const [removing, setRemoving] = useState<ScheduleV1 | null>(null);
  // مانوس: «إيقاف هذا الجدول مؤقتاً؟» قبل الإيقاف؛ الاستئناف بلا سؤال.
  const [pausing, setPausing] = useState<ScheduleV1 | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d === null ? d : { ...d, ...patch }));
  const projects = useHostQuery(() => (phase02 === undefined ? Promise.resolve({ ok: true as const, value: { projects: [] } }) : phase02.listProjects()), [phase02]);
  useEffect(() => {
    if (pendingProject === null) return;
    setDraft({ ...EMPTY, project: pendingProject });
    pendingProject = null;
  }, []);

  function save(d: Draft): void {
    const name = d.name.trim() === "" ? nameOf(d.objective) : d.name.trim();
    const end = endInstant(d);
    void action.run(
      () =>
        client.saveSchedule({
          ...(d.id !== undefined ? { schedule_id: d.id } : {}),
          name,
          // قِيس 2026-10-01: التعديل كان يُسقط مشروع القالب ونموذجه. يُرسلان كما هما الآن.
          mission_template: {
            title: d.title.trim() === "" ? name : d.title.trim(),
            objective: d.objective.trim(),
            ...(d.project === "" ? {} : { project_id: d.project }),
            ...(d.model === null ? {} : { model_id: d.model }),
          },
          timezone: d.timezone,
          schedule: specOf(d),
          enabled: true,
          budget: {},
          approval_policy: d.policy,
          run_target: d.runTarget,
          ...(end === null ? {} : { end_at: end }),
        }),
      () => ({ phase: "DONE", messageKey: "p08.schedule.saved" }),
      () => setDraft(null),
    );
  }

  function setEnabled(s: ScheduleV1, enabled: boolean): void {
    void action.run(() => client.enableSchedule(s.schedule_id, enabled), () => ({ phase: "DONE", messageKey: enabled ? "ui.automation.resumed" : "ui.automation.paused" }));
  }

  /** «اسأل عن السبب»: طلب في مُنشئ الرئيسية بتفاصيل التشغيل الفاشل؛ لا شيء يُرسل وحده. */
  function askWhy(s: ScheduleV1, r: ScheduleRunV1): void {
    seedHome(t("ui.automation.ask_why_prompt", { name: s.name, at: formatInstant(locale, r.triggered_at), status: runState(r.status), detail: r.detail === "" ? "—" : r.detail, mission: r.mission_id ?? "—" }));
    navigation.navigate("/");
  }

  if (draft !== null) {
    return <AutomationCompose draft={draft} set={set} onSave={() => save(draft)} onCancel={() => setDraft(null)} busy={action.state.phase === "RUNNING"} phase02={phase02} projects={projects.value?.projects ?? []} note={<ActionNote state={action.state} />} />;
  }

  const schedules = list.value?.schedules ?? [];
  const empty = schedules.length === 0 && !list.loading && list.error === null;
  const open = openId === null ? undefined : schedules.find((s) => s.schedule_id === openId);
  const nextText = (s: ScheduleV1) => (s.next_run === null || s.next_run === undefined ? t(s.enabled ? "p08.schedule.no_next" : "ui.automation.paused_state") : t("p08.schedule.next", { at: formatInstant(locale, s.next_run) }));
  const menu = (s: ScheduleV1) => (
    <Popover label={t("ui.library.actions")} trigger={<Icon name="more" size={16} />} triggerClassName="icon-button" floating align="end">
      <MenuItem icon={<Icon name="edit" size={16} />} label={t("p08.schedule.edit")} onSelect={() => setDraft(toDraft(s))} />
      <MenuItem icon={<Icon name="trash" size={16} />} label={t("p08.schedule.delete")} danger onSelect={() => setRemoving(s)} />
    </Popover>
  );
  const runRow = (s: ScheduleV1, r: ScheduleRunV1) => (
    <li key={r.run_id} className="mp-sched__run" title={r.detail === "" ? undefined : r.detail}>
      <span className="mp-sched__run-at">{formatInstant(locale, r.triggered_at)}</span>
      <span>{t(`p08.schedule.trigger.${r.trigger_kind}`)}</span>
      <span className={FAILED.has(r.status) ? "badge is-failed" : SUCCEEDED.has(r.status) ? "badge is-ok" : "badge"}>{runState(r.status)}</span>
      {r.mission_id === null || r.mission_id === undefined ? null : (
        <button type="button" className="link-button" onClick={() => navigation.navigate(missionPath(r.mission_id as string))}>
          {t("p08.schedule.open_mission")}
        </button>
      )}
      {FAILED.has(r.status) ? (
        <button type="button" className="link-button" onClick={() => askWhy(s, r)}>
          {t("ui.automation.ask_why")}
        </button>
      ) : null}
    </li>
  );
  const dialogs = (
    <>
      {removing === null ? null : (
        <Dialog
          title={t("ui.schedule.delete_title")}
          // الاسم معزول (FSI…PDI): اسم لاتيني داخل الجملة العربية كان يقلب موضع نقطته (قِيس أصليًّا).
          hint={t("ui.schedule.delete_body", { name: `⁨${removing.name}⁩` })}
          confirmLabel={t("p08.schedule.delete")}
          danger
          className="mdialog--small"
          onConfirm={() => {
            const id = removing.schedule_id;
            setRemoving(null);
            if (openId === id) setOpenId(null);
            void action.run(() => client.deleteSchedule(id), () => ({ phase: "DONE", messageKey: "p08.schedule.deleted" }));
          }}
          onClose={() => setRemoving(null)}
        />
      )}
      {pausing === null ? null : (
        <Dialog
          title={t("ui.automation.pause_title")}
          hint={t("ui.automation.pause_body", { name: `⁨${pausing.name}⁩` })}
          confirmLabel={t("ui.automation.pause")}
          className="mdialog--small"
          onConfirm={() => {
            const s = pausing;
            setPausing(null);
            setEnabled(s, false);
          }}
          onClose={() => setPausing(null)}
        />
      )}
    </>
  );

  if (open !== undefined) {
    const runs = open.recent_runs ?? [];
    const shown = runs.filter((r) => filter === "all" || (filter === "ok" ? SUCCEEDED.has(r.status) : FAILED.has(r.status)));
    const endPassed = open.end_at !== null && open.end_at !== undefined && Date.parse(open.end_at) <= Date.now();
    const fact = (label: string, value: string) => (
      <div className="mp-auto-detail__fact">
        <dt>{label}</dt>
        <dd dir="auto">{value}</dd>
      </div>
    );
    const projectName = open.mission_template.project_id === null || open.mission_template.project_id === undefined ? t("ui.schedule.no_project") : (projects.value?.projects.find((p) => p.project_id === open.mission_template.project_id)?.name ?? t("ui.schedule.project"));
    return (
      <PageFrame title={t("ui.rail.automation")} width={960} className="mp--automation">
        <button type="button" className="link-button mp-auto-detail__back" onClick={() => setOpenId(null)}>
          <Icon name="chevron" size={14} className="mp-auto-menu__chev is-back" />
          {t("ui.automation.all")}
        </button>
        <ActionNote state={action.state} />
        <header className="mp-auto-detail__head">
          <span className="mp-sched__icon" aria-hidden="true">
            <Icon name="schedule" size={16} />
          </span>
          <div className="mp-sched__text">
            <h2 className="mp-auto-detail__name" dir="auto">
              {open.name}
            </h2>
            <span className="mp-sched__meta">{summaryOf(t, translator.locale, open.schedule as { kind: string }, open.timezone)}</span>
          </div>
          <span className={open.enabled ? "mp-sched__state is-on" : "mp-sched__state"}>{t(open.enabled ? "p08.schedule.enabled" : "ui.automation.paused_state")}</span>
          <button type="button" className="mp-btn" onClick={() => runNow(open.schedule_id, runs.length)}>
            {t("p08.schedule.run_now")}
          </button>
          {open.enabled ? (
            <button type="button" className="mp-btn mp-btn--ghost" onClick={() => setPausing(open)}>
              {t("ui.automation.pause")}
            </button>
          ) : (
            <button type="button" className="mp-btn mp-btn--ghost" disabled={endPassed} title={endPassed ? t("ui.automation.end.passed") : undefined} onClick={() => setEnabled(open, true)}>
              {t("ui.automation.resume")}
            </button>
          )}
          {menu(open)}
        </header>
        {endPassed ? <p className="mp-auto-set__note">{t("ui.automation.end.passed")}</p> : null}
        <dl className="mp-auto-detail__facts">
          {fact(t("ui.automation.fact.next"), nextText(open))}
          {fact(t("ui.automation.set.approvals"), t(`ui.automation.policy.${open.approval_policy}`))}
          {fact(t("ui.automation.set.target"), t(`ui.automation.target.${open.run_target}`))}
          {fact(t("ui.automation.set.project"), projectName)}
          {fact(t("ui.automation.set.end"), open.end_at === null || open.end_at === undefined ? t("ui.automation.end.none") : formatInstant(locale, open.end_at))}
          {fact(t("ui.automation.set.zone"), ltr(open.timezone))}
        </dl>
        <p className="mp-auto-detail__objective" dir="auto">
          {open.mission_template.objective}
        </p>
        <p className="mp-auto-set__note">{t("p08.schedule.note_app_open")}</p>
        <section aria-labelledby="mp-auto-history">
          <div className="mp-auto-detail__history-head">
            <h3 id="mp-auto-history" className="mp-auto-detail__history">
              {t("ui.automation.history")}
            </h3>
            <div className="mp-auto-detail__filters" role="group" aria-label={t("ui.automation.history")}>
              {(["all", "ok", "failed"] as const).map((f) => (
                <button key={f} type="button" className="mp-auto-set__day" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {t(`ui.automation.filter.${f}`)}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="mp-auto-detail__none">{t(runs.length === 0 ? "ui.automation.no_runs" : filter === "ok" ? "ui.automation.no_ok" : "ui.automation.no_failed")}</p>
          ) : (
            <ul className="mp-sched__runs mp-auto-detail__runs">{shown.map((r) => runRow(open, r))}</ul>
          )}
          {runs.length >= 10 ? <p className="mp-auto-set__note">{t("ui.automation.history_limit")}</p> : null}
        </section>
        {dialogs}
      </PageFrame>
    );
  }

  return (
    <PageFrame
      title={t("ui.rail.automation")}
      width={960}
      className="mp--automation"
      actions={
        empty ? undefined : (
          <button type="button" className="mp-btn" onClick={() => setDraft(EMPTY)}>
            <Icon name="plus" size={14} />
            {t("p08.schedule.new")}
          </button>
        )
      }
    >
      <ActionNote state={action.state} />
      {list.loading ? <StateBlock kind="loading" /> : null}
      {list.error !== null ? <ErrorNote error={list.error} onRetry={list.reload} /> : null}

      {empty ? (
        <div className="mp-auto-first">
          <h2 className="mp-auto-first__title">{t("ui.automation.first")}</h2>
          <p className="mp-auto-first__body">{t("ui.automation.first_body")}</p>
          <p className="mp-auto-first__body">{t("p08.schedule.note_app_open")}</p>
          <div className="mp-auto-first__cards">
            {KINDS.map((k) => (
              <article key={k.id} className={k.id === "schedule" ? "mp-auto-card" : "mp-auto-card is-unavailable"}>
                <FirstRunArt kind={k.id} />
                <div className="mp-auto-card__text">
                  <h3 className="mp-auto-card__title">
                    {t(`ui.automation.kind.${k.id}`)}
                    {k.id === "schedule" ? null : <span className="mp-badge">{t("ui.automation.unavailable")}</span>}
                  </h3>
                  <p className="mp-auto-card__body">{t(`ui.automation.card.${k.id}`)}</p>
                </div>
              </article>
            ))}
          </div>
          <button type="button" className="mp-cta mp-auto-first__start" onClick={() => setDraft(EMPTY)}>
            {t("ui.automation.start")}
          </button>
        </div>
      ) : null}

      {/* PHASE-14 (CP-14-5): «التشغيل التالي» لا يعني أن الأتمتة تعمل والتطبيق مغلق. */}
      {!empty && schedules.length > 0 ? <p className="mp-auto-set__note">{t("p08.schedule.note_app_open")}</p> : null}
      <ul className="mp-sched-list">
        {schedules.map((s) => {
          const last = (s.recent_runs ?? [])[0];
          return (
            <li key={s.schedule_id} className="mp-sched">
              <div className="mp-sched__main">
                <span className="mp-sched__icon" aria-hidden="true">
                  <Icon name="schedule" size={16} />
                </span>
                <button type="button" className="mp-sched__text mp-sched__open" onClick={() => setOpenId(s.schedule_id)}>
                  <span className="mp-sched__name" dir="auto">
                    {s.name}
                  </span>
                  <span className="mp-sched__meta">
                    {summaryOf(t, translator.locale, s.schedule as { kind: string }, s.timezone)}
                    {` · ${nextText(s)}`}
                  </span>
                </button>
                <span className={s.enabled ? "mp-sched__state is-on" : "mp-sched__state"}>{t(s.enabled ? "p08.schedule.enabled" : "ui.automation.paused_state")}</span>
                <button type="button" className="mp-btn mp-btn--ghost" onClick={() => runNow(s.schedule_id, (s.recent_runs ?? []).length)}>
                  {t("p08.schedule.run_now")}
                </button>
                {menu(s)}
              </div>
              {/* آخر تشغيل وحده هنا؛ «تاريخ التشغيل» كاملًا في صفحة الأتمتة. */}
              {last === undefined ? null : <ul className="mp-sched__runs">{runRow(s, last)}</ul>}
            </li>
          );
        })}
      </ul>
      {dialogs}
    </PageFrame>
  );
}
