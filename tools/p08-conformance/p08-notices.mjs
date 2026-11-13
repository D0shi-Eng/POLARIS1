// يولّد THIRD_PARTY_NOTICES.md من الواقع: رسم اعتماديات حزمة المنتج في Cargo (بلا اعتماديات التطوير)
// والحزم التي يشحنها العارض، باسم كل منها وإصدارها ورخصتها ومستودعها، ويحكم على توافق كل رخصة مع
// AGPL-3.0-or-later. رخصة غير معروفة أو غير متوافقة تُسجَّل ولا تُخفى.
//
// الاستعمال: node p08-notices.mjs --root <root> [--check]

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument } from "./p08-common.mjs";

/** رخص يُسمح بدمجها في عمل AGPL-3.0-or-later (مباشرة، أو بخيار متوافق في تعبير OR). */
export const COMPATIBLE = Object.freeze(["MIT", "MIT-0", "Apache-2.0", "Apache-2.0 WITH LLVM-exception", "BSD-1-Clause", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "0BSD", "Unlicense", "CC0-1.0", "Unicode-3.0", "Unicode-DFS-2016", "MPL-2.0", "LGPL-2.1-or-later", "AGPL-3.0-or-later", "GPL-3.0-or-later", "BSL-1.0"]);

/** يطبّع الصيغ القديمة («MIT/Apache-2.0»، «Apache-2.0 / MIT») إلى تعبير SPDX. */
export function normalise(expression) {
  return String(expression ?? "").replace(/\s*\/\s*/g, " OR ").trim();
}

/** متوافق إن كان لأحد بدائل OR كلُّ حدود AND متوافقة. */
export function compatible(expression) {
  const text = normalise(expression).replace(/[()]/g, "");
  if (text === "") return false;
  return text.split(/\s+OR\s+/).some((alt) => alt.split(/\s+AND\s+/).every((term) => COMPATIBLE.includes(term.trim())));
}

function cargoRows(root) {
  const metadata = JSON.parse(execFileSync(process.platform === "win32" ? "cargo.exe" : "cargo", ["metadata", "--format-version", "1", "--offline", "--filter-platform", "x86_64-pc-windows-msvc"], { cwd: join(root, "desktop", "host"), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
  const byId = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const start = metadata.packages.filter((p) => ["polaris-host", "polaris-host-core", "polaris-host-providers", "polaris-host-win"].includes(p.name)).map((p) => p.id);
  const seen = new Set();
  const stack = [...start];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null || k.kind === "build")) stack.push(dep.pkg);
    }
  }
  return [...seen]
    .map((id) => byId.get(id))
    .filter((p) => p !== undefined && p.source !== null)
    .map((p) => ({ ecosystem: "crates.io", name: p.name, version: p.version, license: normalise(p.license ?? (p.license_file ? `SEE ${p.license_file}` : "")), repository: p.repository ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function npmRows(root) {
  const rows = [];
  for (const dir of ["desktop/renderer", "contracts", "runtime"]) {
    const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      const path = join(root, dir, "node_modules", name, "package.json");
      if (!existsSync(path)) {
        rows.push({ ecosystem: "npm", name, version: "not installed", license: "", repository: "" });
        continue;
      }
      const m = JSON.parse(readFileSync(path, "utf8"));
      const repository = typeof m.repository === "string" ? m.repository : (m.repository?.url ?? "");
      if (!rows.some((r) => r.name === name && r.version === m.version)) rows.push({ ecosystem: "npm", name, version: m.version, license: normalise(typeof m.license === "string" ? m.license : m.license?.type ?? ""), repository });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function inventory(root) {
  const rows = [...cargoRows(root), ...npmRows(root)];
  const incompatible = rows.filter((r) => !compatible(r.license) && !r.name.startsWith("@polaris/"));
  return { rows, incompatible };
}

// شيفرة أُعيدت كتابتها من مشروع آخر (لا اعتمادية في الرسم)، فلا يكتشفها الرسم وتُكتب هنا يدويًّا مع إشعارها.
const ADAPTED_SOURCES = Object.freeze([
  {
    project: "agentmemory",
    license: "Apache-2.0",
    copyright: "Copyright 2026 Rohit Ghumare",
    source: "https://github.com/rohitg00/agentmemory",
    commit: "70517d2bdf302a0aed11ca470151ee854e74c678",
    what: "the English stemmer (`src/state/stemmer.ts`) rewritten in Rust as `desktop/host/core/src/p05/memory/stem_en.rs`; the BM25 parameters and formula (`src/state/search-index.ts`) and the RRF constant k = 60 (`src/state/hybrid-search.ts`) reused in `bm25.rs` and `fusion.rs`. Changed: Rust port, stemming limited to lower-case Latin words, the index is built per query from scope-visible memories only.",
    licenceFile: "docs/licenses/agentmemory-Apache-2.0.txt",
  },
  {
    project: "agency-agents",
    license: "MIT",
    copyright: "Copyright (c) 2025 AgentLand Contributors",
    source: "https://github.com/msitarzewski/agency-agents",
    commit: "4e3ac3ca6604c75113f52c695dbddcc7af928b46",
    what: "the working rules of `support/support-executive-summary-generator.md` (quantified findings, prioritised recommendations with owner, timeline and expected result, no assumptions beyond the data, a word limit, next steps) adapted in our own words into the method and checks of the `writing.report-writer` specialist (`desktop/host/core/src/p03/specialists/writing.json`).",
    licenceFile: "docs/licenses/agency-agents-MIT.txt",
  },
]);

export function render(rows) {
  const lines = [
    "# Third-party notices",
    "",
    "POLARIS is licensed under the GNU Affero General Public License v3.0 or later (see `LICENSE`).",
    "It is built on the open-source components listed below, each under its own licence.",
    "The list is generated from the dependency graph of the shipped crates and the packages the",
    "renderer, contracts and runtime ship (`tools/p08-conformance/p08-notices.mjs`); development-only",
    "dependencies are not shipped and are not listed. The full licence text of each component is",
    "distributed with that component's source.",
    "",
    `Components: ${rows.length}.`,
    "",
    "| Ecosystem | Component | Version | Licence | Source |",
    "|---|---|---|---|---|",
  ];
  for (const r of rows) lines.push(`| ${r.ecosystem} | ${r.name} | ${r.version} | ${r.license || "unknown"} | ${r.repository.replace(/^git\+/, "").replace(/\.git$/, "")} |`);
  lines.push("", "## Adapted source", "");
  for (const a of ADAPTED_SOURCES) lines.push(`- **${a.project}** (${a.license}, ${a.copyright}), ${a.source} at \`${a.commit}\`: ${a.what} Licence text: \`${a.licenceFile}\`.`);
  return `${lines.join("\n")}\n`;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const { rows, incompatible } = inventory(root);
  const text = render(rows);
  const path = join(root, "THIRD_PARTY_NOTICES.md");
  if (process.argv.includes("--check")) {
    const same = existsSync(path) && readFileSync(path, "utf8") === text;
    console.log(`${same ? "UP_TO_DATE" : "STALE"}  ${rows.length} components; incompatible ${incompatible.length}`);
    process.exitCode = same && incompatible.length === 0 ? 0 : 1;
  } else {
    writeFileSync(path, text);
    console.log(`written ${rows.length} components; incompatible ${incompatible.length}${incompatible.map((r) => `\n  ${r.name}@${r.version}: ${r.license}`).join("")}`);
    process.exitCode = incompatible.length === 0 ? 0 : 1;
  }
}
