// حارس صنف العيب الذي أوقف P01-W2.
//
// العيب: `run.ps1` بلا BOM وفيه شرطة طويلة داخل نصّ مُقتبَس. Windows PowerShell
// يفكّ ترميز ملف بلا BOM بصفحة الرموز المحلية، فتصير بايتات UTF-8 للشرطة الطويلة
// (E2 80 94) ثلاثةَ محارف آخرها 0x94 — وهو علامة اقتباس مزدوجة يمنية يقبلها
// المحلّل مُنهيًا للنص. فينغلق النص في غير موضعه، ويبقى النص التالي مفتوحًا إلى
// آخر الملف، وتُبلَّغ الكتلة عن قوس معقوف ناقص.
//
// إصلاح الحرف الواحد يغلق الحالة. هذا الملف يغلق الصنف: أي محرف غير ASCII في
// سطر تنفيذي داخل أي ‎.ps1‎ يُرفض. التعليقات العربية تبقى كما هي — المحلّل لا
// يقرأ داخلها، وهي ليست مصدر العيب.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument } from "./p01-groups.mjs";

const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "target", "build-tests", "_to_delete", "_transfer", "graphify-out", "bin", "obj"]);

function walk(directory, extensions, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(join(directory, entry.name), extensions, found);
    } else if (extensions.includes(extname(entry.name).toLowerCase())) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

/**
 * يقسّم ملف PowerShell إلى أسطر تنفيذية وتعليقات.
 *
 * التقسيم بسيط عمدًا: كتل `<# #>` وأسطر `#`. لا يحاول محاكاة المحلّل، لأن حارسًا
 * يحاول أن يكون محلّلًا يخطئ بطريقتين بدل واحدة. ما يُفلت منه هو حالات لا تظهر
 * في هذا المستودع، والفحص يُبلغ عنها متحفّظًا لا متساهلًا.
 */
export function executableNonAscii(source) {
  const offenders = [];
  let inBlockComment = false;
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("<#")) inBlockComment = true;
    if (inBlockComment) {
      if (trimmed.includes("#>")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("#")) continue;

    // تعليق في آخر سطر تنفيذي: ما بعد # يُهمَل، وما قبله يُفحص.
    const hash = line.indexOf("#");
    const code = hash >= 0 ? line.slice(0, hash) : line;
    const characters = [...code].filter((character) => character.codePointAt(0) > 127);
    if (characters.length > 0) {
      offenders.push({
        line: index + 1,
        characters: [...new Set(characters)].map((character) => ({
          character,
          code_point: `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
        })),
        excerpt: code.trim().slice(0, 120),
      });
    }
  }
  return offenders;
}

/** فحص مستودع كامل. يعيد قائمة المخالفات مرتبة بالمسار. */
export function scanRepository(root) {
  const files = walk(join(root, "tools"), [".ps1"]).sort();
  const findings = [];
  for (const file of files) {
    const buffer = readFileSync(file);
    const source = buffer.toString("utf8");
    const offenders = executableNonAscii(source);
    findings.push({
      path: relative(root, file).split("\\").join("/"),
      bytes: statSync(file).size,
      has_bom: buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf,
      crlf: buffer.includes(0x0d),
      offenders,
      ok: offenders.length === 0,
    });
  }
  return findings;
}

// الحارس هو الحارس القانوني نفسه. مقارنة سلاسل يدوية هنا كانت ستعيد إنتاج عيب
// E9 حرفيًا: مسار ويندوز يُركَّب بشرطتين بدل ثلاث فلا يُنفَّذ الفرع ويخرج بصمت.
if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const findings = scanRepository(root);
  const failed = findings.filter((entry) => !entry.ok);
  for (const entry of failed) {
    for (const offender of entry.offenders) {
      console.error(
        `NON_ASCII_IN_EXECUTABLE_LINE ${entry.path}:${offender.line} ${offender.characters
          .map((c) => c.code_point)
          .join(",")} :: ${offender.excerpt}`,
      );
    }
  }
  console.log(`ascii discipline: ${findings.length - failed.length}/${findings.length} PowerShell files clean`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}
