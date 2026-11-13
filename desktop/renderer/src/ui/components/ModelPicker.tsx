// محدّد النموذج في أعلى الصفحة (كما «Manus 1.6 Lite ▾» في مانوس): اسم النموذج، وقائمة تعرض مباشرةً كل نموذج
// محادثة أضافه المستخدم في صفحة المزوّدين — المحلي وعبر API — مجمّعة بمزوّدها، لكلٍّ سطر وصف وعلامة ✓.
// النموذج الذي لا يصلح الآن (مزوّد أو نموذج معطّل، أو غير متاح) لا يُعرض أصلًا (طلب المالك 2026-11-12): يُفعَّل من صفحة المزوّدين.
// بجانبه مربع جهد الاستدلال، وهو تفضيل واحد لكل المزوّدين والنماذج يحفظه المضيف.
//
// «الافتراضي» يعني: التوجيه يختار (افتراضي المشروع، ثم افتراضيّك، ثم النموذج المحلي الوحيد إن كان واحدًا).
// عنصر `select` أصلي مخفي بصريًّا يبقى للتقنيات المساعدة ولأداة القياس الأصلية (#composer-model).

import { useEffect } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { ModelListResultV1, ModelView, ProviderListResultV1 } from "../../generated/types/desktop-p02-result-v1";
import { onModelsChanged, type Phase02Client } from "../../ipc/p02-client";
import { EffortPicker } from "./EffortPicker";
import { Icon } from "./Icon";
import { MenuItem, MenuSeparator, Popover } from "./Popover";

const STORE_KEY = "polaris.model.next";

export function modelName(model: ModelView): string {
  return model.display_name.value ?? model.provider_model_id;
}

/** هل يقبل التوجيه هذا النموذج الآن؟ نفس شروط المضيف: مزوّد ونموذج مفعّلان، ومتاح، ونموذج محادثة. */
export function usable(m: ModelView): boolean {
  return m.provider_enabled && m.enabled && m.availability === "AVAILABLE" && m.kind !== "EMBEDDING";
}

/** اختيار النموذج المحفوظ لهذا الجهاز (تفضيل عرض؛ غياب التخزين يعني الافتراضي). */
export function readStoredModel(): string {
  try {
    return globalThis.localStorage?.getItem(STORE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storeModel(id: string): void {
  try {
    if (id === "") globalThis.localStorage?.removeItem(STORE_KEY);
    else globalThis.localStorage?.setItem(STORE_KEY, id);
  } catch {
    // تفضيل لهذا الجهاز فقط
  }
}

export interface ModelPickerProps {
  readonly phase02: Phase02Client | undefined;
  /** المعرّف المختار؛ "" = الافتراضي. */
  readonly value: string;
  onChange(id: string): void;
  /** يُعرض عنصر `select` الأصلي بالمعرّف `composer-model` (الرئيسية وحدها). */
  readonly nativeId?: string;
}

export function ModelPicker({ phase02, value, onChange, nativeId }: ModelPickerProps) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const models = useHostQuery<ModelListResultV1 | null>(() => (phase02 === undefined ? Promise.resolve({ ok: true as const, value: null }) : phase02.listModels({})), [phase02]);
  const providers = useHostQuery<ProviderListResultV1 | null>(() => (phase02 === undefined ? Promise.resolve({ ok: true as const, value: null }) : phase02.listProviders()), [phase02]);
  // المحدّد يبقى مركّبًا تحت نافذة الإعدادات: كل تفعيل أو تحديث ناجح هناك يعيد قراءته من المضيف.
  const reloadModels = models.reload;
  const reloadProviders = providers.reload;
  useEffect(
    () =>
      onModelsChanged(() => {
        reloadModels();
        reloadProviders();
      }),
    [reloadModels, reloadProviders],
  );
  const chat = (models.value?.models ?? []).filter((m) => m.kind !== "EMBEDDING");
  const selectable = chat.filter(usable);
  const defaultId = models.value?.preferences.default_model_id;
  const chosen = chat.find((m) => m.model_id === value);
  // كما يقرّر المضيف (ADR-040، `SOLE_ENABLED_MODEL`): بلا افتراضي، النموذج الصالح الوحيد من أيّ صنف، لا «المحلي الوحيد».
  const fallback = defaultId !== undefined ? chat.find((m) => m.model_id === defaultId) : selectable.length === 1 ? selectable[0] : undefined;
  const shown = chosen !== undefined ? modelName(chosen) : fallback !== undefined ? modelName(fallback) : translator.t("ui.model.default");
  const providerName = (id: string) => providers.value?.providers.find((p) => p.provider_id === id)?.display_name ?? id;
  const groups = [...new Set(selectable.map((m) => m.provider_id))].map((id) => ({ id, models: selectable.filter((m) => m.provider_id === id) }));

  const describe = (m: ModelView) => {
    const parts = [translator.t(m.locality === "LOCAL" ? "ui.model.local" : "ui.model.remote")];
    if (m.parameter_count.value !== undefined) parts.push(m.parameter_count.value);
    if (m.context_window.value !== undefined) parts.push(translator.t("ui.model.context", { count: Math.round(m.context_window.value / 1000) }));
    if (m.quantization.value !== undefined) parts.push(m.quantization.value);
    return parts.join(" · ");
  };

  return (
    <div className="model-picker">
      {nativeId === undefined ? null : (
        <>
          <label className="visually-hidden" htmlFor={nativeId}>
            {translator.t("p08.composer.model")}
          </label>
          <select id={nativeId} className="visually-hidden" value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">{translator.t("ui.model.default")}</option>
            {selectable.map((m) => (
              <option key={m.model_id} value={m.model_id}>
                {modelName(m)}
              </option>
            ))}
          </select>
        </>
      )}
      <Popover
        label={translator.t("p08.composer.model")}
        className="model-picker__popover"
        triggerClassName="model-picker__button"
        trigger={
          <>
            <Icon name="chevron" size={14} className="model-picker__chevron" />
            <span className="model-picker__name" dir="auto">
              {shown}
            </span>
          </>
        }
      >
        <div className="model-menu">
          <MenuItem
            label={translator.t("ui.model.default")}
            detail={fallback === undefined ? translator.t("ui.model.default_none") : translator.t("ui.model.default_is", { name: modelName(fallback) })}
            trailing={value === "" ? <Icon name="check" size={15} /> : undefined}
            onSelect={() => onChange("")}
          />
          {groups.map((g) => (
            <div key={g.id} className="model-menu__group">
              <p className="model-menu__provider">{providerName(g.id)}</p>
              {g.models.map((m) => (
                <MenuItem
                  key={m.model_id}
                  label={modelName(m)}
                  detail={describe(m)}
                  trailing={value === m.model_id ? <Icon name="check" size={15} /> : undefined}
                  onSelect={() => onChange(m.model_id)}
                />
              ))}
            </div>
          ))}
          {selectable.length === 0 ? <p className="menu-note">{translator.t("ui.model.none")}</p> : null}
          <MenuSeparator />
          <MenuItem icon={<Icon name="settings" size={15} />} label={translator.t("ui.model.manage")} onSelect={() => navigation.navigate("/models")} />
        </div>
      </Popover>
      <EffortPicker phase02={phase02} effort={models.value?.preferences.reasoning_effort} />
    </div>
  );
}
