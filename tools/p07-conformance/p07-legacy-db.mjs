// ينشئ قاعدة POLARIS قديمة حقيقية (مخطط v1 أو غيره) لاختبار الترقية الأصلي.
//
// المخطط لا يُكتب هنا باليد: يُقرأ من ثوابت الترحيل في المنتج نفسه
// (`desktop/host/core/src/storage/migrations.rs`)، وتُنفَّذ الخطوات v1..vN بالترتيب في
// SQLite الذي يحمله Node، ثم يُكتب صف مشروع باسم عربي، ويُضبط `user_version`. هكذا
// تكون القاعدة القديمة هي ما كان يكتبه بناء قديم فعلًا، لا ما نظنّه.
//
// الاستعمال: node p07-legacy-db.mjs --root <root> --out <file> [--version 1]

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument } from "./p07-common.mjs";

export const LEGACY_PROJECT_NAME = "مشروع قديم من v1";
export const LEGACY_PROJECT_ID = "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a";

/** يستخرج نصوص الترحيل V1..Vn من مصدر Rust كما هي. */
export function migrationScripts(source) {
  const scripts = new Map();
  for (const match of source.matchAll(/const V(\d+): &str = r#"([\s\S]*?)"#;/g)) {
    scripts.set(Number(match[1]), match[2]);
  }
  return scripts;
}

export async function createLegacyStore(root, out, version = 1) {
  const source = readFileSync(join(root, "desktop", "host", "core", "src", "storage", "migrations.rs"), "utf8");
  const scripts = migrationScripts(source);
  if (!scripts.has(version)) throw new Error(`NO_MIGRATION_V${version}`);
  if (existsSync(out)) throw new Error(`REFUSING_TO_OVERWRITE ${out}`);
  mkdirSync(dirname(out), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(out);
  try {
    for (let step = 1; step <= version; step += 1) {
      db.exec("BEGIN");
      db.exec(scripts.get(step));
      db.exec(`PRAGMA user_version = ${step}`);
      db.exec("COMMIT");
    }
    // v16 حذف عمود سياسة سياق المشروع (ADR-040)؛ القاعدة الأقدم تُكتب بمخططها هي.
    const insert =
      version < 16
        ? "INSERT INTO projects (project_id, name, description, status, language, workspace_root, default_model_id, context_policy, version, created_at, updated_at) VALUES (?, ?, '', 'ACTIVE', 'ar', NULL, NULL, 'LOCAL_ONLY', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
        : "INSERT INTO projects (project_id, name, description, status, language, workspace_root, default_model_id, version, created_at, updated_at) VALUES (?, ?, '', 'ACTIVE', 'ar', NULL, NULL, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')";
    db.prepare(insert).run(LEGACY_PROJECT_ID, LEGACY_PROJECT_NAME);
    const found = db.prepare("PRAGMA user_version").get();
    return { path: out, schema_version: Number(Object.values(found)[0]), projects: 1, migrations_available: [...scripts.keys()] };
  } finally {
    db.close();
  }
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const out = argument("--out", "");
  const version = Number(argument("--version", "1"));
  if (out === "") {
    console.error("usage: p07-legacy-db.mjs --root <root> --out <file> [--version N]");
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(await createLegacyStore(root, out, version)));
  }
}
