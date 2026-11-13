// حلّ هدف المنحة: من مسار منطقي إلى كائن حقيقي مُثبَت داخل جذر مُعد.
//
// استُخرج من نقطة الفرض لأن طرفين يحتاجانه في زمنين مختلفين: سطح الموافقة
// حين يبني ما سيُعرض على الإنسان، ونقطة الفرض حين تُصدر المنحة. أن يحلّ كلٌّ
// منهما بنفسه ليس تكرارًا بل هو الفحص: اختلاف الهوية بين الزمنين يعني أن
// الهدف تغيّر بعد الموافقة، وهذا ما يجب أن يُكتشف لا أن يُفترض غيابه.

import { W4ErrorCode, failWith, succeed, w4Error, type Attempt } from "../errors.js";
import type { ConfigService } from "../config/service.js";
import type { CanonicalPath, PathAuthority } from "../platform/path-authority.js";
import type { GrantOperation } from "./grant.js";

export interface TargetResolutionRequest {
  readonly path_authority: PathAuthority;
  readonly config: ConfigService;
  readonly operation: GrantOperation;
  readonly locator: string;
}

export interface ResolvedTarget {
  readonly canonical: CanonicalPath;
  readonly root: string;
  /** الجذور الحقيقية التي يجوز أن يقع الهدف تحتها، بشكلها المحلول. */
  readonly host_roots: readonly string[];
}

/** المفتاح المُعد الذي يحكم هذه العملية. القراءة والكتابة لا يتشاركان جذرًا. */
export function rootKeyFor(operation: GrantOperation): string {
  return operation === "READ_FILE"
    ? "polaris.filesystem.allowed_read_roots"
    : "polaris.filesystem.allowed_write_roots";
}

function scopeDenied<T>(detail: string): Attempt<T> {
  return failWith(
    w4Error(W4ErrorCode.FILESYSTEM_SCOPE_DENIED, "PEP", "That location is outside the permitted scope.", detail),
  );
}

/**
 * يحلّ الهدف داخل الجذور المُعدّة ويعيد شكله القانوني وهويته.
 * الفشل هنا فشل نطاق، لا فشل تقني: لا يوجد مسار يعيد هدفًا غير مُثبَت.
 */
export function resolveGrantTarget(request: TargetResolutionRequest): Attempt<ResolvedTarget> {
  const roots = (request.config.get(rootKeyFor(request.operation)) ?? []) as readonly string[];
  if (roots.length === 0) return scopeDenied(`no root is configured under ${rootKeyFor(request.operation)}`);

  let lastDetail = "no configured root contains the target";
  for (const root of roots) {
    const attempt = request.path_authority.containedIn(root, request.locator, {
      mustExist: request.operation === "READ_FILE",
      ...(request.operation === "READ_FILE" ? { expect: "FILE" as const } : {}),
    });
    if (attempt.ok) {
      return succeed({ canonical: attempt.value, root, host_roots: canonicalHostRoots(request.path_authority, roots) });
    }
    lastDetail = `${attempt.failure.rejection}: ${attempt.failure.detail}`;
  }
  return scopeDenied(lastDetail);
}

/** الجذور المُعدّة بشكلها الحقيقي. الجذر الذي لا يُحلّ لا يُمرَّر إلى المنفّذ. */
export function canonicalHostRoots(paths: PathAuthority, roots: readonly string[]): readonly string[] {
  const resolved: string[] = [];
  for (const root of roots) {
    const attempt = paths.canonicalize(root, { mustExist: true, expect: "DIRECTORY" });
    if (attempt.ok) resolved.push(attempt.value.host);
  }
  return resolved;
}
