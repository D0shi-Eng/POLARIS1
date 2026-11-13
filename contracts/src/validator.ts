// طبقة التحقق. ترتيب المراحل مقصود:
//   1) بوابة الإصدار   → UNSUPPORTED_VERSION مميّز عن خطأ التحقق العام.
//   2) مخطط JSON       → البنية والقيود المعبَّر عنها في مصدر الحقيقة.
//   3) القواعد الدلالية → ما لا يستطيع JSON Schema التعبير عنه داخل مستند واحد.
// أي مرحلة تفشل توقف ما بعدها، حتى لا نُبلغ عن أخطاء مشتقة عن سبب واحد.

// ajv و ajv-formats تُصدَّران بأسلوب CommonJS. مع NodeNext يصل التصدير الافتراضي عبر .default،
// ونحتاج تطبيعًا صريحًا حتى يبقى الاستدعاء صحيحًا في كلا نمطي التشغيل.
import ajvModule, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

type AjvInstance = InstanceType<typeof AjvCtor>;
const AjvCtor = ((ajvModule as unknown as { default?: unknown }).default ?? ajvModule) as new (
  options?: Record<string, unknown>,
) => import("ajv/dist/2020.js").default;
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: unknown) => unknown;

import { ErrorCode, fail, ok, type ContractError, type Result } from "./errors.js";
import { CONTRACT_SCHEMA_IDS, loadAllSchemas } from "./registry.js";
import { checkContractVersion, type ContractName } from "./version.js";
import { checkSemanticRules } from "./semantics.js";

function buildAjv(): AjvInstance {
  // strict: true يمنع الكلمات المفتاحية المكتوبة خطأً من المرور بصمت داخل المخططات نفسها.
  // strictRequired: false لأن فروع then تشير عمدًا إلى خصائص معرَّفة في المخطط المحيط،
  // وهو استخدام صحيح في المواصفة، بينما تعتبره Ajv مشبوهًا افتراضيًا.
  // allErrors: true لأن رسائل الرفض هنا أدلة اختبار، لا مجرد رسائل تشغيل.
  // discriminator: true يجعل Ajv ينسب خطأ الاتحاد المميّز إلى الفرع الذي عيّنه message_type،
  // فيصبح سبب الرفض دليلًا على العيب المقصود بدل قائمة أخطاء من كل الفروع.
  const ajv = new AjvCtor({
    strict: true,
    strictRequired: false,
    allErrors: true,
    allowUnionTypes: false,
    discriminator: true,
  });
  addFormats(ajv);
  for (const loaded of loadAllSchemas()) {
    ajv.addSchema(loaded.schema, loaded.id);
  }
  return ajv;
}

const ajv = buildAjv();

const compiled = new Map<ContractName, ValidateFunction>();

function validatorFor(contract: ContractName): ValidateFunction {
  const cached = compiled.get(contract);
  if (cached !== undefined) return cached;
  const built = ajv.getSchema(CONTRACT_SCHEMA_IDS[contract]);
  if (built === undefined) {
    throw new Error(`schema not registered for contract ${contract}`);
  }
  compiled.set(contract, built);
  return built;
}

function toContractErrors(errors: readonly ErrorObject[] | null | undefined): ContractError[] {
  if (errors === null || errors === undefined || errors.length === 0) {
    return [
      {
        code: ErrorCode.VALIDATION_ERROR,
        display_message: "Payload failed contract validation.",
        retryable: false,
      },
    ];
  }
  return errors.map((error) => ({
    code: ErrorCode.VALIDATION_ERROR,
    display_message: "Payload failed contract validation.",
    internal_detail: `${error.instancePath || "/"} ${error.message ?? "invalid"} (${error.keyword})`,
    pointer: error.instancePath === "" ? "/" : error.instancePath,
    retryable: false,
  }));
}

/** يجبر كل العقود على المرور بالمراحل الثلاث بنفس الترتيب. */
export function validateContract<T = unknown>(contract: ContractName, payload: unknown): Result<T> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return fail([
      {
        code: ErrorCode.MALFORMED_MESSAGE,
        display_message: "Contract payload must be a JSON object.",
        pointer: "/",
        retryable: false,
      },
    ]);
  }

  const record = payload as Record<string, unknown>;

  const versionGate = checkContractVersion(contract, record["contract_version"]);
  if (!versionGate.ok) {
    return fail([versionGate.error]);
  }

  const validate = validatorFor(contract);
  if (!validate(payload)) {
    return fail(toContractErrors(validate.errors));
  }

  const semantic = checkSemanticRules(contract, record);
  if (semantic.length > 0) {
    return fail(semantic);
  }

  return ok(payload as T);
}

/**
 * تحقق من قيمة مقابل تعريف داخل ملف مخطط، بمعرّف السجل نفسه.
 *
 * موجود لأن حمولات P01 ليست عقودًا من الستة: لا تحمل contract_version ولا تمر
 * ببوابة الإصدار، بل تسافر داخل مظروف يحمل إصداره. ومع ذلك تُفحص بالمُحقِّق
 * نفسه ومن ملفات المخططات نفسها، فلا يوجد Ajv ثانٍ ولا مصدر حقيقة ثانٍ.
 *
 * `reference` بصيغة "file.schema.json#/$defs/Name" — نفس الصيغة التي يسجّلها
 * السجل، حتى يكون الفشل في حلّها فشلًا مرئيًا لا صمتًا.
 */
export function validateAgainstSchemaReference<T = unknown>(reference: string, value: unknown): Result<T> {
  const validate = ajv.getSchema(reference);
  if (validate === undefined) {
    return fail([
      {
        code: ErrorCode.CONTRACT_VIOLATION,
        display_message: "Schema reference could not be resolved.",
        internal_detail: `unresolved schema reference ${reference}`,
        pointer: "/",
        retryable: false,
      },
    ]);
  }
  if (!validate(value)) {
    return fail(toContractErrors(validate.errors));
  }
  return ok(value as T);
}

/** هل يعرف السجل هذا المرجع أصلًا؟ يُستعمل في اختبار اتساق السجل. */
export function schemaReferenceExists(reference: string): boolean {
  return ajv.getSchema(reference) !== undefined;
}

/** يُستخدم في الاختبارات وفي أدوات البناء للتأكد من أن كل مخطط يترجم فعلًا. */
export function compileAllContracts(): readonly ContractName[] {
  const names = Object.keys(CONTRACT_SCHEMA_IDS) as ContractName[];
  for (const name of names) validatorFor(name);
  return names;
}
