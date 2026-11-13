// يولّد حزمة العقود التي يقرؤها العارض في المتصفح.
//
// لماذا التوليد أصلًا: `@polaris/contracts` حزمة Node — تقرأ من القرص عبر
// `node:fs` وتمشي في شجرة المجلدات. لا شيء من ذلك موجود داخل WebView، فاستيرادها
// في العارض يكسر البناء. والبديل الآخر — نسخة يدوية من المخططات — ممنوع بحكم
// ADR-002: مصدر حقيقة ثانٍ يُحرَّر بيد إنسان.
//
// فالحلّ هو نفس نمط `contracts/scripts/generate-types.mjs`: أثر مُشتقّ آليًا من
// المصدر، يحمل ترويسة تقول إنه مُولَّد، ويُعاد توليده في كل تحقق. والانحراف يُكشف
// لا يُحتمل: `--check` يفشل إن اختلف الملف على القرص عن توليد جديد.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(here, "..");
const repositoryRoot = join(rendererRoot, "..", "..");
const schemaRoot = join(repositoryRoot, "contracts", "schemas");
const registryRoot = join(repositoryRoot, "contracts", "registry");
const outputFile = join(rendererRoot, "src", "generated", "contract-bundle.ts");
const validatorsFile = join(rendererRoot, "src", "generated", "contract-validators.ts");

/** المخططات التي يحتاجها العارض: الإغلاق الكامل لمراجع سطح المكتب والظرف. */
const WANTED = [
  "common/caller-identity.schema.json",
  "common/effect.schema.json",
  "common/error.schema.json",
  "common/execution.schema.json",
  "common/idempotency.schema.json",
  "common/ids.schema.json",
  "common/provenance.schema.json",
  "desktop-availability.schema.json",
  "desktop-bootstrap.schema.json",
  "desktop-error-mapping.v1.schema.json",
  "desktop-ipc-registry.v1.schema.json",
  "desktop-operation.schema.json",
  "desktop-p02-domain.schema.json",
  "desktop-p02-request.v1.schema.json",
  "desktop-p02-result.v1.schema.json",
  "desktop-p03-domain.schema.json",
  "desktop-p03-request.v1.schema.json",
  "desktop-p03-result.v1.schema.json",
  "desktop-p04-domain.schema.json",
  "desktop-p04-request.v1.schema.json",
  "desktop-p04-result.v1.schema.json",
  "desktop-p05-domain.schema.json",
  "desktop-p05-request.v1.schema.json",
  "desktop-p05-result.v1.schema.json",
  "desktop-p06-domain.schema.json",
  "desktop-p06-request.v1.schema.json",
  "desktop-p06-result.v1.schema.json",
  "desktop-p08-domain.schema.json",
  "desktop-p08-request.v1.schema.json",
  "desktop-p08-result.v1.schema.json",
  "desktop-request.v1.schema.json",
  "desktop-result.v1.schema.json",
  "desktop-settings.schema.json",
  "ipc-envelope.v1.schema.json",
];

function walk(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.isFile() && entry.name.endsWith(".json")) found.push(full);
  }
  return found;
}

function schemaId(absolutePath) {
  return relative(schemaRoot, absolutePath).split(sep).join(posix.sep);
}

function availableSchemas() {
  const available = new Map(walk(schemaRoot).map((path) => [schemaId(path), path]));
  const missing = WANTED.filter((id) => !available.has(id));
  if (missing.length > 0) {
    throw new Error(`the contract source is missing schemas the renderer needs: ${missing.join(", ")}`);
  }
  return available;
}

function sourceDigest(available) {
  return createHash("sha256")
    .update(WANTED.map((id) => readFileSync(available.get(id))).join("\n"))
    .update(readFileSync(join(registryRoot, "phase-01-ipc.registry.json")))
    .update(readFileSync(join(registryRoot, "phase-02-ipc.registry.json")))
    .update(readFileSync(join(registryRoot, "phase-05-ipc.registry.json")))
    .update(readFileSync(join(registryRoot, "phase-06-ipc.registry.json")))
    .update(readFileSync(join(registryRoot, "phase-08-ipc.registry.json")))
    .update(readFileSync(join(registryRoot, "phase-01-error-mapping.json")))
    .digest("hex");
}

