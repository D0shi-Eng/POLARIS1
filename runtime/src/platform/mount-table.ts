// جدول الربط بين الفضاء المنطقي لـPOLARIS (مسارات ويندوز) والفضاء الحقيقي للمضيف.
//
// على ويندوز الربط هو الهوية: D:\POLARIS يقابل D:\POLARIS.
// على مضيف اختبار غير ويندوزي يقابل جذرًا حقيقيًا في نظام ملفات المضيف،
// حتى تُثبَت دلالات الاحتواء والفرض على نظام ملفات حقيقي لا على محاكاة نصية.
//
// هذا الربط أداة منصة وليس امتيازًا: لا يوسّع نطاقًا، ولا يُستشار في قرار السياسة.

import { parseWindowsPath, type WindowsPathParts } from "./windows-path-rules.js";

export interface Mount {
  /** جذر منطقي بصيغة ويندوز، مثل "D:\\POLARIS". */
  readonly logical_root: string;
  /** مسار حقيقي مطلق على المضيف الحالي. */
  readonly host_root: string;
}

export interface ResolvedMount {
  readonly mount: Mount;
  readonly logical: WindowsPathParts;
  /** المقاطع الواقعة تحت جذر الربط. */
  readonly relative_segments: readonly string[];
}

export class MountTable {
  readonly #mounts: readonly Mount[];
  readonly #hostSeparator: string;

  public constructor(mounts: readonly Mount[], hostSeparator: string) {
    this.#mounts = mounts;
    this.#hostSeparator = hostSeparator;
  }

  public mounts(): readonly Mount[] {
    return this.#mounts;
  }

  /** الربط الهوياتي المستعمل على ويندوز: الفضاء المنطقي هو الفضاء الحقيقي. */
  public static identity(logicalRoots: readonly string[]): MountTable {
    return new MountTable(
      logicalRoots.map((root) => ({ logical_root: root, host_root: root })),
      "\\",
    );
  }

  /** يجد الربط الأطول المطابق. الأطول يفوز حتى يكون ربط فرعي أدق من ربط أعلى. */
  public resolve(logicalPath: string): ResolvedMount | undefined {
    const parsed = parseWindowsPath(logicalPath);
    if (!parsed.ok) return undefined;

    let best: ResolvedMount | undefined;
    for (const mount of this.#mounts) {
      const root = parseWindowsPath(mount.logical_root);
      if (!root.ok) continue;
      if (root.parts.drive !== parsed.parts.drive) continue;
      if (parsed.parts.segments.length < root.parts.segments.length) continue;
      const matches = root.parts.segments.every(
        (segment, index) => segment.toUpperCase() === (parsed.parts.segments[index] as string).toUpperCase(),
      );
      if (!matches) continue;
      const candidate: ResolvedMount = {
        mount,
        logical: parsed.parts,
        relative_segments: parsed.parts.segments.slice(root.parts.segments.length),
      };
      if (best === undefined || root.parts.segments.length > best.logical.segments.length - best.relative_segments.length) {
        best = candidate;
      }
    }
    return best;
  }

  /** المسار الحقيقي المقابل، بلا لمس نظام الملفات. */
  public toHostPath(resolved: ResolvedMount): string {
    const base = resolved.mount.host_root.replace(/[\\/]+$/, "");
    if (resolved.relative_segments.length === 0) return base === "" ? this.#hostSeparator : base;
    return `${base}${this.#hostSeparator}${resolved.relative_segments.join(this.#hostSeparator)}`;
  }
}
