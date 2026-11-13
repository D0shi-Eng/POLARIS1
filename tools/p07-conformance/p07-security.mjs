// فحص الأسرار في أدلّة Phase-07 ومخرجات الإصدار.
//
// يقرأ كل وثيقة قانونية، وكل سجل خام تحت evidence/p07-native، وكل ملف نصّي تحت
// release/rc، ويبحث فيها عن أشكال المفاتيح التي تعرفها أداة Phase-04 نفسها. المفتاح
// العام لتجهيزة التحديث مفتاح عام بطبعه، والمفتاح الخاص لا يُكتب أصلًا.
//
// الاستعمال: node p07-security.mjs --root <root> [--include-final-gate]

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { findSecretLeaks } from "../p04-conformance/p04-security.mjs";
import { argument, evidenceSuffix, header, P07_EVIDENCE, P07_FINAL_GATE, P07_TOOLS, RAW_DIRECTORY, RELEASE_DIRECTORY, writeEvidence } from "./p07-common.mjs";

const TEXT = [".json", ".txt", ".md", ".log"];

function textFiles(directory, found = []) {
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) textFiles(full, found);
    else if (TEXT.includes(extname(entry.name).toLowerCase()) && statSync(full).size <= 32 * 1024 * 1024) found.push(full);
  }
  return found;
}

export function scan(root, options = {}) {
  const suffix = evidenceSuffix();
  const documents = [...P07_EVIDENCE, ...(options.includeFinalGate === true ? [P07_FINAL_GATE] : [])].map((b) => join(root, "evidence", `${b}${suffix}.json`)).filter((p) => existsSync(p));
  const files = [...documents, ...textFiles(join(root, RAW_DIRECTORY)), ...textFiles(join(root, RELEASE_DIRECTORY))];
  const leaks = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // أشكال مفاتيح المزوّدين، ومعها كتلة مفتاح خاص بأي خوارزمية: مفتاح التجهيزة الخاص لا يُكتب أبدًا.
    const hits = [...findSecretLeaks(text), ...(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text) ? ["private-key-block"] : [])];
    if (hits.length > 0) leaks.push(`${relative(root, file).replace(/\\/g, "/")}: ${hits.join(",")}`);
  }
  return { scanned: files.length, documents: documents.length, leaks };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = scan(root, { includeFinalGate: process.argv.includes("--include-final-gate") });
  writeEvidence(join(root, RAW_DIRECTORY, "security.local.json"), { ...header(P07_TOOLS.security, root), ...result });
  console.log(`${result.leaks.length === 0 ? "CLEAN" : "LEAK_FOUND"}  ${result.scanned} file(s) scanned${result.leaks.length === 0 ? "" : `: ${result.leaks.join("; ")}`}`);
  process.exitCode = result.leaks.length === 0 ? 0 : 1;
}
