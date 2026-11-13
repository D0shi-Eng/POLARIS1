// الرئيسية على نمط مانوس 2.0 (قِيس 2026-10-05): محدّد النموذج في أعلى البداية، واستعمال اليوم في النهاية؛ في الوسط
// علامة POLARIS، ثم بطاقتا «بناء» و«إنشاء» فوق بعض، وبجانبهما بطاقة «البدء من ملف محلي»؛ والمُنشئ في أسفل الصفحة
// وفوقه صفّ السياق (هذا الكمبيوتر، المشروع، المجلد).
//
// «بناء» و«إنشاء» تفتحان لوحة قوالب مكان البطاقات، كلّ قالب يملأ المُنشئ بطلب واضح يكمله المستخدم؛ لا شيء يُرسل
// وحده. القوالب ما ينتجه POLARIS فعلًا (مواقع وتطبيقات ويب وألعاب متصفّح ولوحات بيانات ومستندات وعروض وجداول)،
// لا ما لا يقدر عليه. «البدء من ملف محلي» يفتح منتقي الملفات، ويقبل السحب والإفلات، فتُرفق الملفات بالمُنشئ.
// لا خطة مدفوعة ولا رصيد ولا ترقية: لا مقابل لها في POLARIS، فلا تُزيَّف.

import { useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { UsageSummaryResultV1 } from "../../generated/types/desktop-p06-result-v1";
import type { ExecutionStatusResultV1 } from "../../generated/types/desktop-p08-result-v1";
import type { Phase02Client } from "../../ipc/p02-client";
import type { Phase03Client } from "../../ipc/p03-client";
import type { Phase06Client } from "../../ipc/p06-client";
import type { Phase08Client } from "../../ipc/p08-client";
import { formatNumber } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { readStoredSpecialist, specialistName, storeSpecialist, useAgentCatalog } from "../../p08/specialists";
import { Icon } from "../../ui/components/Icon";
import { TemplateArt } from "../../ui/components/TemplateArt";
import { BrandMark } from "../../ui/components/Brand";
import { ModelPicker, readStoredModel, storeModel } from "../../ui/components/ModelPicker";
import { Composer, type ComposerMode } from "./Composer";
import { KINDS, SLIDE_COUNTS, TEMPLATES_PER_PAGE, type HomeKind } from "./homeKinds";

/** قوالب «بناء» (بترتيب مانوس 2.0 حيث يقدر POLARIS عليها): كلها شيفرة يكتبها في مساحة المهمّة ويعاينها أو يشغّلها.
 *  تطبيق الهاتف وامتداد Safari غير موجودين: لا محاكي هاتف ولا Xcode هنا، فلا يُعرضان. */
const BUILD: readonly string[] = ["website", "chatbot", "desktop", "dashboard", "webapp", "extension", "game", "script", "notebook"];

/** قوالب «إنشاء» مجموعاتٍ كما في مانوس. لا مجموعة «الوسائط»: لا نموذج صور ولا فيديو ولا صوت في POLARIS بعد. */
const CREATE: readonly { readonly group: string; readonly ids: readonly string[] }[] = [
  { group: "document", ids: ["slides", "document", "sheet", "analysis"] },
  { group: "report", ids: ["pdf", "research"] },
];

/** لوحة تُفتح بها الرئيسية عند الوصول إليها من صفحة أخرى («ابدأ البناء الآن» في الإنشاءات تفتح «بناء»، كما في مانوس). */
let pendingPanel: "build" | "create" | null = null;

export function openHomePanel(panel: "build" | "create"): void {
  pendingPanel = panel;
}

/** طلب يُوضع في المُنشئ عند الوصول إلى الرئيسية («جرّبه» في تفاصيل إضافة). لا شيء يُرسل وحده. */
let pendingSeed: string | null = null;

export function seedHome(text: string): void {
  pendingSeed = text;
}

export function HomeWorkspace({ phase02, phase03, phase06, phase08 }: { readonly phase02?: Phase02Client | undefined; readonly phase03: Phase03Client; readonly phase06?: Phase06Client | undefined; readonly phase08?: Phase08Client | undefined }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const locale = translator.locale as LocaleCode;
  const [seed, setSeed] = useState<{ readonly text: string; readonly n: number } | undefined>(() => {
    const first = pendingSeed;
    pendingSeed = null;
    return first === null ? undefined : { text: first, n: 1 };
  });
  const [modelId, setModelId] = useState<string>(() => readStoredModel());
  const [panel, setPanel] = useState<"build" | "create" | null>(() => {
    const first = pendingPanel;
    pendingPanel = null;
    return first;
  });
  const [pick, setPick] = useState(0);
  const [dropped, setDropped] = useState<{ readonly files: readonly File[]; readonly n: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  // وكيل ثبّته المستخدم من صفحة الوكلاء للمهمّة التالية.
  const [specialistId, setSpecialistId] = useState<string>(() => readStoredSpecialist());
  const catalog = useAgentCatalog(specialistId === "" ? undefined : phase08);
  const pinned = catalog?.specialists.find((s) => s.specialist_id === specialistId);
  const clearSpecialist = () => {
    storeSpecialist("");
    setSpecialistId("");
  };
  const status = useHostQuery<ExecutionStatusResultV1 | null>(() => (phase08 === undefined ? Promise.resolve({ ok: true as const, value: null }) : phase08.executionStatus()), [phase08]);
  const usage = useHostQuery<UsageSummaryResultV1 | null>(() => (phase06 === undefined ? Promise.resolve({ ok: true as const, value: null }) : phase06.usageSummary()), [phase06]);
  const today = usage.value?.today;
  const tokens = today === undefined ? null : today.input_tokens_reported + today.output_tokens_reported;
  // T-8: نداءات لم يبلّغ مزوّدها الرموز لا تدخل الرقم؛ تُقال بعلامة «+» وفي التلميح، فلا يُقرأ الرقم استهلاكًا كاملًا.
  const unreported = today?.calls_without_reported_tokens ?? 0;
  const usageTitle = unreported > 0 ? translator.t("ui.usage.title_unreported", { count: unreported }) : translator.t("ui.usage.title");

  const choose = (id: string) => {
    setModelId(id);
    storeModel(id);
  };
  // المرحلة الثانية كما في مانوس: النوع المختار، وقالبه، وصفحة القوالب، ودفعة الأفكار، وعدد الشرائح.
  const [kindId, setKindId] = useState<string | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [tplPage, setTplPage] = useState(0);
  const [ideaRound, setIdeaRound] = useState(0);
  const [slideCount, setSlideCount] = useState("8-12");
  const kind: HomeKind | undefined = kindId === null ? undefined : KINDS[kindId];
  const openKind = (id: string) => {
    setKindId(id);
    setTemplate(null);
    setTplPage(0);
    setIdeaRound(0);
    setPanel(null);
  };
  const closeKind = () => {
    setKindId(null);
    setTemplate(null);
  };
  const seedText = (text: string) => setSeed((current) => ({ text, n: (current?.n ?? 0) + 1 }));
  /** التعليمة التي تسبق نصّ المستخدم عند الإرسال: طلب النوع، والقالب بوصفه، وعدد الشرائح. */
  const mode: ComposerMode | undefined =
    kind === undefined
      ? undefined
      : {
          icon: kind.icon,
          label: translator.t(`ui.tpl.${kind.id}`),
          instruction: [
            translator.t(`ui.tpl.${kind.id}.prompt`),
            template === null ? null : translator.t("ui.kind.template_line", { name: translator.t(`ui.kind.${kind.id}.tpl.${template}`), brief: translator.t(`ui.kind.${kind.id}.tpl.${template}.brief`) }),
            kind.slideCount === true ? translator.t("ui.kind.count_line", { count: translator.t(`ui.kind.count.${slideCount}`) }) : null,
          ]
            .filter((line): line is string => line !== null)
            .join("\n"),
          onClear: closeKind,
          ...(kind.slideCount === true
            ? { count: { value: slideCount, options: SLIDE_COUNTS.map((c) => ({ value: c, label: translator.t(`ui.kind.count.${c}`) })), label: translator.t("ui.kind.count"), onChange: setSlideCount } }
            : {}),
        };
  // الأفكار: ثلاث في كل دفعة. أفكار القالب المختار أولًا (كما يبدّلها مانوس عند اختيار قالب)، ثم العامّة.
  const ideaKeys = (() => {
    if (kind === undefined) return [];
    const pool: string[] = [];
    if (template !== null && kind.templateIdeas === true) for (let n = 1; n <= 3; n += 1) pool.push(`ui.kind.${kind.id}.tpl.${template}.idea.${n}`);
    for (let n = 1; n <= kind.ideas; n += 1) pool.push(`ui.kind.${kind.id}.idea.${n}`);
    const start = (ideaRound * 3) % pool.length;
    return [0, 1, 2].map((i) => pool[(start + i) % pool.length] as string);
  })();
  const pages = kind === undefined ? 0 : Math.ceil(kind.templates.length / TEMPLATES_PER_PAGE);

  return (
    <div className="workspace-home home2">
      <div className="topbar">
        <ModelPicker phase02={phase02} value={modelId} onChange={choose} nativeId="composer-model" />
        <span className="topbar__spacer" />
        {phase06 === undefined ? null : (
          <button type="button" className="usage-chip" title={usageTitle} onClick={() => navigation.navigate("/usage")}>
            <span>{tokens === null ? "—" : `${formatNumber(locale, tokens)}${unreported > 0 ? "+" : ""}`}</span>
            <Icon name="sparkle" size={14} />
            <span className="visually-hidden">{usageTitle}</span>
          </button>
        )}
      </div>

      {/* مانوس: حين تُفتح لوحة تختفي العلامة والبطاقات، وتجلس اللوحة فوق المُنشئ مباشرة. */}
      <div className={panel === null && kind === undefined ? "home2__stage" : "home2__stage is-docked"}>
        {panel === null && kind === undefined ? (
          <div className="home2__brand">
            <BrandMark size={40} className="home-brand__mark" />
            <span className="home2__wordmark">{translator.t("app.name").toLowerCase()}</span>
          </div>
        ) : null}
        {/* السؤال مقروء لقارئ الشاشة ولأدوات القياس؛ مانوس 2.0 لا يعرضه نصًّا ظاهرًا. */}
        <h2 className="visually-hidden">{translator.t("p08.home.prompt")}</h2>

        {kind !== undefined ? (
          <KindPanel
            kind={kind}
            template={template}
            page={tplPage}
            pages={pages}
            ideas={ideaKeys}
            onTemplate={(id) => setTemplate((current) => (current === id ? null : id))}
            onPage={setTplPage}
            onRefresh={() => setIdeaRound((n) => n + 1)}
            onIdea={(key) => seedText(translator.t(key))}
            onBlank={() => seedText("")}
            onClose={closeKind}
          />
        ) : panel === null ? (
          <div className="home2__cards">
            <div className="home2__stack">
              <button type="button" className="home2-card home2-card--build" onClick={() => setPanel("build")}>
                <span className="home2-card__art" aria-hidden="true">
                  <span className="home2-card__ring" />
                </span>
                <span className="home2-card__icon home2-card__icon--build" aria-hidden="true">
                  <Icon name="build" size={18} />
                </span>
                <span className="home2-card__title">
                  {translator.t("ui.home.build")}
                  <Icon name="chevron" size={14} className="home2-card__chev" />
                </span>
                <span className="home2-card__sub">{translator.t("ui.home.build_sub")}</span>
              </button>
              <button type="button" className="home2-card home2-card--create" onClick={() => setPanel("create")}>
                <span className="home2-card__art" aria-hidden="true">
                  <span className="home2-card__sheet" />
                  <span className="home2-card__sheet home2-card__sheet--b" />
                </span>
                <span className="home2-card__icon home2-card__icon--create" aria-hidden="true">
                  <Icon name="shapes" size={18} />
                </span>
                <span className="home2-card__title">
                  {translator.t("ui.home.create")}
                  <Icon name="chevron" size={14} className="home2-card__chev" />
                </span>
                <span className="home2-card__sub">{translator.t("ui.home.create_sub")}</span>
              </button>
            </div>
            <button
              type="button"
              className={dragging ? "home2-card home2-card--file is-dragging" : "home2-card home2-card--file"}
              disabled={phase08 === undefined}
              onClick={() => setPick((n) => n + 1)}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                setDropped((current) => ({ files: Array.from(event.dataTransfer.files), n: (current?.n ?? 0) + 1 }));
              }}
            >
              <span className="home2-card__folder" aria-hidden="true">
                <Icon name="folder" size={56} />
              </span>
              <span className="home2-card__title">{translator.t("ui.home.local")}</span>
              <span className="home2-card__sub">{translator.t("ui.home.local_sub")}</span>
            </button>
          </div>
        ) : (
          <section className="home2-panel" aria-label={translator.t(`ui.home.${panel}`)}>
            <header className="home2-panel__head">
              <h3 className="home2-panel__title">{translator.t(`ui.home.${panel}`)}</h3>
              <button type="button" className="icon-button" aria-label={translator.t("ui.close")} title={translator.t("ui.close")} onClick={() => setPanel(null)}>
                <Icon name="close" size={16} />
              </button>
            </header>
            {(panel === "build" ? [{ group: "", ids: BUILD }] : CREATE).map((g) => (
              <div key={g.group} className="home2-panel__group">
                {g.group === "" ? null : <h4 className="home2-panel__label">{translator.t(`ui.tpl.group.${g.group}`)}</h4>}
                <div className="home2-panel__grid">
                  {g.ids.map((id) => (
                    <button key={id} type="button" className="home2-tile" data-template={id} onClick={() => openKind(id)}>
                      <span className="home2-tile__art" aria-hidden="true">
                        <TemplateArt id={id} />
                      </span>
                      <span className="home2-tile__label">{translator.t(`ui.tpl.${id}`)}</span>
                    </button>
                  ))}
                  {panel === "build" ? (
                    <button type="button" className="home2-tile" data-template="automation" onClick={() => navigation.navigate("/schedules")}>
                      <span className="home2-tile__art" aria-hidden="true">
                        <TemplateArt id="automation" />
                      </span>
                      <span className="home2-tile__label">{translator.t("ui.rail.automation")}</span>
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="home2__composer">
        <Composer
          phase02={phase02}
          phase03={phase03}
          phase06={phase06}
          phase08={phase08}
          seed={seed}
          modelId={modelId}
          contextBar
          pickRequest={pick}
          dropped={dropped}
          voiceConfigured={status.value?.voice_configured ?? false}
          mode={mode}
          specialist={pinned === undefined ? undefined : { id: pinned.specialist_id, name: specialistName(pinned, locale), onClear: clearSpecialist }}
        />
      </div>
    </div>
  );
}

/**
 * لوحة «أنشئ …» (مانوس 2.0): العنوان، وفي الطرف الآخر سهما القوالب وزرّ الإغلاق؛ ثم القوالب بطاقاتٍ يُختار منها واحد
 * (حدّ أزرق)، ثم «استكشف الأفكار» بزرّ تحديث وثلاث بطاقات. في العروض: «عرض تقديمي فارغ جديد»، والأفكار قبل القوالب.
 */
function KindPanel({
  kind,
  template,
  page,
  pages,
  ideas,
  onTemplate,
  onPage,
  onRefresh,
  onIdea,
  onBlank,
  onClose,
}: {
  readonly kind: HomeKind;
  readonly template: string | null;
  readonly page: number;
  readonly pages: number;
  readonly ideas: readonly string[];
  onTemplate(id: string): void;
  onPage(page: number): void;
  onRefresh(): void;
  onIdea(key: string): void;
  onBlank(): void;
  onClose(): void;
}) {
  const translator = useTranslator();
  const t = (key: string) => translator.t(key);
  const slides = kind.slideCount === true;
  const shown = kind.templates.slice(page * TEMPLATES_PER_PAGE, (page + 1) * TEMPLATES_PER_PAGE);
  const arrows =
    pages > 1 ? (
      <>
        <button type="button" className="icon-button kind-panel__nav" aria-label={t("ui.kind.prev")} title={t("ui.kind.prev")} disabled={page === 0} onClick={() => onPage(page - 1)}>
          <Icon name="chevron" size={14} className="kind-panel__back" />
        </button>
        <button type="button" className="icon-button kind-panel__nav" aria-label={t("ui.kind.next")} title={t("ui.kind.next")} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
          <Icon name="chevron" size={14} className="kind-panel__fwd" />
        </button>
      </>
    ) : null;
  const templates =
    shown.length === 0 ? null : (
      <div className="kind-panel__templates" role="radiogroup" aria-label={t("ui.kind.pick_template")}>
        {shown.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={template === id} className={template === id ? "kind-tpl is-on" : "kind-tpl"} data-template={`${kind.id}-${id}`} onClick={() => onTemplate(id)}>
            {slides ? null : <span className="kind-tpl__name">{t(`ui.kind.${kind.id}.tpl.${id}`)}</span>}
            <span className={`kind-tpl__art kind-tpl__art--${kind.id} kind-tpl__art--${id}`} aria-hidden="true">
              {slides ? (
                <span className="kind-tpl__slide-title">{t(`ui.kind.${kind.id}.tpl.${id}`)}</span>
              ) : (
                <>
                  <span className="kind-tpl__bar" />
                  <span className="kind-tpl__line" />
                  <span className="kind-tpl__line kind-tpl__line--short" />
                  <span className="kind-tpl__cta" />
                </>
              )}
            </span>
            {slides ? <span className="kind-tpl__name">{t(`ui.kind.${kind.id}.tpl.${id}`)}</span> : null}
          </button>
        ))}
      </div>
    );
  const ideaCards = (
    <div className="kind-panel__ideas">
      {ideas.map((key) => (
        <button key={key} type="button" className="kind-idea" onClick={() => onIdea(key)}>
          <Icon name={kind.icon} size={15} className="kind-idea__icon" />
          <span className="kind-idea__text" dir="auto">
            {t(key)}
          </span>
        </button>
      ))}
    </div>
  );
  return (
    <section className={slides ? "kind-panel kind-panel--slides" : "kind-panel"} aria-label={t(`ui.kind.${kind.id}.title`)}>
      <header className="kind-panel__head">
        <h3 className="kind-panel__title">{t(`ui.kind.${kind.id}.title`)}</h3>
        <span className="kind-panel__tools">
          {slides ? (
            <>
              <button type="button" className="kind-panel__blank" onClick={onBlank}>
                <Icon name="plus" size={14} />
                {t("ui.kind.blank_slides")}
              </button>
              <button type="button" className="icon-button kind-panel__nav" aria-label={t("ui.kind.refresh")} title={t("ui.kind.refresh")} onClick={onRefresh}>
                <Icon name="refresh" size={14} />
              </button>
            </>
          ) : (
            arrows
          )}
          <button type="button" className="icon-button kind-panel__nav" aria-label={t("ui.close")} title={t("ui.close")} onClick={onClose}>
            <Icon name="close" size={15} />
          </button>
        </span>
      </header>
      {slides ? (
        <>
          {ideaCards}
          {shown.length === 0 ? null : (
            <div className="kind-panel__row">
              <h4 className="kind-panel__label">{t("ui.kind.pick_template")}</h4>
              <span className="kind-panel__tools">{arrows}</span>
            </div>
          )}
          {templates}
        </>
      ) : (
        <>
          {templates}
          <div className="kind-panel__row">
            <h4 className="kind-panel__label">{t("ui.kind.ideas")}</h4>
            <button type="button" className="icon-button kind-panel__nav" aria-label={t("ui.kind.refresh")} title={t("ui.kind.refresh")} onClick={onRefresh}>
              <Icon name="refresh" size={14} />
            </button>
          </div>
          {ideaCards}
        </>
      )}
    </section>
  );
}