function build() {
  const available = availableSchemas();

  const entries = WANTED.map((id) => {
    const body = JSON.parse(readFileSync(available.get(id), "utf8"));
    return `  ${JSON.stringify(id)}: ${JSON.stringify(body, null, 2).split("\n").join("\n  ")} as unknown as SchemaDocument,`;
  });

  const ipcRegistry = JSON.parse(readFileSync(join(registryRoot, "phase-01-ipc.registry.json"), "utf8"));
  const phase02Registry = JSON.parse(readFileSync(join(registryRoot, "phase-02-ipc.registry.json"), "utf8"));
  const phase03Registry = JSON.parse(readFileSync(join(registryRoot, "phase-03-ipc.registry.json"), "utf8"));
  const phase04Registry = JSON.parse(readFileSync(join(registryRoot, "phase-04-ipc.registry.json"), "utf8"));
  const phase05Registry = JSON.parse(readFileSync(join(registryRoot, "phase-05-ipc.registry.json"), "utf8"));
  const phase06Registry = JSON.parse(readFileSync(join(registryRoot, "phase-06-ipc.registry.json"), "utf8"));
  const phase08Registry = JSON.parse(readFileSync(join(registryRoot, "phase-08-ipc.registry.json"), "utf8"));
  const errorMapping = JSON.parse(readFileSync(join(registryRoot, "phase-01-error-mapping.json"), "utf8"));

  const digest = sourceDigest(available);

  return `// ملف مُولَّد. لا يُحرَّر بيد.
// المصدر: contracts/schemas/**.json و contracts/registry/*.json
// المولِّد: desktop/renderer/scripts/generate-contract-bundle.mjs
// أي تحرير يدوي هنا يُكشف في التحقق: \`node scripts/generate-contract-bundle.mjs --check\`.

export type SchemaDocument = Record<string, unknown>;

/** بصمة المصدر الذي وُلّد منه هذا الملف. */
export const CONTRACT_BUNDLE_DIGEST = ${JSON.stringify(digest)};

/** المخططات بمعرّفاتها المسارية، وهي نفس المعرّفات التي يسجّلها \`contracts/src/registry.ts\`. */
export const CONTRACT_SCHEMAS: Readonly<Record<string, SchemaDocument>> = {
${entries.join("\n")}
};

/** سجل عمليات Phase-01، كما هو على القرص. */
export const IPC_REGISTRY = ${JSON.stringify(ipcRegistry, null, 2)} as const;

/** سجل عمليات Phase-02 (ADR-019)، كما هو على القرص. */
export const PHASE02_IPC_REGISTRY = ${JSON.stringify(phase02Registry, null, 2)} as const;

/** سجل عمليات Phase-03 (ADR-021)، كما هو على القرص. */
export const PHASE03_IPC_REGISTRY = ${JSON.stringify(phase03Registry, null, 2)} as const;

/** سجل عمليات Phase-04 (ADR-023)، كما هو على القرص. */
export const PHASE04_IPC_REGISTRY = ${JSON.stringify(phase04Registry, null, 2)} as const;

/** سجل عمليات Phase-05 (ADR-025)، كما هو على القرص. */
export const PHASE05_IPC_REGISTRY = ${JSON.stringify(phase05Registry, null, 2)} as const;

/** سجل عمليات Phase-06 (ADR-026)، كما هو على القرص. */
export const PHASE06_IPC_REGISTRY = ${JSON.stringify(phase06Registry, null, 2)} as const;

/** سجل Phase-08 (ADR-028). ملف سابع منفصل: السجلات السابقة لا تُحرَّر. */
export const PHASE08_IPC_REGISTRY = ${JSON.stringify(phase08Registry, null, 2)} as const;

/** خريطة تصنيف الأخطاء، كما هي على القرص. */
export const ERROR_MAPPING = ${JSON.stringify(errorMapping, null, 2)} as const;
`;
}


/**
 * المُحقِّقات المُترجَمة مسبقًا (P01_STARTUP_REPORT_ABSENT).
 *
 * لماذا: Ajv يترجم كل مخطط إلى دالة عبر `new Function` لحظة أول استعمال. سياسة
 * CSP في المنتج (`script-src 'self'` بلا `'unsafe-eval'`) تمنع ذلك عن حق، فكان
 * أول تحقق في العارض يرمي EvalError قبل إرسال طلب الإقلاع، ولا يصل المضيف شيء.
 * خادم التطوير لا يحمل CSP، فلم يظهر العيب إلا في الواجهة المحزومة.
 *
 * الحل ليس إضعاف السياسة بل نقل الترجمة إلى وقت البناء: نفس المخططات ونفس
 * إعدادات Ajv، والناتج شيفرة عادية لا تقيّم نصًا وقت التشغيل.
 */
const AJV_OPTIONS = {
  strict: true,
  strictRequired: false,
  allErrors: true,
  allowUnionTypes: false,
  discriminator: true,
};

const ENVELOPE_REFERENCES = [
  "ipc-envelope.v1.schema.json#/$defs/RequestEnvelope",
  "ipc-envelope.v1.schema.json#/$defs/ResponseEnvelope",
];

