// فحص النصوص: لا نصّ موجَّه للمستخدم مكتوب داخل مكوّن.
//
// الفحص يقرأ المصدر لا السلوك، لأن هذا ادعاء عن الشيفرة نفسها: نصّ واحد مكتوب في
// مكوّن يكفي ليظهر بالإنجليزية في واجهة عربية، ولن يكشفه أي اختبار سلوكي.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { test } from "node:test";

// يُشغَّل هذا الاختبار من مجلد بناء، فالمصدر يُبحث عنه صعودًا لا بمسار ثابت.
function findSourceRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, "src");
    try {
      // الشرط هو وجود مصدر TypeScript فعلًا: مجلد البناء يحمل الأسماء نفسها
      // ولا يحمل الامتدادات، ولو قُبل لقاس الفحصُ ناتجَ الترجمة بدل المصدر.
      if (readdirSync(join(candidate, "ipc")).some((name) => name.endsWith(".ts"))) return candidate;
    } catch {
      // نصعد.
    }
    current = join(current, "..");
  }
  throw new Error("the renderer source tree was not found from " + start);
}

const SOURCE_ROOT = findSourceRoot(join(__dirname, ".."));

/** مجلدات مستثناة بسبب طبيعتها لا بسبب صعوبتها. */
const EXCLUDED = ["generated", "localization"];

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED.includes(entry.name)) continue;
      walk(join(directory, entry.name), found);
    } else if ([".ts", ".tsx"].includes(extname(entry.name))) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

/** يزيل التعليقات حتى لا تُحسب التعليقات العربية نصوصًا معروضة. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const LETTERS = /[A-Za-z\u0600-\u06FF]{2,}/;

test("no component renders literal text between JSX tags", () => {
  const offenders: string[] = [];
  for (const file of walk(SOURCE_ROOT)) {
    if (extname(file) !== ".tsx") continue;
    const source = stripComments(readFileSync(file, "utf8"));
    // الفحص سطرًا سطرًا: مطابقة عابرة للأسطر تخلط بين نصّ JSX وبين أقواس الأنواع
    // العامة في TypeScript، فتُبلغ عن عيب غير موجود. والسهم `=>` يُزال أولًا للسبب نفسه.
    source.split("\n").forEach((line, index) => {
      const cleaned = line.replace(/=>/g, "");
      for (const match of cleaned.matchAll(/>([^<>{}]+)</g)) {
        const text = (match[1] ?? "").trim();
        if (text !== "" && LETTERS.test(text)) {
          offenders.push(`${relative(SOURCE_ROOT, file)}:${index + 1}: ${text}`);
        }
      }
    });
  }
  assert.deepEqual(offenders, [], `literal user-facing text found:\n${offenders.join("\n")}`);
});

test("no accessible name is a literal string", () => {
  const offenders: string[] = [];
  for (const file of walk(SOURCE_ROOT)) {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(/(aria-label|aria-description|title|alt|placeholder)\s*=\s*"([^"]*)"/g)) {
      offenders.push(`${relative(SOURCE_ROOT, file)}: ${match[1]}="${match[2]}"`);
    }
  }
  assert.deepEqual(offenders, [], `literal accessible names found:\n${offenders.join("\n")}`);
});

test("no Arabic text survives inside a string literal outside the language files", () => {
  const offenders: string[] = [];
  for (const file of walk(SOURCE_ROOT)) {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(/"([^"\\]*[\u0600-\u06FF][^"\\]*)"/g)) {
      offenders.push(`${relative(SOURCE_ROOT, file)}: ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, [], `Arabic string literals outside the catalogs:\n${offenders.join("\n")}`);
});

test("the source tree the scan covers is not empty", () => {
  const files = walk(SOURCE_ROOT);
  assert.ok(files.length >= 15, `the scan only found ${files.length} files, which suggests a broken walk`);
  assert.ok(files.some((file) => file.endsWith(".tsx")), "no component files were scanned");
});
