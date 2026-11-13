// هل يرى النموذج المختار الصور؟ (تكليف مكافأة Manus، 2026-10-19)
//
// الجواب من حقيقة النموذج كما يحفظها المضيف (`model.list`): قدرة `VISION_INPUT` مدعومة بمصدر معروف. المجهول ليس «نعم»:
// المضيف لا يرسل صورة إلى نموذج لا يعلن الرؤية، فالواجهة تقول ذلك قبل الإرسال بدل أن يُفاجأ المستخدم بردّ لم يرَ الصورة.

import type { ModelListResultV1 } from "../generated/types/desktop-p02-result-v1";

export interface VisionVerdict {
  readonly modelName: string;
  readonly sees: boolean;
}

/** النموذج الذي سيُستعمل (المختار، أو افتراضي المستخدم حين لا يُختار شيء) وهل يعلن الرؤية. لا نموذج ← لا حكم. */
export function visionOf(list: ModelListResultV1 | null | undefined, chosenId: string): VisionVerdict | undefined {
  if (list === null || list === undefined) return undefined;
  const id = chosenId !== "" ? chosenId : list.preferences.default_model_id;
  const model = list.models.find((m) => m.model_id === id);
  if (model === undefined) return undefined;
  const claim = model.capabilities.find((c) => c.capability === "VISION_INPUT");
  const sees = claim !== undefined && claim.support === "SUPPORTED" && claim.provenance !== "UNKNOWN";
  return { modelName: model.display_name.value ?? model.model_id, sees };
}
