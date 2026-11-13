// تطبيق سلطة المسارات على نظام ملفات حقيقي.
//
// التطبيع على مرحلتين مقصودتين:
//   1) نحوية: قواعد ويندوز الخالصة ترفض كل شكل غامض قبل أي وصول للقرص.
//   2) حقيقية: realpath يحلّ كل رابط/وصلة، والاحتواء يُفحص على المسار المحلول.
// اختلاف النتيجتين (داخل منطقيًا، خارج حقيقيًا) يُسمّى SYMLINK_ESCAPE ولا يُبتلع.

import { realpathSync, statSync } from "node:fs";
import { dirname, basename, sep } from "node:path";

import { MountTable } from "./mount-table.js";
import {
  isLogicallyInside,
  parseWindowsPath,
  type WindowsPathParts,
} from "./windows-path-rules.js";
import {
  pathFailure,
  type CanonicalizeOptions,
  type CanonicalPath,
  type HostObjectIdentity,
  type PathAttempt,
  type PathAuthority,
} from "./path-authority.js";

function fail<T>(rejection: Parameters<typeof pathFailure>[0], detail: string): PathAttempt<T> {
  return { ok: false, failure: pathFailure(rejection, detail) };
}

interface RealResolution {
  readonly host: string;
  readonly exists: boolean;
  readonly kind: CanonicalPath["kind"];
  /** هوية الكائن القائم، تُرصد هنا مرة واحدة وتُحمل في المنحة. */
  readonly identity?: HostObjectIdentity;
}

export class HostPathAuthority implements PathAuthority {
  readonly #mounts: MountTable;
  readonly #caseInsensitive: boolean;

  public readonly platform: NodeJS.Platform;
  public readonly nativeWindowsSemantics: boolean;

  public constructor(mounts: MountTable, platform: NodeJS.Platform = process.platform) {
    this.#mounts = mounts;
    this.platform = platform;
    this.nativeWindowsSemantics = platform === "win32";
    // خارج ويندوز نُبقي المقارنة حسّاسة للحالة: افتراض عدم الحساسية على مضيف حسّاس
    // يجعل مسارين مختلفين يبدوان واحدًا، وهو خطأ في الاتجاه الخطير.
    this.#caseInsensitive = platform === "win32" || platform === "darwin";
  }

  public canonicalize(logical: string, options: CanonicalizeOptions): PathAttempt<CanonicalPath> {
    const parsed = parseWindowsPath(logical);
    if (!parsed.ok) return fail(parsed.rejection, parsed.detail);

    const resolved = this.#mounts.resolve(parsed.parts.normalised);
    if (resolved === undefined) return fail("UNKNOWN_MOUNT", `no mount covers ${parsed.parts.normalised}`);

    const hostPath = this.#mounts.toHostPath(resolved);
    const real = this.#resolveReal(hostPath);
    if (!real.ok) return real as PathAttempt<CanonicalPath>;

    const value: CanonicalPath =
      real.value.identity === undefined
        ? {
            logical: parsed.parts.normalised,
            host: real.value.host,
            exists: real.value.exists,
            kind: real.value.kind,
          }
        : {
            logical: parsed.parts.normalised,
            host: real.value.host,
            exists: real.value.exists,
            kind: real.value.kind,
            identity: real.value.identity,
          };

    if (options.mustExist && !value.exists) return fail("NOT_FOUND", `${value.logical} does not exist`);
    if (options.expect === "FILE" && value.exists && value.kind !== "FILE") {
      return fail("NOT_A_FILE", `${value.logical} is ${value.kind}`);
    }
    if (options.expect === "DIRECTORY" && value.exists && value.kind !== "DIRECTORY") {
      return fail("NOT_A_DIRECTORY", `${value.logical} is ${value.kind}`);
    }
    return { ok: true, value };
  }

  public containedIn(
    rootLogical: string,
    targetLogical: string,
    options: CanonicalizeOptions,
  ): PathAttempt<CanonicalPath> {
    const rootParsed = parseWindowsPath(rootLogical);
    if (!rootParsed.ok) return fail(rootParsed.rejection, `root: ${rootParsed.detail}`);
    const targetParsed = parseWindowsPath(targetLogical);
    if (!targetParsed.ok) return fail(targetParsed.rejection, `target: ${targetParsed.detail}`);

    // الخط الأول: الاحتواء المنطقي. رخيص ويرفض أغلب المحاولات قبل لمس القرص.
    if (!isLogicallyInside(rootParsed.parts as WindowsPathParts, targetParsed.parts as WindowsPathParts)) {
      return fail("ESCAPES_ROOT", `${targetParsed.parts.normalised} is not under ${rootParsed.parts.normalised}`);
    }

    const root = this.canonicalize(rootParsed.parts.normalised, { mustExist: true, expect: "DIRECTORY" });
    if (!root.ok) return root;
    const target = this.canonicalize(targetParsed.parts.normalised, options);
    if (!target.ok) return target;

    // الخط الثاني: الاحتواء الحقيقي بعد حلّ الروابط. هنا تُكشف الوصلات والروابط.
    if (!this.#hostContains(root.value.host, target.value.host)) {
      return fail(
        "SYMLINK_ESCAPE",
        `${target.value.logical} resolves outside ${root.value.logical} after link resolution`,
      );
    }
    return target;
  }

  #hostContains(root: string, target: string): boolean {
    const fold = (value: string): string => (this.#caseInsensitive ? value.toUpperCase() : value);
    const base = fold(root.replace(new RegExp(`\\${sep}+$`), ""));
    const path = fold(target);
    return path === base || path.startsWith(`${base}${sep}`);
  }

  /**
   * يحلّ المسار الحقيقي. إن كان الهدف غير موجود يُحلّ أبوه ويُركّب الاسم عليه،
   * حتى يكون إنشاء ملف جديد قابلًا للفرض بنفس دقة قراءة ملف قائم.
   */
  #resolveReal(hostPath: string): PathAttempt<RealResolution> {
    try {
      const real = realpathSync(hostPath);
      // الهوية تُؤخذ بدقة 64 بت: رقم الكائن على ويندوز يتجاوز مدى العدد الآمن.
      const stat = statSync(real, { bigint: true });
      const kind: CanonicalPath["kind"] = stat.isFile() ? "FILE" : stat.isDirectory() ? "DIRECTORY" : "OTHER";
      const identity: HostObjectIdentity = { volume: stat.dev.toString(), file: stat.ino.toString() };
      return { ok: true, value: { host: real, exists: true, kind, identity } };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        return fail("CANONICALIZATION_FAILED", `${code ?? "unknown"} while resolving path`);
      }
    }

    const parent = dirname(hostPath);
    const name = basename(hostPath);
    if (name.length === 0 || parent === hostPath) return fail("NOT_FOUND", "path has no resolvable parent");
    try {
      const realParent = realpathSync(parent);
      const stat = statSync(realParent, { bigint: true });
      if (!stat.isDirectory()) return fail("NOT_A_DIRECTORY", "parent is not a directory");
      return { ok: true, value: { host: `${realParent}${sep}${name}`, exists: false, kind: "ABSENT" } };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOENT"
        ? fail("PARENT_NOT_FOUND", "parent directory does not exist")
        : fail("CANONICALIZATION_FAILED", `${code ?? "unknown"} while resolving parent`);
    }
  }
}
