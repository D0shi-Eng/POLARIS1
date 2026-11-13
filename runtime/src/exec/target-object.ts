// كائن الهدف: الميكانيكا التي تجعل «ما تُحقَّق منه» و«ما قُرئ منه» كائنًا واحدًا.
//
// هذا الملف لا يعرف المنحة ولا القرار ولا السياسة. يعرف شيئًا واحدًا: كيف يُفتح
// كائن نظام ملفات مرة واحدة، وكيف تُؤخذ هويته وحجمه ونوعه وبايتاته من ذلك
// الكائن المفتوح نفسه، بلا إعادة فتح باسم المسار بعد التحقق.
//
// السبب المعماري (ADR-010، القسم SAME_OBJECT_VERIFY_AND_USE): كل تسلسل من
// الشكل «احلل الاسم ← تحقّق من الاسم ← افتح الاسم مرة أخرى» يترك سباقًا بين
// التحقق والاستعمال. النقطة الأخيرة في سلسلة التنفيذ لا يجوز أن تحمل ذلك
// السباق، فالتحقق هنا يقع على المقبض لا على الاسم.

import { closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { sep } from "node:path";

/** هوية كائن في نظام الملفات كما يبلّغها النظام: وحدة التخزين ورقم الكائن فيها. */
export interface ObjectIdentity {
  /** معرّف وحدة التخزين. قد يبلّغه النظام صفرًا، فيُعامل «غير متاح» لا «متطابق». */
  readonly volume: string;
  /** معرّف الكائن داخل وحدة التخزين. صفرٌ هنا يعني «لا هوية»، وهو فشل مغلق. */
  readonly file: string;
}

/** كائن مفتوح مرة واحدة، ومعه ما أُخذ منه هو لا من اسمه. */
export interface OpenedObject {
  readonly fd: number;
  readonly identity: ObjectIdentity;
  readonly is_file: boolean;
  readonly size: number;
}

export type OpenAttempt =
  | { readonly ok: true; readonly fd: number }
  | { readonly ok: false; readonly code: string; readonly errno: number; readonly syscall: string };

export type IdentityAttempt =
  | { readonly ok: true; readonly object: OpenedObject }
  | { readonly ok: false; readonly code: string; readonly detail: string };

export type ChainScan =
  | { readonly ok: true; readonly entries: number }
  | {
      readonly ok: false;
      readonly reason: "LINK_IN_PATH" | "UNEXPECTED_KIND" | "COMPONENT_UNREADABLE";
      readonly at: string;
      readonly code: string;
    };

/** ويندوز وماك يقارنان المسارات بلا حساسية للحالة. لينكس لا. */
export function foldForHost(value: string): string {
  return process.platform === "win32" || process.platform === "darwin" ? value.toUpperCase() : value;
}

function trimTrailingSeparators(value: string): string {
  let end = value.length;
  while (end > 1 && value[end - 1] === sep) end -= 1;
  return value.slice(0, end);
}

/** هل يقع المسار — نصًّا — تحت أحد الجذور. فحص تمهيدي قبل أي فتح. */
export function insideGrantedRoots(hostPath: string, roots: readonly string[]): boolean {
  return matchingRoot(hostPath, roots) !== undefined;
}

/**
 * الجذر الممنوح الذي يحتوي المسار، وأطولُه إن تداخلت الجذور: المسح يبدأ من
 * أضيق حدّ مأذون، فلا يُفحص مكوّن فوق الحدّ الذي تسري عليه المنحة.
 */
export function matchingRoot(hostPath: string, roots: readonly string[]): string | undefined {
  const path = foldForHost(hostPath);
  let best: string | undefined;
  let bestLength = -1;
  for (const root of roots) {
    const base = trimTrailingSeparators(root);
    const folded = foldForHost(base);
    if (folded.length === 0) continue;
    if (path === folded || path.startsWith(`${folded}${sep}`)) {
      if (folded.length > bestLength) {
        best = base;
        bestLength = folded.length;
      }
    }
  }
  return best;
}

/**
 * مسح مكوّنات المسار من الجذر الممنوح نزولًا إلى الهدف.
 *
 * لماذا من الجذر نزولًا وليس من جذر وحدة التخزين: كل مكوّن يُستعلَم عنه هنا يقع
 * داخل النطاق الممنوح، فالاستعلام حقٌّ تملكه الحاوية فعلًا. الاستعلام عن مجلد
 * أصل فوق الجذر حقٌّ لا تملكه حاوية بصفر قدرات ولا يجوز أن تملكه.
 *
 * وحدّ هذا المسح مُعلَن: هو فحص تمهيدي يرفض وصلةً ظاهرة قبل الفتح، وليس هو
 * الضمان. الضمان هو مطابقة الهوية على الكائن المفتوح بعده.
 */
export function scanChain(root: string, target: string): ChainScan {
  const base = trimTrailingSeparators(root);
  const rest = foldForHost(target) === foldForHost(base) ? "" : target.slice(base.length + 1);
  const parts = rest.length === 0 ? [] : rest.split(sep).filter((part) => part.length > 0);

  let current = base;
  let entries = 0;
  for (let index = 0; index <= parts.length; index += 1) {
    if (index > 0) current = `${current}${sep}${parts[index - 1] as string}`;
    const last = index === parts.length;
    try {
      const stat = lstatSync(current);
      entries += 1;
      if (stat.isSymbolicLink()) {
        return { ok: false, reason: "LINK_IN_PATH", at: current, code: "SYMBOLIC_LINK" };
      }
      if (!last && !stat.isDirectory()) {
        return { ok: false, reason: "UNEXPECTED_KIND", at: current, code: "NOT_A_DIRECTORY" };
      }
      if (last && !stat.isDirectory() && !stat.isFile()) {
        return { ok: false, reason: "UNEXPECTED_KIND", at: current, code: "NOT_A_REGULAR_OBJECT" };
      }
    } catch (error) {
      return {
        ok: false,
        reason: "COMPONENT_UNREADABLE",
        at: current,
        code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN",
      };
    }
  }
  return { ok: true, entries };
}

/** الفتح الواحد. رمز النظام يُنقل بنصّه: EPERM ليس ENOENT ليس EACCES. */
export function openOnce(hostPath: string): OpenAttempt {
  try {
    return { ok: true, fd: openSync(hostPath, "r") };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    return {
      ok: false,
      code: failure.code ?? "UNKNOWN",
      errno: typeof failure.errno === "number" ? failure.errno : 0,
      syscall: failure.syscall ?? "open",
    };
  }
}

/**
 * الهوية والنوع والحجم من المقبض نفسه، لا من الاسم.
 * `fstat` تعريفًا استعلامٌ عن الواصف المفتوح، وهذا هو ما يجعل ما بعده مُلزِمًا.
 */
export function identityOf(fd: number): IdentityAttempt {
  try {
    const stat = fstatSync(fd, { bigint: true });
    const identity: ObjectIdentity = { volume: stat.dev.toString(), file: stat.ino.toString() };
    if (identity.file === "0") {
      return { ok: false, code: "IDENTITY_UNAVAILABLE", detail: "the host reported no object identity for the handle" };
    }
    return {
      ok: true,
      object: { fd, identity, is_file: stat.isFile(), size: Number(stat.size) },
    };
  } catch (error) {
    return { ok: false, code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN", detail: "fstat failed" };
  }
}

/** نتيجة مقارنة الهوية، ومعها هل قُورنت وحدة التخزين أصلًا. */
export interface IdentityComparison {
  readonly equal: boolean;
  readonly volume_compared: boolean;
}

/**
 * المقارنة. رقم الكائن يُقارن دائمًا ولا يُتساهل فيه. أمّا وحدة التخزين فتُقارن
 * حين يبلّغها الطرفان بقيمة غير صفرية؛ صفرٌ من أحدهما يعني «لم يبلّغ» لا
 * «تطابق»، ويُسجَّل بهذه الصفة بدل أن يُقرأ نجاحًا.
 */
export function sameObject(expected: ObjectIdentity, observed: ObjectIdentity): IdentityComparison {
  const volumeComparable =
    expected.volume.length > 0 && observed.volume.length > 0 && expected.volume !== "0" && observed.volume !== "0";
  const volumeEqual = !volumeComparable || expected.volume === observed.volume;
  return { equal: expected.file === observed.file && volumeEqual, volume_compared: volumeComparable };
}

/** قراءة من الكائن المفتوح نفسه، والسقف مفروض على ما قُرئ لا على ما وعد به fstat. */
export function readWithCeiling(fd: number, ceiling: number): { bytes: Buffer; truncated: boolean } {
  const buffer = Buffer.alloc(ceiling + 1);
  let filled = 0;
  for (;;) {
    const read = readSync(fd, buffer, filled, buffer.byteLength - filled, null);
    if (read <= 0) break;
    filled += read;
    if (filled >= buffer.byteLength) break;
  }
  const truncated = filled > ceiling;
  return { bytes: buffer.subarray(0, truncated ? ceiling : filled), truncated };
}

/** إغلاق حتمي. فشل الإغلاق يُبلَّغ ولا يُبتلع. */
export function closeObject(fd: number): boolean {
  try {
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}
