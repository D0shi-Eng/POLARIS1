// W5 — الثوابت البنيوية.
//
// ثابت يُفرض بالبنية أقوى من ثابت يُفرض بالسلوك: الثاني يمكن أن يُلتف عليه
// بمسار جديد، والأول لا يوجد فيه مسار أصلًا. هذه الاختبارات تقرأ عبارات
// الاستيراد الحقيقية ونصّ الشجرة، لا التعليقات ولا النية.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { W5_EMITTED_EVENT_TYPES } from "../src/audit/event-types.js";
import { runtimeSrcPath } from "./helpers.js";

const IMPORT_LINE = /^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"\s*;?\s*$/gm;
const BARE_IMPORT = /^\s*import\s+"([^"]+)"\s*;?\s*$/gm;

function sourceFiles(root: string, extensions: readonly string[] = [".ts"]): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.some((extension) => entry.endsWith(extension))) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

function importsOf(file: string): readonly string[] {
  const text = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  for (const pattern of [IMPORT_LINE, BARE_IMPORT]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(text);
    while (match !== null) {
      specifiers.push(match[1] as string);
      match = pattern.exec(text);
    }
  }
  return specifiers;
}

function name(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

// ── W5-INV-11 الوكيل لا يستطيع أن يوافق على نفسه ────────────────────────────

test("the agent cannot reach the approval issuer, its key, or the receipt registry", () => {
  const root = runtimeSrcPath();
  const forbidden = [
    "../approval/",
    "../control/stop-controller.js",
    "../control/execution-registry.js",
    "../audit/ledger/",
  ];

  for (const file of sourceFiles(join(root, "agent"))) {
    for (const specifier of importsOf(file)) {
      for (const module of forbidden) {
        assert.equal(
          specifier.startsWith(module),
          false,
          `${name(root, file)} reaches approval or stop internals via ${specifier}`,
        );
      }
    }
  }
});

test("nothing outside the approval module imports the issuer key", () => {
  const root = runtimeSrcPath();
  const importers: string[] = [];
  for (const file of sourceFiles(root)) {
    if (importsOf(file).some((s) => s.includes("issuer-key.js"))) importers.push(name(root, file));
  }
  // المُصدِر وحده، وملف التصدير الذي يجمع الوحدة.
  assert.deepEqual(importers.sort(), ["approval/index.ts", "approval/issuer.ts"]);
});

// ── W5-INV-01 كاتب واحد للدفتر ──────────────────────────────────────────────

test("only the audit emitter appends to the ledger chain", () => {
  const root = runtimeSrcPath();
  const appenders: string[] = [];
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, "utf8");
    const relativeName = name(root, file);
    if (relativeName === "audit/ledger/chain.ts") continue;
    if (/\.append\s*\(/.test(text)) appenders.push(relativeName);
  }
  assert.deepEqual(appenders.sort(), ["audit/emitter.ts"]);
});

test("the ledger store exposes no update and no delete", () => {
  const root = runtimeSrcPath();
  const text = readFileSync(join(root, "audit", "ledger", "store.ts"), "utf8");
  for (const forbidden of ["update(", "delete(", "remove(", "truncate(", "splice("]) {
    assert.equal(text.includes(forbidden), false, `the append-only store exposes ${forbidden}`);
  }
});

// ── W5-INV-14 الإيقاف مستقل عن النموذج ──────────────────────────────────────

test("panic stop imports no model, no provider, no network and no agent type", () => {
  const root = runtimeSrcPath();
  const forbiddenExact = ["node:net", "node:http", "node:https", "node:dgram", "node:tls"];
  const forbiddenPrefixes = ["../model/", "./model/", "../agent/", "./agent/", "../gateway/", "./gateway/"];

  for (const file of sourceFiles(join(root, "control"))) {
    for (const specifier of importsOf(file)) {
      assert.equal(forbiddenExact.includes(specifier), false, `${name(root, file)} imports ${specifier}`);
      for (const prefix of forbiddenPrefixes) {
        assert.equal(
          specifier.startsWith(prefix),
          false,
          `${name(root, file)} makes the stop path depend on ${specifier}`,
        );
      }
    }
  }
});

// ── W5-INV-17 الملكية ليست اسم عملية ────────────────────────────────────────

test("nothing in the repository kills a process by name", () => {
  const repositoryRoot = join(runtimeSrcPath(), "..", "..");
  const scanned = [
    join(repositoryRoot, "runtime", "src"),
    join(repositoryRoot, "runtime", "tests"),
    join(repositoryRoot, "contracts", "src"),
    join(repositoryRoot, "tools"),
  ];

  // أنماط القتل بالاسم. القتل بالاسم يصيب عمليات لا يملكها POLARIS.
  const forbidden: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
    { label: "taskkill /IM", pattern: /taskkill[^\n]*\/(?:IM|im)\b/ },
    { label: "pkill", pattern: /\bpkill\b/ },
    { label: "killall", pattern: /\bkillall\b/ },
    { label: "Stop-Process -Name", pattern: /Stop-Process[^\n]*-Name\b/ },
    { label: "GetProcessesByName + Kill", pattern: /GetProcessesByName[^\n]*\)\s*\)?\s*\.\s*Kill/ },
  ];

  const offences: string[] = [];
  for (const directory of scanned) {
    for (const file of sourceFiles(directory, [".ts", ".mjs", ".ps1", ".cs"])) {
      // الماسح نفسه يحمل الأنماط بالضرورة. استثناؤه استثناء الأداة من قياسها،
      // ولا يوسّع ما يُسمح به في أي ملف آخر.
      if (name(repositoryRoot, file).endsWith("runtime/tests/w5-architecture.test.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const rule of forbidden) {
        if (rule.pattern.test(text)) offences.push(`${name(repositoryRoot, file)} uses ${rule.label}`);
      }
    }
  }
  assert.deepEqual(offences, []);
});

// ── مفردة الأحداث ليست زينة ─────────────────────────────────────────────────

test("every declared W5 event type has a real emission path in the source", () => {
  const root = runtimeSrcPath();
  const text = sourceFiles(root)
    .filter((file) => name(root, file) !== "audit/event-types.ts")
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  const missing = W5_EMITTED_EVENT_TYPES.filter((type) => !text.includes(`"${type}"`));
  assert.deepEqual(missing, [], "these event types are declared but nothing ever emits them");
});

test("the superseded W2 approval events are not emitted by this build", () => {
  const root = runtimeSrcPath();
  for (const file of sourceFiles(root)) {
    if (name(root, file) === "audit/event-types.ts") continue;
    const text = readFileSync(file, "utf8");
    for (const superseded of ["APPROVAL_REQUESTED", "APPROVAL_RESOLVED"]) {
      assert.equal(
        text.includes(`event_type: "${superseded}"`),
        false,
        `${name(root, file)} emits ${superseded}, which W5 supersedes`,
      );
    }
  }
});

// ── لا ادعاء أوسع من المقاس ─────────────────────────────────────────────────

test("the source never calls the audit chain a signature or non-repudiation", () => {
  const root = runtimeSrcPath();
  const overclaims = [/non-?repudiation/i, /digitally signed/i, /immutable (?:audit )?log/i, /tamper-?proof/i];
  const offences: string[] = [];
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of overclaims) {
      if (pattern.test(text)) offences.push(`${name(root, file)} matches ${String(pattern)}`);
    }
  }
  assert.deepEqual(offences, []);
});