/** سجلات العمليات التي يعرفها العارض: Phase-01 ثم امتداد Phase-02 الإضافي. */
const REGISTRY_FILES = [
  "phase-01-ipc.registry.json",
  "phase-02-ipc.registry.json",
  "phase-03-ipc.registry.json",
  "phase-04-ipc.registry.json",
  "phase-05-ipc.registry.json",
  "phase-06-ipc.registry.json",
  "phase-08-ipc.registry.json",
];

/** كل مرجع يحتاجه العارض: الظرف في الاتجاهين، وكل مخطط طلب ونتيجة في السجل. */
function validatorReferences() {
  const references = new Set(ENVELOPE_REFERENCES);
  for (const file of REGISTRY_FILES) {
    const registry = JSON.parse(readFileSync(join(registryRoot, file), "utf8"));
    for (const record of registry.operations ?? []) {
      if (typeof record.request_schema === "string") references.add(record.request_schema);
      if (typeof record.response_schema === "string") references.add(record.response_schema);
    }
  }
  return [...references].sort();
}

/**
 * دوال وقت التشغيل التي تشير إليها الشيفرة المستقلة بـ`require`. تُحوَّل إلى
 * استيرادات صريحة لأن الملف وحدة ES يحزمها Vite. مرجع غير معروف هنا فشلٌ صريح:
 * لا يُترك `require` في شيفرة ستعمل داخل WebView.
 */
const RUNTIME_IMPORTS = new Map([
  ['require("ajv/dist/runtime/equal").default', { name: "ajvRuntimeEqual", line: 'import ajvRuntimeEqual from "ajv/dist/runtime/equal";' }],
  ['require("ajv/dist/runtime/ucs2length").default', { name: "ajvRuntimeUcs2length", line: 'import ajvRuntimeUcs2length from "ajv/dist/runtime/ucs2length";' }],
  ['require("ajv/dist/runtime/uri").default', { name: "ajvRuntimeUri", line: 'import ajvRuntimeUri from "ajv/dist/runtime/uri";' }],
  ['require("ajv/dist/runtime/validation_error").default', { name: "ajvRuntimeValidationError", line: 'import ajvRuntimeValidationError from "ajv/dist/runtime/validation_error";' }],
  ['require("ajv-formats/dist/formats").fullFormats', { name: "ajvFullFormats", line: 'import { fullFormats as ajvFullFormats } from "ajv-formats/dist/formats";' }],
]);

