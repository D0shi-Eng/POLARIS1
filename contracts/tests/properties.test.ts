// اختبارات خصائص محدودة، بمولّد عشوائي مزروع محليًا وبلا اعتمادية إضافية.
// الغرض إثبات خصائص عامة على كل العينات، لا فحص حالات مفردة اختِيرت يدويًا.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateContract } from "../src/validator.js";
import { canonicalize } from "../src/canonical.js";
import { findSecrets } from "../src/secret-hygiene.js";
import { loadFixtures, clone } from "./helpers.js";

const FIXTURE_ROOT = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const positives = loadFixtures("positive");

// مولّد خطي مزروع: نفس البذرة تعطي نفس الحالات في كل تشغيل، فيبقى الفشل قابلًا لإعادة الإنتاج.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("property: removing any single top-level field from a valid document is rejected", () => {
  for (const fx of positives) {
    for (const key of Object.keys(fx.doc)) {
      const mutated = clone(fx.doc);
      delete mutated[key];
      const result = validateContract(fx.contract, mutated);
      if (result.ok) {
        // الحقول الاختيارية يُسمح بغيابها؛ نتأكد فقط أن الحقل ليس ضمن الإلزامي.
        assert.ok(
          !isRequired(fx.contract, key),
          `${fx.file}: required field "${key}" can be removed without rejection`,
        );
      }
    }
  }
});

// الحقول الإلزامية تُقرأ من مصدر الحقيقة نفسه، لا من قائمة مكرّرة في الاختبار.
const SCHEMA_ROOT = fileURLToPath(new URL("../../schemas/", import.meta.url));
const SCHEMA_FILE: Record<string, string> = {
  IPCEnvelopeV1: "ipc-envelope.v1.schema.json",
  CapabilityDescriptorV1: "capability-descriptor.v1.schema.json",
  CapabilityInvocationV1: "capability-invocation.v1.schema.json",
  PolicyDecisionV1: "policy-decision.v1.schema.json",
  AuditEventV1: "audit-event.v1.schema.json",
  ModelOutputContractV1: "model-output.v1.schema.json",
};

function isRequired(contract: string, key: string): boolean {
  const schema = JSON.parse(readFileSync(join(SCHEMA_ROOT, SCHEMA_FILE[contract]!), "utf8")) as Record<string, unknown>;
  const direct = schema["required"];
  if (Array.isArray(direct) && direct.includes(key)) return true;
  const defs = schema["$defs"] as Record<string, { required?: string[] }> | undefined;
  if (defs === undefined) return false;
  // اتحاد مميّز: الحقل إلزامي إذا كان إلزاميًا في كل الفروع.
  const branches = Object.values(defs).filter((d) => Array.isArray(d.required));
  return branches.length > 0 && branches.every((d) => d.required!.includes(key));
}

test("property: swapping any leaf value's type is rejected", () => {
  const random = seeded(20260901);
  for (const fx of positives) {
    for (let round = 0; round < 12; round += 1) {
      const mutated = clone(fx.doc);
      const paths = leafPaths(mutated).filter((path) => !isOpaqueSubtree(path));
      const target = paths[Math.floor(random() * paths.length)]!;
      const current = readPath(mutated, target);
      writePath(mutated, target, typeof current === "string" ? 12345 : "polaris-type-swap");
      assert.equal(
        validateContract(fx.contract, mutated).ok,
        false,
        `${fx.file}: type swap at /${target.join("/")} was accepted`,
      );
    }
  }
});

// حقول معتمة عمدًا: محتواها ليس جزءًا من هذا العقد، بل يُتحقق منه مقابل مخطط القدرة
// أو مخطط العملية في طبقة أعلى. تبديل نوع ورقة داخلها ليس عيبًا في العقد.
const OPAQUE_ROOTS = new Set(["arguments", "payload", "result", "parsed_payload"]);

function isOpaqueSubtree(path: Array<string | number>): boolean {
  return path.length > 1 && typeof path[0] === "string" && OPAQUE_ROOTS.has(path[0]);
}

function leafPaths(value: unknown, prefix: Array<string | number> = []): Array<Array<string | number>> {
  if (Array.isArray(value)) return value.flatMap((item, i) => leafPaths(item, [...prefix, i]));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => leafPaths(v, [...prefix, k]));
  }
  return [prefix];
}

function readPath(root: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], root);
}

function writePath(root: unknown, path: Array<string | number>, value: unknown): void {
  const parent = readPath(root, path.slice(0, -1)) as Record<string | number, unknown>;
  parent[path[path.length - 1]!] = value;
}

test("property: canonicalisation is idempotent and order-independent on generated structures", () => {
  const random = seeded(7);
  const build = (depth: number): unknown => {
    if (depth === 0) return random() < 0.5 ? Math.floor(random() * 1000) : `v${Math.floor(random() * 1000)}`;
    const size = 1 + Math.floor(random() * 4);
    if (random() < 0.3) return Array.from({ length: size }, () => build(depth - 1));
    const entries: Array<[string, unknown]> = [];
    for (let i = 0; i < size; i += 1) entries.push([`k${Math.floor(random() * 100)}`, build(depth - 1)]);
    return Object.fromEntries(entries);
  };

  for (let i = 0; i < 200; i += 1) {
    const value = build(3) as Record<string, unknown>;
    const once = canonicalize(value);
    assert.equal(canonicalize(JSON.parse(once)), once);
    if (typeof value === "object" && !Array.isArray(value)) {
      assert.equal(canonicalize(Object.fromEntries(Object.entries(value).reverse())), once);
    }
  }
});

test("security: no fixture in the repository carries credential-shaped data", () => {
  for (const kind of ["positive", "negative"] as const) {
    const directory = join(FIXTURE_ROOT, kind);
    // الملفات المسبوقة بشرطة سفلية وصفية عن العينات، لا عينات. الفهرس يذكر أسماء
    // حقول شبيهة بالاعتماد في نصوص الأسباب، وذلك مقصود ولا يُفحص.
    for (const file of readdirSync(directory).filter((f) => f.endsWith(".json") && !f.startsWith("_"))) {
      const text = readFileSync(join(directory, file), "utf8");
      const flat: Record<string, unknown> = {};
      flatten(JSON.parse(text), "", flat);
      const findings = findSecrets(flat, "/");
      // العينات السلبية الخاصة بنظافة التدقيق تحمل أشكالًا مزيفة عمدًا، وهي المستثناة الوحيدة.
      const intentional = file.startsWith("audit-event.secret-like-");
      assert.equal(findings.length > 0, intentional, `${kind}/${file}: unexpected credential-shaped data`);
    }
  }
});

function flatten(value: unknown, prefix: string, out: Record<string, unknown>): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, `${prefix}.${i}`, out));
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix === "" ? k : `${prefix}.${k}`, out);
  } else {
    out[prefix] = value;
  }
}
