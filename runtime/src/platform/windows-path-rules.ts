// القواعد النحوية لمسارات ويندوز. دوال خالصة بلا لمس نظام ملفات،
// فهي قابلة للاختبار على أي منصة، بينما حلّ الروابط الحقيقي مسؤولية PathAuthority.
//
// المبدأ: المسار الغامض يُرفض، لا يُخمَّن. السياسة لا تحاول تقليد تطبيع ويندوز؛
// هذه الطبقة ترفض كل شكل لا يمكن إثبات معناه بلا مساعدة نظام الملفات.

export type WindowsPathRejection =
  | "NOT_ABSOLUTE_DRIVE_PATH"
  | "TRAVERSAL_SEGMENT"
  | "EMPTY_SEGMENT"
  | "RESERVED_DEVICE_NAME"
  | "ALTERNATE_DATA_STREAM"
  | "TRAILING_DOT_OR_SPACE"
  | "SHORT_NAME_FORM"
  | "WILDCARD_OR_ILLEGAL_CHARACTER"
  | "CONTROL_CHARACTER"
  | "EXTENDED_LENGTH_PREFIX"
  | "UNC_PATH"
  | "TOO_LONG";

export interface WindowsPathParts {
  /** حرف السواقة بحرف كبير، بلا نقطتين. */
  readonly drive: string;
  readonly segments: readonly string[];
  /** الشكل القانوني: "D:\\A\\B". يُستعمل للعرض والمقارنة بعد طيّ الحالة. */
  readonly normalised: string;
}

export type WindowsPathResult =
  | { readonly ok: true; readonly parts: WindowsPathParts }
  | { readonly ok: false; readonly rejection: WindowsPathRejection; readonly detail: string };

const RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

const MAX_LENGTH = 4096;
const SHORT_NAME = /^[^\\/:*?"<>|]{1,6}~[0-9]{1,3}(\.[^\\/:*?"<>|]{1,3})?$/;
const ILLEGAL = /[*?"<>|]/;

function reject(rejection: WindowsPathRejection, detail: string): WindowsPathResult {
  return { ok: false, rejection, detail };
}

/**
 * يحلّل مسار ويندوز منطقيًا ويرفض كل شكل غامض.
 * ".." يُرفض ولا يُحلّ: حلّ المسار وظيفة نظام الملفات، لا وظيفة محلّل نصّي.
 */
export function parseWindowsPath(input: string): WindowsPathResult {
  if (input.length === 0 || input.length > MAX_LENGTH) return reject("TOO_LONG", `length=${String(input.length)}`);
  for (const ch of input) {
    if (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) return reject("CONTROL_CHARACTER", "control character in path");
  }
  if (input.startsWith("\\\\?\\") || input.startsWith("//?/")) return reject("EXTENDED_LENGTH_PREFIX", "extended-length prefix");
  if (input.startsWith("\\\\") || input.startsWith("//")) return reject("UNC_PATH", "UNC paths are out of scope in W4");

  const unified = input.replace(/\//g, "\\");
  const driveMatch = /^([A-Za-z]):\\/.exec(unified);
  if (driveMatch === null) return reject("NOT_ABSOLUTE_DRIVE_PATH", "path must start with a drive letter and a separator");

  const drive = (driveMatch[1] as string).toUpperCase();
  const rest = unified.slice(3);
  const rawSegments = rest.length === 0 ? [] : rest.split("\\");

  const segments: string[] = [];
  for (let index = 0; index < rawSegments.length; index += 1) {
    const segment = rawSegments[index] as string;
    // فاصل نهائي واحد مقبول؛ فاصل مزدوج في الوسط ليس كذلك.
    if (segment.length === 0) {
      if (index === rawSegments.length - 1) continue;
      return reject("EMPTY_SEGMENT", `empty segment at index ${String(index)}`);
    }
    if (segment === "." || segment === "..") return reject("TRAVERSAL_SEGMENT", `segment "${segment}"`);
    if (segment.includes(":")) return reject("ALTERNATE_DATA_STREAM", `segment "${segment}" carries a stream separator`);
    if (ILLEGAL.test(segment)) return reject("WILDCARD_OR_ILLEGAL_CHARACTER", `segment "${segment}"`);
    if (segment.endsWith(".") || segment.endsWith(" ")) return reject("TRAILING_DOT_OR_SPACE", `segment "${segment}"`);
    if (SHORT_NAME.test(segment)) return reject("SHORT_NAME_FORM", `segment "${segment}" looks like an 8.3 short name`);
    const stem = (segment.split(".")[0] ?? "").toUpperCase();
    if (RESERVED.has(stem)) return reject("RESERVED_DEVICE_NAME", `segment "${segment}"`);
    segments.push(segment);
  }

  const normalised = segments.length === 0 ? `${drive}:\\` : `${drive}:\\${segments.join("\\")}`;
  return { ok: true, parts: { drive, segments, normalised } };
}

/** طيّ الحالة للمقارنة. مسارات ويندوز غير حسّاسة لحالة الأحرف. */
export function foldWindowsPath(normalised: string): string {
  return normalised.toUpperCase();
}

/** هل المسار المنطقي المُطبَّع يقع داخل الجذر المُطبَّع، بحدود مقاطع كاملة. */
export function isLogicallyInside(root: WindowsPathParts, target: WindowsPathParts): boolean {
  if (root.drive !== target.drive) return false;
  if (target.segments.length < root.segments.length) return false;
  return root.segments.every(
    (segment, index) => segment.toUpperCase() === (target.segments[index] as string).toUpperCase(),
  );
}