function buildValidators(available, digest) {
  const require = createRequire(join(rendererRoot, "package.json"));
  const ajvModule = require("ajv/dist/2020");
  const Ajv = ajvModule.default ?? ajvModule;
  const formatsModule = require("ajv-formats");
  const addFormats = formatsModule.default ?? formatsModule;
  const standaloneModule = require("ajv/dist/standalone");
  const standaloneCode = standaloneModule.default ?? standaloneModule;

  const ajv = new Ajv({ ...AJV_OPTIONS, code: { source: true, esm: true, lines: false } });
  addFormats(ajv);
  for (const id of WANTED) ajv.addSchema(JSON.parse(readFileSync(available.get(id), "utf8")), id);

  const references = validatorReferences();
  const exportsMap = Object.fromEntries(references.map((reference, index) => [`v${index}`, reference]));
  let code = standaloneCode(ajv, exportsMap);

  code = code.replace(/^"use strict";/, "");
  code = code.replace(/export const (v\d+) = /g, "const $1 = ");
  if (/\bexport\b/.test(code.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) {
    throw new Error("standalone validator code kept an export the generator does not understand");
  }

  const imports = new Set();
  code = code.replace(/require\("[^"]+"\)(?:\.default|\.fullFormats)?/g, (match) => {
    const known = RUNTIME_IMPORTS.get(match);
    if (known === undefined) throw new Error(`standalone validator code references an unknown runtime module: ${match}`);
    imports.add(known.line);
    return known.name;
  });
  if (/\brequire\(|\bnew Function\b|\beval\(/.test(code)) {
    throw new Error("standalone validator code still evaluates or loads code at run time");
  }

  const table = references.map((reference, index) => `  ${JSON.stringify(reference)}: v${index},`).join("\n");

  return `// @ts-nocheck
// ملف مُولَّد. لا يُحرَّر بيد.
// المصدر: contracts/schemas/**.json و contracts/registry/phase-0{1,2,3}-ipc.registry.json
// المولِّد: desktop/renderer/scripts/generate-contract-bundle.mjs (Ajv standalone)
// أي تحرير يدوي هنا يُكشف في التحقق: \`node scripts/generate-contract-bundle.mjs --check\`.
//
// مُحقِّقات مُترجَمة وقت البناء: لا \`new Function\` ولا \`eval\` وقت التشغيل،
// فتعمل تحت CSP المنتج (\`script-src 'self'\`) كما هي.
// \`@ts-nocheck\` لأن الشيفرة ناتج آلي من Ajv؛ الأنواع العامة مُعلنة أدناه.

${[...imports].sort().join("\n")}

${code}

export interface ContractValidationError {
  readonly instancePath?: string;
  readonly message?: string;
  readonly keyword?: string;
}

export interface CompiledContractValidator {
  (value: unknown): boolean;
  errors?: ReadonlyArray<ContractValidationError> | null;
}

/** بصمة المصدر نفسه الذي وُلّدت منه حزمة العقود. */
export const CONTRACT_VALIDATORS_DIGEST: string = ${JSON.stringify(digest)};

/** المُحقِّقات بمراجعها، بنفس صيغة المرجع التي يسجّلها السجل. */
export const CONTRACT_VALIDATORS: Readonly<Record<string, CompiledContractValidator>> = {
${table}
};
`;
}

/**
 * أنواع TypeScript المُولَّدة في `contracts/generated/types` تُنقل كما هي.
 * هي بدورها مُشتقّة من المخططات نفسها، فنقلها لا يُنشئ تعريفًا دلاليًا ثانيًا،
 * والحارس نفسه يكشف أي تحرير يدوي هنا.
 */
const TYPE_FILES = [
  "ipc-envelope-v1.ts",
  "desktop-request-v1.ts",
  "desktop-result-v1.ts",
  "desktop-p02-request-v1.ts",
  "desktop-p02-result-v1.ts",
  "desktop-p03-request-v1.ts",
  "desktop-p03-result-v1.ts",
  "desktop-p04-request-v1.ts",
  "desktop-p04-result-v1.ts",
  "desktop-p05-request-v1.ts",
  "desktop-p05-result-v1.ts",
  "desktop-p06-request-v1.ts",
  "desktop-p06-result-v1.ts",
  "desktop-p08-request-v1.ts",
  "desktop-p08-result-v1.ts",
  "desktop-ipc-registry-v1.ts",
  "desktop-error-mapping-v1.ts",
];

const typeSourceRoot = join(repositoryRoot, "contracts", "generated", "types");
const typeOutputRoot = join(rendererRoot, "src", "generated", "types");

function typeBodies() {
  return TYPE_FILES.map((name) => {
    const source = join(typeSourceRoot, name);
    if (!existsSync(source)) {
      throw new Error(`the contract source has no generated type file ${name}; run contracts' own generate first`);
    }
    return { name, body: readFileSync(source, "utf8") };
  });
}

const generated = build();
const generatedValidators = buildValidators(availableSchemas(), sourceDigest(availableSchemas()));
const types = typeBodies();
const check = process.argv.includes("--check");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (check) {
  if (!existsSync(outputFile)) fail(`GENERATED BUNDLE MISSING: ${relative(repositoryRoot, outputFile)}`);
  if (readFileSync(outputFile, "utf8") !== generated) {
    fail(`GENERATED BUNDLE DRIFTED: ${relative(repositoryRoot, outputFile)} is not what the contract source produces.`);
  }
  if (!existsSync(validatorsFile)) fail(`GENERATED VALIDATORS MISSING: ${relative(repositoryRoot, validatorsFile)}`);
  if (readFileSync(validatorsFile, "utf8") !== generatedValidators) {
    fail(`GENERATED VALIDATORS DRIFTED: ${relative(repositoryRoot, validatorsFile)} is not what the contract source produces.`);
  }
  for (const { name, body } of types) {
    const target = join(typeOutputRoot, name);
    if (!existsSync(target)) fail(`GENERATED TYPE MISSING: ${relative(repositoryRoot, target)}`);
    if (readFileSync(target, "utf8") !== body) {
      fail(`GENERATED TYPE DRIFTED: ${relative(repositoryRoot, target)} differs from the contract source.`);
    }
  }
  console.log(`contract bundle: in sync with the contract source (validators + ${types.length} type files)`);
} else {
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, generated, "utf8");
  writeFileSync(validatorsFile, generatedValidators, "utf8");
  mkdirSync(typeOutputRoot, { recursive: true });
  for (const { name, body } of types) writeFileSync(join(typeOutputRoot, name), body, "utf8");
  console.log(
    `contract bundle written: ${relative(repositoryRoot, outputFile)} (+ ${relative(repositoryRoot, validatorsFile)}, +${types.length} type files)`,
  );
}
