// تسلسل JSON قانوني حتمي (POLARIS-CJSON-1).
// الغرض: أن ينتج نفس المدخل نفس البايتات دائمًا، حتى يمكن لاحقًا بناء سلسلة تجزئة للتدقيق.
// القواعد: ترتيب المفاتيح معجميًا بوحدات UTF-16، بلا مسافات، بلا أسّ في الأعداد، رفض القيم غير الحتمية.

/** الأخطاء الناتجة عن قيمة لا يمكن تقنينها بشكل حتمي. */
export class CanonicalizationError extends Error {
  public constructor(message: string, public readonly pointer: string) {
    super(`${message} at ${pointer}`);
    this.name = "CanonicalizationError";
  }
}

/** القيم المسموح بها داخل حمولة عقد قابلة للتقنين. */
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

// JSON.stringify يهرب المحارف الضرورية فقط؛ نعتمد عليه للسلاسل لأن ناتجه مستقر ومحدد في المواصفة.
function encodeString(value: string): string {
  return JSON.stringify(value);
}

// الأعداد: نرفض غير المنتهية، ونرفض الأسّ لأن تمثيله غير موحّد بين اللغات.
function encodeNumber(value: number, pointer: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError("non-finite number is not canonicalizable", pointer);
  }
  if (Number.isInteger(value) && Object.is(value, -0)) {
    return "0";
  }
  const encoded = String(value);
  if (encoded.includes("e") || encoded.includes("E")) {
    throw new CanonicalizationError("exponent notation is not canonicalizable", pointer);
  }
  return encoded;
}

// الترتيب بوحدات UTF-16 هو ترتيب المقارنة الافتراضي للسلاسل في JavaScript،
// وهو نفسه المستخدم في JCS، فيتطابق الناتج مع تطبيقات اللغات الأخرى.
function sortKeys(keys: string[]): string[] {
  return [...keys].sort();
}

function encode(value: unknown, pointer: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return encodeNumber(value, pointer);
    case "string":
      return encodeString(value);
    case "undefined":
      throw new CanonicalizationError("undefined is not representable", pointer);
    case "bigint":
    case "function":
    case "symbol":
      throw new CanonicalizationError(`${typeof value} is not representable`, pointer);
    default:
      break;
  }

  if (Array.isArray(value)) {
    // ترتيب العناصر جزء من المعنى، فلا يُعاد ترتيبه.
    const parts = value.map((item, index) => encode(item, `${pointer}/${index}`));
    return `[${parts.join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of sortKeys(Object.keys(record))) {
    const child = record[key];
    // المفاتيح ذات القيمة undefined تُحذف، تمامًا كما يفعل JSON.stringify، حتى لا يختلف الناتج
    // بين كائن أنشئ بحقل اختياري غائب وآخر أنشئ بالحقل مضبوطًا على undefined.
    if (child === undefined) continue;
    parts.push(`${encodeString(key)}:${encode(child, `${pointer}/${key}`)}`);
  }
  return `{${parts.join(",")}}`;
}

/** يُنتج التمثيل القانوني النصي للقيمة. */
export function canonicalize(value: unknown): string {
  return encode(value, "");
}

/** يُنتج بايتات UTF-8 للتمثيل القانوني، وهي المدخل الوحيد المعتمد للتجزئة. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

/** نسخة من الكائن بعد حذف حقل واحد من المستوى الأعلى، لحساب تجزئة لا تشمل حقل التجزئة نفسه. */
export function withoutTopLevelKey<T extends Record<string, unknown>>(
  value: T,
  key: string,
): Record<string, unknown> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
