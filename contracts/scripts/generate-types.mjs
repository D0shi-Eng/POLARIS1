// توليد أنواع TypeScript من مخططات JSON. مصدر الحقيقة هو schemas/ فقط.
// العملية قابلة لإعادة الإنتاج: نفس المدخلات تنتج نفس الملفات بايتًا ببايت،
// ويتحقق اختبار الانجراف من ذلك بإعادة التوليد ومقارنة الناتج.

import { readdir, readFile, writeFile, mkdir, rm, mkdtemp } from "node:fs/promises";
import { join, basename, dirname, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { compile } from "json-schema-to-typescript";

import { isDirectInvocation } from "./entrypoint.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const schemasDir = join(root, "schemas");
const outDir = join(root, "generated", "types");

/** المسار الذي يقرأ منه المولّد المخططات. يُصدَّر ليثبت اختبار أنه نفس جذر المُحقِّق. */
export const SCHEMAS_DIR = schemasDir;
/** المسار الذي يكتب إليه المولّد. */
export const OUT_DIR = outDir;

const HEADER = [
  "/* eslint-disable */",
  "/**",
  " * GENERATED FILE - DO NOT EDIT MANUALLY.",
  " * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.",
  " * Manual edits are detected by the generated-type drift test and fail the build.",
  " */",
  "",
].join("\n");

async function walk(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, found);
    else if (entry.isFile() && entry.name.endsWith(".schema.json")) found.push(full);
  }
  return found.sort();
}

function outputName(schemaFile) {
  return basename(schemaFile).replace(/\.schema\.json$/, "").replace(/\./g, "-") + ".ts";
}

// قواعد if/then/else الشرطية تربط حقلين أو أكثر ببعضهما. نظام أنواع TypeScript لا يعبّر عنها،
// والمولّد يترجمها إلى تقاطع مع { [k: string]: unknown } فيمحو شكل الكائن بالكامل.
// لذلك تُحذف قبل التوليد فقط. هذا حذف غير فاقد على مستوى الأنواع: لا يزيل شيئًا كان
// TypeScript ليعبّر عنه أصلًا. سلطة الفرض تبقى كاملة في المخطط وقت التشغيل عبر Ajv.
// ما لا يُحذف: oneOf/anyOf التي تصف أشكالًا كاملة، فهي تُترجم إلى اتحادات مميّزة صحيحة.
function stripTypeInexpressibleConditionals(node) {
  if (Array.isArray(node)) return node.map(stripTypeInexpressibleConditionals);
  if (node === null || typeof node !== "object") return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "allOf" && Array.isArray(value)) {
      const kept = value.filter((m) => !(m !== null && typeof m === "object" && "if" in m));
      if (kept.length > 0) out[key] = kept.map(stripTypeInexpressibleConditionals);
      continue;
    }
    if (key === "unevaluatedProperties") continue;
    out[key] = stripTypeInexpressibleConditionals(value);
  }
  return out;
}

// المرحلة الوسيطة تعيش في مجلد مؤقت خاص بنظام التشغيل، لا داخل شجرة المشروع:
// شجرة المشروع قد تكون على نظام ملفات يمنع الحذف، وملف أداة عابر لا يجوز أن يبقى
// في مسار قد يُخلط بمصدر الحقيقة. الشجرة تُنسخ كاملة بعد التجريد حتى تُحلّ المراجع
// النسبية بين الملفات إلى نسخ مجرّدة أيضًا؛ تجريد الملف الجذري وحده لا يكفي.
async function stageStrippedSchemas(stageDir) {
  const files = await walk(schemasDir);
  for (const abs of files) {
    const rel = relative(schemasDir, abs);
    const target = join(stageDir, rel);
    await mkdir(dirname(target), { recursive: true });
    const schema = JSON.parse(await readFile(abs, "utf8"));
    await writeFile(target, JSON.stringify(stripTypeInexpressibleConditionals(schema), null, 2), "utf8");
  }
  // وحدة أنواع تُولَّد لكل مخطط عقد مُصدَّر في جذر schemas — أي ‎*.vN.schema.json‎ —
  // ولا تُولَّد لملفات المفردات المشتركة. المفردات (‎common/‎ ومثيلاتها في الجذر مثل
  // ‎desktop-availability.schema.json‎) تُنشر داخل الوحدات التي تشير إليها عبر
  // declareExternallyReferenced، وتوليد وحدة مستقلة لها يُنتج واجهة فارغة بمفتاح
  // حرّ: نوعٌ يبدو عقدًا وليس عقدًا. القاعدة على الاسم لا على المجلد، لأن مُفكِّك
  // المراجع يحلّ كل شيء نسبةً إلى جذر المرحلة، فالمفردات لا يمكن أن تسكن مجلدًا فرعيًا.
  const CONTRACT_MODULE = /\.v[0-9]+\.schema\.json$/;
  return files.filter((f) => {
    const rel = relative(schemasDir, f);
    return !rel.includes(sep) && CONTRACT_MODULE.test(rel);
  });
}

