// P01-X — الثوابت المعمارية لحدّ Phase-01.
//
// ما تفرضه هذه المجموعة ليس شكل رسالة بل غيابَ أشكال: لا موزِّع عام، ولا سلطة
// نظام ملفات، ولا صدفة، ولا مظروف ثانٍ. الثابت المعماري يُثبَت بأن ما يخالفه
// غير قابل للتمثيل، لا بأنه غير مكتوب اليوم.

import test from "node:test";
import assert from "node:assert/strict";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateContract } from "../src/validator.js";
import { SUPPORTED_VERSIONS } from "../src/version.js";
import { DESKTOP_OPERATIONS, loadDesktopIpcRegistry } from "../src/desktop/index.js";
import { fixture, clone } from "./helpers.js";
import { schemaEnum, schemaDocument } from "./p01-helpers.js";

const SCHEMA_ROOT = fileURLToPath(new URL("../../schemas/", import.meta.url));

function allSchemaText(): string {
  const parts: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".schema.json")) parts.push(readFileSync(full, "utf8"));
    }
  };
  walk(SCHEMA_ROOT);
  return parts.join("\n");
}

test("P01-X-A the operation set stays closed", () => {
  const document = schemaDocument("ipc-envelope.v1.schema.json");
  const defs = document["$defs"] as Record<string, Record<string, unknown>>;
  const operation = defs["Operation"]!;
  assert.ok(Array.isArray(operation["enum"]), "Operation is no longer an enum");
  assert.equal("pattern" in operation, false, "Operation acquired a pattern, which opens the set");
  assert.equal(operation["type"], "string");
});

test("P01-X-B no generic dispatcher operation exists", () => {
  const operations = schemaEnum("ipc-envelope.v1.schema.json", "Operation");
  for (const forbidden of ["desktop.invoke", "desktop.call", "desktop.dispatch", "desktop.exec", "desktop.request"]) {
    assert.equal(operations.includes(forbidden), false, `${forbidden} is a dispatcher`);
  }
  for (const operation of operations) {
    assert.equal(operation.endsWith(".*"), false, `${operation} is a wildcard`);
  }
});

test("P01-X-C every desktop operation has exactly one owner", () => {
  const registry = loadDesktopIpcRegistry();
  for (const operation of DESKTOP_OPERATIONS) {
    const owners = registry.operations.filter((record) => record.operation === operation).map((r) => r.owner);
    assert.equal(owners.length, 1, `${operation} has ${String(owners.length)} owners`);
  }
});

test("P01-X-D all five desktop operations are read-only", () => {
  for (const record of loadDesktopIpcRegistry().operations) {
    assert.equal(record.effect, "READ_ONLY");
  }
});

test("P01-X-E no desktop operation grants filesystem authority", () => {
  // لا حقل مسار في أي حمولة، ولا نوع قيمة يمثّل مسارًا. المنع بنيوي: العارض لا
  // يستطيع تسمية ملف أصلًا، فلا يحتاج المضيف إلى رفض تسميته.
  const request = schemaDocument("desktop-request.v1.schema.json");
  const serialised = JSON.stringify(request);
  for (const forbidden of ["path", "file", "directory", "glob", "uri", "url"]) {
    assert.equal(
      serialised.toLowerCase().includes(`"${forbidden}"`),
      false,
      `a desktop request payload names ${forbidden}`,
    );
  }
});

test("P01-X-F no shell or eval operation exists anywhere in the contract set", () => {
  const operations = schemaEnum("ipc-envelope.v1.schema.json", "Operation");
  for (const forbidden of [
    "desktop.shell",
    "desktop.exec",
    "desktop.eval",
    "desktop.window.exec",
    "desktop.process.start",
    "desktop.file.read",
    "desktop.file.write",
    "desktop.settings.write",
  ]) {
    assert.equal(operations.includes(forbidden), false, `${forbidden} exists`);
  }
});

test("P01-X-G no desktop contract declares a secret-bearing field", () => {
  const text = [
    JSON.stringify(schemaDocument("desktop-request.v1.schema.json")),
    JSON.stringify(schemaDocument("desktop-result.v1.schema.json")),
    JSON.stringify(schemaDocument("desktop-bootstrap.schema.json")),
    JSON.stringify(schemaDocument("desktop-settings.schema.json")),
  ].join("\n");
  // أسماء الحقول فقط، لا النصوص الوصفية: الوصف يشرح لماذا لا يوجد سرّ، والاسم هو ما يحمل.
  const fieldNames = [...text.matchAll(/"([a-z0-9_]+)"\s*:\s*\{\s*"(?:type|\$ref|title)/g)].map((m) => m[1]!);
  for (const name of fieldNames) {
    assert.equal(
      /(^|_)(password|secret|token|apikey|api_key|credential|authorization|bearer)(_|$)/.test(name),
      false,
      `a desktop contract declares the field ${name}`,
    );
  }
});

test("P01-X-H schemas remain the single source of truth", () => {
  // لا مخطط مضمَّن في شيفرة: كل تحقق يمر بملفات schemas/ عبر السجل الواحد.
  const srcRoot = fileURLToPath(new URL("../../src/", import.meta.url));
  const offenders: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && readFileSync(full, "utf8").includes('"$schema"')) offenders.push(full);
    }
  };
  walk(srcRoot);
  assert.deepEqual(offenders, [], "a schema document was inlined into source");
});

