// «Computer Use» من قائمة «المزيد» كما في مانوس 2.0 (قِيس 2026-10-06 في Manus Studio): قسم «POLARIS على هذا الجهاز»
// بثلاث بطاقات أفقية (صورة في البداية ونصّ)، ثم «مهارات التطبيق» شبكةً بثلاثة أعمدة من بطاقات بغلاف ملوّن واسم ووصف
// ووسوم. النقر على بطاقة يفتح حوار تفاصيلها: أيقونة، واسم، ووصف، و«جرّبه»، و«أمثلة على التلميحات»، و«التفاصيل».
//
// ما خلف البطاقات حقيقي في POLARIS: التحكّم بسطح المكتب ومتصفّح POLARIS أداتان مسجّلتان تمرّان ببوّابة الموافقات،
// و«مهارات التطبيق» طلبات جاهزة تستعمل التحكّم بسطح المكتب نفسه مع التطبيق المسمّى. لا عدّاد استعمال: لا رقم حقيقيًّا
// وراءه في POLARIS، فلا يُعرض.

import { useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { Icon, type IconName } from "../../ui/components/Icon";
import { PageFrame, Sheet } from "../../ui/components/PageFrame";
import { seedHome } from "./HomeWorkspace";

interface Card {
  readonly id: string;
  readonly icon: IconName;
  /** مسار صفحة الإدارة في POLARIS، إن وُجدت. */
  readonly manage?: string;
}

const DEVICE: readonly Card[] = [
  { id: "computer", icon: "cursor-screen", manage: "/browser-computer" },
  { id: "browser", icon: "globe", manage: "/browser-computer" },
  { id: "skills", icon: "puzzle", manage: "/skills" },
];

/** تطبيقات Windows الشائعة التي يعمل معها التحكّم بسطح المكتب. اللون غلاف البطاقة فقط، لا شعار. */
const APPS: readonly { readonly id: string; readonly icon: IconName; readonly tags: readonly string[] }[] = [
  { id: "excel", icon: "data", tags: ["apps", "data"] },
  { id: "word", icon: "report", tags: ["apps", "content"] },
  { id: "powerpoint", icon: "slides", tags: ["apps", "content"] },
  { id: "explorer", icon: "folder", tags: ["apps", "work"] },
  { id: "notepad", icon: "edit", tags: ["apps", "content"] },
  { id: "settings", icon: "settings", tags: ["apps", "automation"] },
  { id: "edge", icon: "globe", tags: ["apps", "web"] },
  { id: "outlook", icon: "report", tags: ["apps", "work"] },
  { id: "terminal", icon: "terminal", tags: ["apps", "code"] },
];

type Open = { readonly kind: "device" | "app"; readonly id: string; readonly icon: IconName; readonly manage?: string | undefined };

export function ComputerUseScreen() {
  const translator = useTranslator();
  const navigation = useNavigation();
  const t = (key: string) => translator.t(key);
  const [open, setOpen] = useState<Open | null>(null);
  const tryIt = (text: string) => {
    seedHome(text);
    navigation.navigate("/");
  };
  return (
    <PageFrame title={t("ui.rail.computer_use")} width={960} className="mp--cu">
      <section className="cu-section" aria-labelledby="cu-device">
        <h2 className="cu-section__title" id="cu-device">
          {t("ui.cu.device_title")}
        </h2>
        <p className="cu-section__sub">{t("ui.cu.device_sub")}</p>
        <div className="cu-device">
          {DEVICE.map((c) => (
            <button key={c.id} type="button" className="cu-device__card" onClick={() => setOpen({ kind: "device", id: c.id, icon: c.icon, manage: c.manage })}>
              <span className={`cu-device__art cu-device__art--${c.id}`} aria-hidden="true">
                <Icon name={c.icon} size={22} />
              </span>
              <span className="cu-device__text">
                <span className="cu-device__name">{t(`ui.cu.${c.id}.name`)}</span>
                <span className="cu-device__desc">{t(`ui.cu.${c.id}.desc`)}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="cu-section" aria-labelledby="cu-apps">
        <h2 className="cu-section__title" id="cu-apps">
          {t("ui.cu.apps_title")}
        </h2>
        <p className="cu-section__sub">{t("ui.cu.apps_sub")}</p>
        <div className="cu-apps">
          {APPS.map((a) => (
            <button key={a.id} type="button" className="cu-app" onClick={() => setOpen({ kind: "app", id: a.id, icon: a.icon })}>
              <span className="cu-app__cover" aria-hidden="true">
                <span className={`cu-app__poster cu-app__poster--${a.id}`}>
                  <span className="cu-app__label">{t(`ui.cu.app.${a.id}`)}</span>
                  <span className="cu-app__tile">
                    <Icon name={a.icon} size={22} />
                  </span>
                </span>
              </span>
              <span className="cu-app__body">
                <span className="cu-app__name">{translator.t("ui.cu.app_name", { app: t(`ui.cu.app.${a.id}`) })}</span>
                <span className="cu-app__desc">{t(`ui.cu.app.${a.id}.desc`)}</span>
                <span className="cu-app__tags">
                  <span className="cu-app__tag cu-app__tag--by">
                    <Icon name="sparkle" size={11} />
                    POLARIS
                  </span>
                  {a.tags.map((tag) => (
                    <span key={tag} className="cu-app__tag">
                      {t(`ui.cu.tag.${tag}`)}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
      {open === null ? null : <CuSheet item={open} onClose={() => setOpen(null)} onTry={tryIt} onManage={(path) => navigation.navigate(path)} />}
    </PageFrame>
  );
}

/** حوار التفاصيل كما في مانوس: أيقونة، واسم، ووصف، و«جرّبه»، وأمثلة تملأ المُنشئ (لا تُرسل وحدها)، والتفاصيل. */
function CuSheet({ item, onClose, onTry, onManage }: { readonly item: Open; onClose(): void; onTry(text: string): void; onManage(path: string): void }) {
  const translator = useTranslator();
  const t = (key: string) => translator.t(key);
  const base = item.kind === "device" ? `ui.cu.${item.id}` : `ui.cu.app.${item.id}`;
  const name = item.kind === "device" ? t(`${base}.name`) : translator.t("ui.cu.app_name", { app: t(base) });
  const examples = [1, 2, 3, 4].map((n) => `${base}.example.${n}`).filter((key) => translator.has(key)).map((key) => translator.t(key));
  const facts = [
    { label: t("ui.addons.fact.category"), value: t(item.kind === "device" ? "ui.cu.tag.work" : "ui.cu.tag.apps") },
    { label: t("ui.cu.fact.author"), value: "POLARIS" },
    { label: t("ui.cu.fact.kind"), value: t(item.kind === "device" ? "ui.cu.fact.kind_tool" : "ui.cu.fact.kind_skill") },
    { label: t("ui.cu.fact.runs"), value: t("ui.cu.fact.runs_value") },
  ];
  return (
    <Sheet label={name} onClose={onClose} className="mp-addon-sheet">
      <span className="mp-addon-sheet__icon" aria-hidden="true">
        <Icon name={item.icon} size={24} />
      </span>
      <h2 className="mp-addon-sheet__name" dir="auto">
        {name}
      </h2>
      <p className="mp-addon-sheet__desc" dir="auto">
        {t(`${base}.long`)}
      </p>
      <div className="mp-addon-sheet__actions">
        <button type="button" className="mp-btn mp-btn--light" onClick={() => onTry(examples[0] ?? name)}>
          <Icon name="arrow-side" size={14} />
          {t("ui.addons.try")}
        </button>
      </div>
      {examples.length === 0 ? null : (
        <>
          <h3 className="mp-addon-sheet__head">{t("ui.addons.examples")}</h3>
          <div className="mp-addon-sheet__examples">
            {examples.map((text) => (
              <button key={text} type="button" className="mp-addon-sheet__example" onClick={() => onTry(text)}>
                <Icon name="chat" size={15} />
                <span dir="auto">{text}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {item.manage === undefined ? null : (
        <button type="button" className="mp-btn cu-sheet__manage" onClick={() => onManage(item.manage as string)}>
          {t(item.id === "skills" ? "ui.cu.open_skills" : "ui.cu.manage_devices")}
        </button>
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
