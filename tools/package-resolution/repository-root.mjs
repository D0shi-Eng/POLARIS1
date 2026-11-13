// اكتشاف جذر المستودع لبوابة الحزم.
//
// نفس عقد الإقلاع المستعمل في مشغّل ويندوز: لا آلية واحدة، ولا اعتماد على
// مجلد العمل وحده، وكل مرشّح يُتحقق منه بعلامات المستودع قبل قبوله.
//
// هذا الملف يعرف الجذر فقط. لا يعرف شيئًا عن الحزم ولا عن الروابط.

import { existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

/** علامات لا يجتمعن إلا في مستودع POLARIS. */
export const REPOSITORY_MARKERS = [
  join("contracts", "package.json"),
  join("contracts", "schemas"),
  join("runtime", "package.json"),
  join("desktop", "host"),
  join("tools", "w4-windows-conformance", "windows-probes.mjs"),
];

export function missingMarkers(root) {
  return REPOSITORY_MARKERS.filter((marker) => !existsSync(join(root, marker)));
}

function argumentRoot(argv) {
  const index = argv.indexOf("--root");
  if (index >= 0 && typeof argv[index + 1] === "string") return argv[index + 1];
  const inline = argv.find((a) => a.startsWith("--root="));
  return inline === undefined ? undefined : inline.slice("--root=".length);
}

/** يصعد من موقع هذا الملف بحثًا عن علامات المستودع. */
function rootFromModuleLocation() {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (missingMarkers(current).length === 0) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/**
 * يرتّب المصادر ويُرجع سجلًا بما جُرِّب وما فاز. لا يُرجع مسارًا غير مُتحقَّق
 * منه، ولا سلسلة فارغة. وسيطة صريحة خاطئة تفشل بصوت عالٍ بلا احتياطي.
 */
export function resolveRepositoryRoot(argv) {
  const attempts = [];
  const consider = (source, candidate) => {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      attempts.push({ source, candidate: "", status: "EMPTY", missing_markers: [] });
      return undefined;
    }
    const resolved = resolvePath(candidate);
    if (!existsSync(resolved)) {
      attempts.push({ source, candidate: resolved, status: "NOT_A_DIRECTORY", missing_markers: [] });
      return undefined;
    }
    const missing = missingMarkers(resolved);
    if (missing.length > 0) {
      attempts.push({ source, candidate: resolved, status: "NOT_A_POLARIS_REPOSITORY", missing_markers: missing });
      return undefined;
    }
    attempts.push({ source, candidate: resolved, status: "ACCEPTED", missing_markers: [] });
    return resolved;
  };

  const explicit = argumentRoot(argv);
  if (explicit !== undefined) {
    return { root: consider("--root argument", explicit), attempts };
  }

  const ordered = [
    ["module location", rootFromModuleLocation()],
    ["POLARIS_ROOT environment variable", process.env.POLARIS_ROOT],
    ["current directory", process.cwd()],
  ];
  for (const [source, candidate] of ordered) {
    if (candidate === undefined) continue;
    const accepted = consider(source, candidate);
    if (accepted !== undefined) return { root: accepted, attempts };
  }
  return { root: undefined, attempts };
}