test("P01-X-I generated types are derived, not handwritten", () => {
  const generated = fileURLToPath(new URL("../../generated/types/", import.meta.url));
  const files = readdirSync(generated);
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(
      readFileSync(join(generated, file), "utf8").includes("GENERATED FILE - DO NOT EDIT MANUALLY"),
      `${file} lost its generated header`,
    );
  }
  for (const expected of [
    "desktop-request-v1.ts",
    "desktop-result-v1.ts",
    "desktop-ipc-registry-v1.ts",
    "desktop-error-mapping-v1.ts",
  ]) {
    assert.ok(files.includes(expected), `${expected} was not generated`);
  }
});

test("P01-X-J 1.0 backward compatibility remains", () => {
  for (const file of ["ipc-envelope.request.json", "ipc-envelope.response.json", "ipc-envelope.event.json"]) {
    const doc = fixture("positive", file);
    assert.equal(doc["contract_version"], "1.0");
    assert.ok(validateContract("IPCEnvelopeV1", doc).ok, `${file} stopped validating under 1.1`);
  }
});

test("P01-X-K unsupported versions fail closed", () => {
  const doc = clone(fixture("positive", "ipc-envelope.desktop-bootstrap.json"));
  // القاعدة نفسها لم تتغيّر: MINOR أعلى من البناء يفشل مغلقًا، وMAJOR مختلف كذلك.
  // الرقم لا يُثبَّت هنا: كل مرحلة تضيف MINOR، وتثبيت الرقم يكسر اختبارًا سليمًا
  // دون أن يتغيّر ادعاؤه. أول MINOR غير مدعوم يُشتق من البناء نفسه.
  const beyond = `1.${SUPPORTED_VERSIONS.IPCEnvelopeV1.minor + 1}`;
  for (const version of [beyond, "2.0", "0.9", "1"]) {
    doc["contract_version"] = version;
    assert.equal(validateContract("IPCEnvelopeV1", doc).ok, false, `${version} was accepted`);
  }
});

test("P01-X-L a schema-valid operation is not automatically routed", () => {
  const registry = loadDesktopIpcRegistry();
  const operations = schemaEnum("ipc-envelope.v1.schema.json", "Operation");
  const routed = new Set(
    registry.operations.filter((r) => r.routing_status === "ROUTED").map((r) => r.operation as string),
  );
  const validButUnrouted = operations.filter((operation) => !routed.has(operation));
  // العمليات الستة المجمَّدة صالحة عند المخطط ولا تُوجَّه عبر بوابة سطح المكتب.
  assert.ok(validButUnrouted.length >= 6, "every schema-valid operation is routed, which erases the distinction");
});

test("P01-X-M renderer identity is not authoritative", () => {
  for (const record of loadDesktopIpcRegistry().operations) {
    assert.equal(record.caller_identity_authority, "NATIVE_TRANSPORT");
  }
  // والادعاء الأعلى مرفوض عند العقد نفسه، لا عند البوابة وحدها.
  const doc = clone(fixture("positive", "ipc-envelope.desktop-bootstrap.json"));
  (doc["caller_identity"] as Record<string, unknown>)["trust_tier"] = "TIER_0_TRUSTED";
  assert.equal(validateContract("IPCEnvelopeV1", doc).ok, false);
});

test("P01-X-N no duplicate desktop envelope contract exists", () => {
  const text = allSchemaText();
  for (const forbidden of ["DesktopIPCEnvelope", "DesktopEnvelopeV1", "DesktopIpcEnvelopeV1"]) {
    assert.equal(text.includes(forbidden), false, `${forbidden} is a second envelope definition`);
  }
  const envelopeTitles = readdirSync(SCHEMA_ROOT)
    .filter((file) => file.endsWith(".schema.json"))
    .map((file) => JSON.parse(readFileSync(join(SCHEMA_ROOT, file), "utf8")) as { title?: string })
    .filter((schema) => typeof schema.title === "string" && schema.title.toLowerCase().includes("envelope"));
  assert.equal(envelopeTitles.length, 1, "more than one envelope contract exists");
});

test("P01-X-O the desktop layer adds no new caller type or trust tier to the frozen vocabulary", () => {
  assert.deepEqual(
    [...schemaEnum("common/caller-identity.schema.json", "CallerType")],
    ["CORE_UI", "USER", "AGENT", "PLUGIN", "SYSTEM"],
  );
  assert.deepEqual(
    [...schemaEnum("common/caller-identity.schema.json", "TrustTier")],
    ["TIER_0_TRUSTED", "TIER_1_LIMITED", "TIER_2_UNTRUSTED"],
  );
  assert.deepEqual(
    [...schemaEnum("common/error.schema.json", "ErrorCode")],
    [
      "VALIDATION_ERROR",
      "UNSUPPORTED_VERSION",
      "POLICY_DENIED",
      "MALFORMED_MESSAGE",
      "CONTRACT_VIOLATION",
      "DEPENDENCY_UNAVAILABLE",
      "TIMEOUT",
      "CONFLICT",
      "INTERNAL_ERROR",
    ],
  );
});
