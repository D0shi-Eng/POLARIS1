// المُحقِّق في جانب العارض.
//
// نفس المخططات، ونفس إعدادات Ajv التي يستعملها `contracts/src/validator.ts`.
// الاختلاف في الشكل وحده: هناك تُترجَم المخططات وقت التشغيل، وهنا تصل دوالًّا
// مُترجَمة وقت البناء في حزمة مُولَّدة، لأن WebView لا يملك نظام ملفات ولأن
// CSP المنتج يمنع تقييم النصوص. الدلالة واحدة ومصدر الحقيقة واحد.
//
// ولماذا يتحقق العارض أصلًا وهو الطرف غير الموثوق: لأنه يحمي نفسه لا المضيف.
// ردّ لا يطابق العقد يجب أن يصير حالة خطأ صريحة، لا شاشةً ترسم حقلًا غير موجود.

import { CONTRACT_VALIDATORS, type CompiledContractValidator } from "../generated/contract-validators";

export interface ValidationFinding {
  readonly pointer: string;
  readonly detail: string;
}

/**
 * المُحقِّق المُترجَم مسبقًا لمرجع مُسمّى.
 *
 * لا ترجمة وقت التشغيل: Ajv يترجم المخطط عبر `new Function`، وسياسة CSP في
 * المنتج تمنع ذلك، فكان أول تحقق يرمي قبل إرسال طلب الإقلاع
 * (P01_STARTUP_REPORT_ABSENT). المُحقِّقات تُولَّد وقت البناء من نفس المخططات
 * وبنفس إعدادات Ajv، فالدلالة واحدة والسياسة لم تُضعَف.
 */
function compiled(reference: string): CompiledContractValidator | undefined {
  return Object.prototype.hasOwnProperty.call(CONTRACT_VALIDATORS, reference) ? CONTRACT_VALIDATORS[reference] : undefined;
}

/** هل يعرف العارض هذا المرجع؟ يُستعمل في اختبار الاتساق مع السجل. */
export function schemaReferenceExists(reference: string): boolean {
  return compiled(reference) !== undefined;
}

/**
 * تحقق من قيمة مقابل مرجع مخطط مُسمّى، بنفس صيغة المرجع التي يسجّلها السجل.
 * مرجع لا يُحلّ فشلٌ مرئي لا صمت: مخطط مفقود يعني أن العارض لا يعرف ما يقبله.
 */
export function validateAgainstSchemaReference(
  reference: string,
  value: unknown,
): { ok: true } | { ok: false; findings: ValidationFinding[] } {
  const validate = compiled(reference);
  if (validate === undefined) {
    return { ok: false, findings: [{ pointer: "/", detail: `unresolved schema reference ${reference}` }] };
  }
  if (validate(value)) return { ok: true };
  const errors = validate.errors ?? [];
  const findings: ValidationFinding[] = errors.slice(0, 8).map((error) => ({
    pointer: error.instancePath === "" || error.instancePath === undefined ? "/" : error.instancePath,
    detail: `${error.message ?? "invalid"} (${error.keyword ?? "unknown"})`,
  }));
  return {
    ok: false,
    findings: findings.length > 0 ? findings : [{ pointer: "/", detail: "value failed contract validation" }],
  };
}