/** يولّد الأنواع. `check: true` يحسب المحتوى دون كتابته، لاختبار الانجراف. */
export async function generate({ check = false } = {}) {
  const stageDir = await mkdtemp(join(tmpdir(), "polaris-codegen-"));
  const results = [];

  try {
    const rootSchemas = await stageStrippedSchemas(stageDir);

    for (const abs of rootSchemas) {
      const rel = relative(schemasDir, abs);
      const staged = join(stageDir, rel);
      const schema = JSON.parse(await readFile(staged, "utf8"));
      const body = await compile(schema, schema.title, {
        cwd: stageDir + sep,
        bannerComment: "",
        additionalProperties: false,
        declareExternallyReferenced: true,
        unreachableDefinitions: false,
        style: { singleQuote: false, semi: true },
      });
      results.push({ file: outputName(rel), content: HEADER + body });
    }

    if (!check) {
      // الكتابة فوق الملفات القائمة بدل حذف المجلد وإعادة إنشائه: بعض أنظمة الملفات
      // المضيفة تمنع unlink، والاستبدال في المكان كافٍ. الملفات المتقادمة يكشفها
      // اختبار الانجراف بمقارنة مجموعة الملفات، فلا تمر بصمت.
      await mkdir(outDir, { recursive: true });
      for (const { file, content } of results) {
        await writeFile(join(outDir, file), content, "utf8");
      }
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }

  return results;
}

/**
 * يقارن التوليد الطازج بالملفات على القرص دون كتابة. يعيد قائمة الانحرافات؛
 * القائمة الفارغة وحدها تعني عدم الانجراف.
 */
export async function checkDrift() {
  const expected = await generate({ check: true });
  const drift = [];
  const onDisk = existsSync(outDir) ? readdirSync(outDir).sort() : [];
  const wanted = expected.map((e) => e.file).sort();
  for (const file of onDisk) if (!wanted.includes(file)) drift.push(`${file}: stale (no schema)`);
  for (const { file, content } of expected) {
    const target = join(outDir, file);
    if (!existsSync(target)) drift.push(`${file}: missing`);
    else if (readFileSync(target, "utf8") !== content) drift.push(`${file}: content differs from schema`);
  }
  return { modules: expected.length, drift };
}

// نقطة الدخول. المقارنة تمر عبر isDirectInvocation لأن مقارنة القالب النصي السابقة
// لا تتطابق على Windows أبدًا، فكان التوليد يتحول إلى عملية صامتة لا تكتب شيئًا.
if (isDirectInvocation(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const { modules, drift } = await checkDrift();
    if (drift.length > 0) {
      console.error(`generated types drifted from schemas (${drift.length}):`);
      for (const line of drift) console.error(`  ${line}`);
      process.exitCode = 1;
    } else {
      console.log(`checked ${modules} type modules: no drift`);
    }
  } else {
    const written = await generate();
    console.log(`generated ${written.length} type modules into generated/types/`);
  }
}
