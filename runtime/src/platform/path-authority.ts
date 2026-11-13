// عقد سلطة المسارات. هذا الملف لا يلمس نظام الملفات إطلاقًا:
// الفصل مقصود حتى تستطيع الطبقات العليا (منها D2) الاعتماد على النوع
// دون أن تكتسب قدرة الوصول إلى نظام الملفات.

import type { WindowsPathRejection } from "./windows-path-rules.js";

export type PathRejection =
  | WindowsPathRejection
  | "UNKNOWN_MOUNT"
  | "PARENT_NOT_FOUND"
  | "NOT_FOUND"
  | "NOT_A_FILE"
  | "NOT_A_DIRECTORY"
  | "ESCAPES_ROOT"
  /** الاحتواء المنطقي يقول "داخل" بينما الحلّ الحقيقي يقول "خارج": رابط/وصلة تتجاوز النطاق. */
  | "SYMLINK_ESCAPE"
  | "CANONICALIZATION_FAILED";

/** هوية كائن قائم على المضيف: وحدة التخزين ورقم الكائن فيها، بنصّهما. */
export interface HostObjectIdentity {
  readonly volume: string;
  readonly file: string;
}

export interface CanonicalPath {
  /** المسار المنطقي بصيغة POLARIS القانونية. */
  readonly logical: string;
  /** المسار الحقيقي بعد حلّ كل رابط ووصلة، بصيغة المضيف. */
  readonly host: string;
  readonly exists: boolean;
  readonly kind: "FILE" | "DIRECTORY" | "ABSENT" | "OTHER";
  /**
   * هوية الكائن كما رصدها المُثبِت على المسار المحلول. غائبة حين لا يوجد كائن
   * بعد. هي ما يحمله المنفّذ ليطابقه على مقبضه هو بدل أن يعيد حلّ الاسم.
   */
  readonly identity?: HostObjectIdentity;
}

export interface PathFailure {
  readonly rejection: PathRejection;
  readonly detail: string;
}

export type PathAttempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: PathFailure };

export interface CanonicalizeOptions {
  readonly mustExist: boolean;
  readonly expect?: "FILE" | "DIRECTORY";
}

/**
 * سلطة المسارات: الجهة الوحيدة التي تحوّل مسارًا منطقيًا إلى مسار حقيقي مُثبَت،
 * وتقرر الاحتواء. لا تقرر السماح؛ تقرر ما هو المسار فعلًا.
 */
export interface PathAuthority {
  readonly platform: NodeJS.Platform;
  /** true فقط عندما تكون دلالات المسار هي دلالات ويندوز الحقيقية. */
  readonly nativeWindowsSemantics: boolean;
  canonicalize(logical: string, options: CanonicalizeOptions): PathAttempt<CanonicalPath>;
  /** يثبت أن الهدف داخل الجذر بعد حلّ الروابط على الجانبين. */
  containedIn(rootLogical: string, targetLogical: string, options: CanonicalizeOptions): PathAttempt<CanonicalPath>;
}

export function pathFailure(rejection: PathRejection, detail: string): PathFailure {
  return { rejection, detail };
}
