// فحص جاهزية المستودع قبل أي رفع: ملفات الترخيص، والاقرأني بلغتين، والتوثيق العامّ ومخطّطاته
// الموسومة بحالتها، و.gitignore، وقائمة الإشعارات المولّدة، وإعلانات الترخيص في الحزم.
//
// لا يرفع شيئًا ولا ينشئ مستودعًا: يقيس ما في المجلد فقط.
//
// الاستعمال: node p08-repository.mjs --root <root>

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, header, P08_TOOLS, RAW_DIRECTORY, writeEvidence } from "./p08-common.mjs";
import { compatible, inventory, render } from "./p08-notices.mjs";

export const REQUIRED_FILES = Object.freeze(["LICENSE", "COPYRIGHT", "NOTICE", "THIRD_PARTY_NOTICES.md", "TRADEMARK.md", "README.md", "README.ar.md", ".gitignore"]);
export const REQUIRED_IGNORES = Object.freeze(["node_modules/", "target/", "evidence/", "_transfer/", "*.local.json", "*.db", ".env", "*.pem", "docs/phases/", "release/", "*.exe"]);
/** وسوم الحالة المسموحة لكل مخطّط عامّ. مخطّط بلا وسم يوحي بما لم يُبنَ. */
export const DIAGRAM_STATUSES = Object.freeze(["IMPLEMENTED", "FOUNDATION_ONLY", "PLANNED", "NOT_IMPLEMENTED"]);

function read(root, rel) {
  const path = join(root, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** مخطّطات Mermaid في ملفات Markdown تحت مجلد، ولكلٍّ وسم حالته في السطر الذي يسبقه. */
export function diagrams(root, dir) {
  const full = join(root, dir);
  const out = [];
  if (!existsSync(full)) return out;
  for (const name of readdirSync(full).filter((n) => n.endsWith(".md")).sort()) {
    const lines = readFileSync(join(full, name), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.trim() !== "```mermaid") return;
      const before = lines.slice(Math.max(0, i - 4), i).join(" ");
      const status = DIAGRAM_STATUSES.find((s) => new RegExp(`\\b${s}\\b`).test(before)) ?? null;
      out.push({ file: `${dir}/${name}`, line: i + 1, status });
    });
  }
  return out;
}

export function check(root) {
  const files = REQUIRED_FILES.map((f) => ({ file: f, present: read(root, f) !== null }));
  const license = read(root, "LICENSE") ?? "";
  const gitignore = read(root, ".gitignore") ?? "";
  const ignores = REQUIRED_IGNORES.map((p) => ({ pattern: p, present: gitignore.split("\n").map((l) => l.trim()).includes(p) }));
  const en = diagrams(root, "docs/public/en");
  const ar = diagrams(root, "docs/public/ar");
  const cargo = read(root, "desktop/host/Cargo.toml") ?? "";
  const packages = ["desktop/renderer", "contracts", "runtime"].map((d) => ({ package: d, license: JSON.parse(read(root, `${d}/package.json`) ?? "{}").license ?? null }));
  let notices = { measured: false };
  try {
    const { rows, incompatible } = inventory(root);
    notices = { measured: true, components: rows.length, incompatible: incompatible.map((r) => `${r.name}@${r.version} ${r.license}`), up_to_date: read(root, "THIRD_PARTY_NOTICES.md") === render(rows) };
  } catch (error) {
    notices = { measured: false, error: String(error?.message ?? error).slice(0, 300) };
  }
  const readme = read(root, "README.md") ?? "";
  const readmeAr = read(root, "README.ar.md") ?? "";
  const result = {
    files,
    license_is_agpl3: /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/.test(license),
    spdx: { cargo_workspace: /license = "AGPL-3.0-or-later"/.test(cargo), packages, all_packages_agpl: packages.every((p) => p.license === "AGPL-3.0-or-later") },
    trademark_grants_nothing: /No trademark licence is granted/.test(read(root, "TRADEMARK.md") ?? "") && !/®|registered trademark of/i.test(read(root, "TRADEMARK.md") ?? ""),
    ignores,
    readme: { english_links_arabic: readme.includes("README.ar.md"), arabic_links_english: readmeAr.includes("README.md"), arabic_is_rtl: /dir="rtl"/.test(readmeAr), claims_no_manus_parity: !/manus/i.test(`${readme}${readmeAr}`) || /NOT_MEASURED/.test(`${readme}${readmeAr}`) },
    diagrams: { english: en.length, arabic: ar.length, unlabelled: [...en, ...ar].filter((d) => d.status === null), by_status: Object.fromEntries(DIAGRAM_STATUSES.map((s) => [s, en.filter((d) => d.status === s).length])) },
    notices,
    license_compatibility_rule: compatible("MIT OR Apache-2.0") && !compatible("GPL-2.0-only"),
  };
  result.verdict =
    files.every((f) => f.present) &&
    result.license_is_agpl3 &&
    result.spdx.cargo_workspace &&
    result.spdx.all_packages_agpl &&
    result.trademark_grants_nothing &&
    ignores.every((i) => i.present) &&
    result.readme.english_links_arabic &&
    result.readme.arabic_links_english &&
    result.readme.arabic_is_rtl &&
    result.readme.claims_no_manus_parity &&
    en.length >= 24 &&
    ar.length >= 24 &&
    result.diagrams.unlabelled.length === 0 &&
    notices.measured === true &&
    notices.up_to_date === true &&
    notices.incompatible.length === 0
      ? "PASS"
      : "FAIL";
  return result;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = check(root);
  writeEvidence(join(root, RAW_DIRECTORY, "repository.local.json"), { ...header(P08_TOOLS.repository), ...result });
  console.log(`${result.verdict}  files ${result.files.filter((f) => f.present).length}/${result.files.length}; diagrams en ${result.diagrams.english} ar ${result.diagrams.arabic} unlabelled ${result.diagrams.unlabelled.length}; notices ${result.notices.measured ? `${result.notices.components} up-to-date ${result.notices.up_to_date} incompatible ${result.notices.incompatible.length}` : "not measured"}`);
  for (const f of result.files.filter((x) => !x.present)) console.log(`  missing: ${f.file}`);
  for (const i of result.ignores.filter((x) => !x.present)) console.log(`  .gitignore lacks: ${i.pattern}`);
  process.exitCode = result.verdict === "PASS" ? 0 : 1;
}
