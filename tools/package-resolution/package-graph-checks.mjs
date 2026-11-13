// فحوص رسم الحزم: هل علاقة runtime → @polaris/contracts محقّقة فعلًا على هذا
// المضيف، أم مجرد مُعلَنة في مِلَفّ بيان؟
//
// العيب الأصلي: شجرة node_modules أنشأها نظام تشغيل آخر على نفس القرص، فحملت
// مدخل @polaris/contracts بصيغة رابط لا يجتازه النظام الحالي. الإصلاح السابق
// أبقى الرابط واكتفى بكشفه وإعادة التثبيت. هذا الملف يفترض استراتيجية أخرى:
// التبعية المحلّية تُحزَم وتُثبَّت حزمةً عادية (PACKED_PACKAGE) لا رابطًا، فتصبح
// هويّة النظام الذي كتب المدخل بلا أثر — ملفات عادية يقرؤها الطرفان.
//
// كل فحص مستقل، ويُرجع رمز خطأ مُصنَّفًا يبني عليه المشغّل قرار الإصلاح.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** مفردات أخطاء الإقلاع. المشغّل يتفرّع عليها، فهي جزء من العقد لا نصّ رسالة. */
export const ERROR_CODES = Object.freeze({
  DECLARATION_MISSING: "POLARIS_PACKAGE_DECLARATION_MISSING",
  DEPENDENCIES_NOT_INSTALLED: "POLARIS_DEPENDENCIES_NOT_INSTALLED",
  MATERIALIZATION_MISSING: "POLARIS_PACKAGE_MATERIALIZATION_MISSING",
  MATERIALIZATION_FOREIGN: "POLARIS_PACKAGE_MATERIALIZATION_FOREIGN",
  MATERIALIZATION_STALE: "POLARIS_PACKAGE_MATERIALIZATION_STALE",
  MATERIALIZATION_UNCLEAN: "POLARIS_PACKAGE_MATERIALIZATION_UNCLEAN",
  CONTRACTS_NOT_BUILT: "POLARIS_CONTRACTS_NOT_BUILT",
  RESOLUTION_UNPROVEN: "POLARIS_PACKAGE_RESOLUTION_UNPROVEN",
  TYPES_UNRESOLVED: "POLARIS_PACKAGE_TYPES_UNRESOLVED",
  CONTRACTS_DUPLICATED: "POLARIS_CONTRACTS_DUPLICATED",
  RESOLUTION_PATH_POLLUTED: "POLARIS_PACKAGE_RESOLUTION_PATH_POLLUTED",
});

const CONTRACTS_PACKAGE = "@polaris/contracts";
const DECLARED_SPECIFIER = "file:../contracts";

/** الشكل الوحيد المقبول لتحقّق التبعية المحلّية: حزمة مُحزَّمة، لا رابط. */
export const MATERIALIZATION = "PACKED_PACKAGE";

/** المجلدات المعزولة داخل المستودع: بقايا مُبقاة كدليل، ممنوع أن تشارك في الحلّ. */
const QUARANTINE_DIRECTORIES = ["_to_delete", "_transfer", "graphify-out"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function materializedPath(root) {
  return join(root, "runtime", "node_modules", ...CONTRACTS_PACKAGE.split("/"));
}

function pass(id, title, detail) {
  return { check_id: id, title, status: "PASS", detail, error_code: null };
}

function fail(id, title, detail, errorCode) {
  return { check_id: id, title, status: "FAIL", detail, error_code: errorCode };
}

// ── PKG-01 ──────────────────────────────────────────────────────────────────

/**
 * الإعلان: البيان يعلن التبعية المحلّية، وإعداد المستودع يفرض تحقّقها حزمةً
 * لا رابطًا، وملف القفل يسجّلها بالشكل نفسه. الثلاثة معًا، وإلا فالإعلان وعد.
 */
function checkDeclaration(root) {
  const id = "PKG-01";
  const title = "runtime declares @polaris/contracts as a packed local dependency";
  const manifest = readJson(join(root, "runtime", "package.json"));
  const specifier = manifest.dependencies?.[CONTRACTS_PACKAGE];
  if (specifier !== DECLARED_SPECIFIER) {
    return fail(id, title, `runtime/package.json declares ${String(specifier)}, expected ${DECLARED_SPECIFIER}`, ERROR_CODES.DECLARATION_MISSING);
  }

  // الإعداد مملوك للمستودع لا لسطر أمر: تثبيت لاحق لا يستطيع أن يعيد الرابط.
  const npmrcPath = join(root, "runtime", ".npmrc");
  if (!existsSync(npmrcPath)) {
    return fail(id, title, "runtime/.npmrc is missing, so nothing stops npm from realising the dependency as a link", ERROR_CODES.DECLARATION_MISSING);
  }
  const npmrc = readFileSync(npmrcPath, "utf8");
  if (!/^\s*install-links\s*=\s*true\s*$/m.test(npmrc)) {
    return fail(id, title, "runtime/.npmrc does not set install-links=true", ERROR_CODES.DECLARATION_MISSING);
  }

  const lockPath = join(root, "runtime", "package-lock.json");
  if (!existsSync(lockPath)) {
    return fail(id, title, "runtime/package-lock.json is missing; the dependency is not reproducible", ERROR_CODES.DECLARATION_MISSING);
  }
  const lock = readJson(lockPath);
  const entry = lock.packages?.[`node_modules/${CONTRACTS_PACKAGE}`];
  if (entry === undefined) {
    return fail(id, title, "the lockfile carries no node_modules/@polaris/contracts entry", ERROR_CODES.DECLARATION_MISSING);
  }
  if (entry.link === true || lock.packages?.["../contracts"] !== undefined) {
    return fail(
      id,
      title,
      "the lockfile still pins the dependency as a link to ../contracts. Regenerate it with install-links=true.",
      ERROR_CODES.DECLARATION_MISSING,
    );
  }
  if (entry.resolved !== DECLARED_SPECIFIER) {
    return fail(id, title, `the lockfile resolves the dependency to ${String(entry.resolved)}, expected ${DECLARED_SPECIFIER}`, ERROR_CODES.DECLARATION_MISSING);
  }
  return pass(id, title, `${DECLARED_SPECIFIER}, install-links=true, lockfile records a packed package`);
}

// ── PKG-02 / PKG-03 ─────────────────────────────────────────────────────────

/**
 * كل تبعية سِجِلّ معلنة لها مجلد قابل للقراءة. الوجود وحده لا يكفي: نقرأ بيانها.
 * الحزمة المحلّية مستثناة هنا عمدًا — تملكها فحوص التحقّق التالية، فيبقى رمز
 * الخطأ دالًّا على السبب لا على أول عرَض.
 */
function installedNames(packagePath) {
  const manifest = readJson(join(packagePath, "package.json"));
  return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})].filter(
    (name) => name !== CONTRACTS_PACKAGE,
  );
}

function checkInstalled(root, packageName) {
  const id = packageName === "contracts" ? "PKG-02" : "PKG-03";
  const title = `${packageName} dependencies are installed and readable`;
  const packagePath = join(root, packageName);
  const modules = join(packagePath, "node_modules");
  if (!existsSync(modules)) {
    return fail(id, title, `${packageName}/node_modules is absent`, ERROR_CODES.DEPENDENCIES_NOT_INSTALLED);
  }
  const missing = [];
  for (const name of installedNames(packagePath)) {
    const manifest = join(modules, ...name.split("/"), "package.json");
    try {
      readJson(manifest);
    } catch (error) {
      missing.push(`${name} (${error.code ?? error.message})`);
    }
  }
  if (missing.length > 0) {
    return fail(id, title, `unreadable or absent: ${missing.join(", ")}`, ERROR_CODES.DEPENDENCIES_NOT_INSTALLED);
  }
  return pass(id, title, `${installedNames(packagePath).length} declared dependencies present`);
}

// ── PKG-04 ──────────────────────────────────────────────────────────────────

/**
 * شكل التحقّق نفسه. المطلوب مجلد حقيقي من ملفات عادية: أي نقطة إعادة تحليل
 * هنا — رابط لينكس أو junction ويندوز — تعني أن الاستراتيجية القديمة عادت،
 * ومعها هشاشة الشجرة المشتركة بين نظامي تشغيل.
 */
function checkMaterialization(root) {
  const id = "PKG-04";
  const title = "the @polaris/contracts dependency is materialised as a packed package, not a link";
  const target = materializedPath(root);

  let entry;
  try {
    entry = lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fail(id, title, `${target} does not exist`, ERROR_CODES.MATERIALIZATION_MISSING);
    }
    return fail(id, title, `${target} cannot be inspected: ${error.code ?? error.message}`, ERROR_CODES.MATERIALIZATION_FOREIGN);
  }

  if (entry.isSymbolicLink()) {
    return fail(
      id,
      title,
      `${target} is a link (symlink or junction), not a packed package. A link is authored by whichever ` +
        "operating system last installed here, and does not resolve on the other one.",
      ERROR_CODES.MATERIALIZATION_FOREIGN,
    );
  }
  if (!entry.isDirectory()) {
    return fail(id, title, `${target} is not a directory`, ERROR_CODES.MATERIALIZATION_MISSING);
  }

  let installed;
  try {
    installed = readJson(join(target, "package.json"));
  } catch (error) {
    return fail(id, title, `${target}/package.json is not readable: ${error.code ?? error.message}`, ERROR_CODES.MATERIALIZATION_MISSING);
  }
  const source = readJson(join(root, "contracts", "package.json"));
  if (installed.name !== CONTRACTS_PACKAGE || installed.version !== source.version) {
    return fail(
      id,
      title,
      `the installed package identifies as ${String(installed.name)}@${String(installed.version)}, expected ${CONTRACTS_PACKAGE}@${String(source.version)}`,
      ERROR_CODES.MATERIALIZATION_STALE,
    );
  }

  // ولا يكون المجلد هو مصدر العقود نفسه متنكّرًا: نسخة مثبَّتة، لا مرآة له.
  if (realpathSync(target) === realpathSync(join(root, "contracts"))) {
    return fail(id, title, `${target} resolves to the contracts source directory itself`, ERROR_CODES.MATERIALIZATION_FOREIGN);
  }
  return pass(id, title, `${MATERIALIZATION} → ${target} (${CONTRACTS_PACKAGE}@${String(installed.version)})`);
}

// ── PKG-05 ──────────────────────────────────────────────────────────────────

/**
 * بقايا تثبيت نصف منتهٍ. npm يُقاعِد المدخل القديم باسم ‎.<name>-<suffix>‎ ثم
 * يحذفه عند النجاح؛ بقاؤه يعني أن تثبيتًا لم يكتمل — غالبًا لأن نظام تشغيل آخر
 * كتب المدخل الأصلي. وجوده وحده سبب كافٍ لإعادة التثبيت.
 */
function checkNoRetiredEntries(root) {
  const id = "PKG-05";
  const title = "no retired or half-installed entries remain beside the package";
  const scope = join(root, "runtime", "node_modules", "@polaris");
  if (!existsSync(scope)) {
    return fail(id, title, `${scope} does not exist`, ERROR_CODES.MATERIALIZATION_MISSING);
  }
  const leftovers = readdirSync(scope).filter((name) => name !== "contracts");
  if (leftovers.length > 0) {
    return fail(
      id,
      title,
      `leftover entries in ${scope}: ${leftovers.join(", ")}. An install did not finish cleanly on this machine.`,
      ERROR_CODES.MATERIALIZATION_UNCLEAN,
    );
  }
  return pass(id, title, "only the contracts package is present");
}

// ── PKG-06 ──────────────────────────────────────────────────────────────────

/** ما تعلنه الحزمة المصدر يجب أن يوجد على القرص قبل أن يُحزَم أي شيء منها. */
function checkContractsBuilt(root) {
  const id = "PKG-06";
  const title = "the contracts source package exposes built artefacts for everything it declares";
  const contracts = join(root, "contracts");
  const manifest = readJson(join(contracts, "package.json"));
  const entry = manifest.exports?.["."];
  const declared = [
    ["exports['.'].types", entry?.types],
    ["exports['.'].import", entry?.import],
    ["types", manifest.types],
    ["main", manifest.main],
  ];

  const absent = [];
  for (const [field, value] of declared) {
    if (typeof value !== "string") {
      absent.push(`${field} is not declared`);
      continue;
    }
    if (!existsSync(join(contracts, value))) absent.push(`${field} → ${value}`);
  }
  if (absent.length > 0) {
    return fail(
      id,
      title,
      `not present on disk: ${absent.join(", ")}. Build contracts before runtime materialises the package.`,
      ERROR_CODES.CONTRACTS_NOT_BUILT,
    );
  }
  if (manifest.types !== entry?.types || manifest.main !== entry?.import) {
    return fail(id, title, "main/types disagree with the exports map, so resolvers can disagree with each other", ERROR_CODES.CONTRACTS_NOT_BUILT);
  }
  return pass(id, title, `${entry.import} and ${entry.types} exist and agree with main/types`);
}

// ── PKG-07 ──────────────────────────────────────────────────────────────────

/**
 * الحزمة المُحزَّمة تحمل فعلًا ما يعلنه exports، وبمحتوى مطابق بالبصمة لمخرجات
 * بناء العقود. هنا يظهر خطأ الترتيب صراحةً: تثبيت قبل البناء يُنتج حزمة بلا
 * dist، ونجاحه لا يعني شيئًا.
 */
function checkMaterializedSurface(root) {
  const id = "PKG-07";
  const title = "the materialised package carries the declared export surface, byte-identical to the build";
  const contracts = join(root, "contracts");
  const target = materializedPath(root);
  const manifest = readJson(join(contracts, "package.json"));
  const entry = manifest.exports?.["."];
  const relativePaths = [entry?.types, entry?.import, manifest.types, manifest.main].filter(
    (value) => typeof value === "string",
  );

  const absent = [];
  for (const value of [...new Set(relativePaths)]) {
    if (!existsSync(join(target, value))) absent.push(value);
  }
  if (absent.length > 0) {
    return fail(
      id,
      title,
      `the installed package is missing ${absent.join(", ")}. It was packed before contracts was built: ` +
        "materialise runtime only after the contracts build.",
      ERROR_CODES.CONTRACTS_NOT_BUILT,
    );
  }

  const drifted = [];
  for (const value of [...new Set(relativePaths)]) {
    if (digest(join(target, value)) !== digest(join(contracts, value))) drifted.push(value);
  }
  if (drifted.length > 0) {
    return fail(
      id,
      title,
      `the installed package differs from the contracts build at ${drifted.join(", ")}; re-materialise it`,
      ERROR_CODES.MATERIALIZATION_STALE,
    );
  }
  return pass(id, title, `${relativePaths.length} declared paths present and identical to contracts/`);
}

// ── PKG-08 ──────────────────────────────────────────────────────────────────

const NODE_RESOLUTION_PROBE = [
  'const url = import.meta.resolve("@polaris/contracts");',
  'const module = await import("@polaris/contracts");',
  "process.stdout.write(JSON.stringify({",
  "  url,",
  "  exported: Object.keys(module).length,",
  '  callable: typeof module.validateContract === "function",',
  "}));",
].join("\n");

/**
 * الإثبات الحقيقي: Node نفسه يحلّ الحزمة ويحمّلها من داخل runtime.
 * نجاح tsc لا يثبت هذا، ولذلك يُقاس منفصلًا وفي عملية مستقلة.
 */
function checkNodeResolution(root) {
  const id = "PKG-08";
  const title = "Node resolves and loads @polaris/contracts from the runtime package";
  const runtime = join(root, "runtime");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", NODE_RESOLUTION_PROBE], {
    cwd: runtime,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NODE_PATH: "" },
  });

  if (result.status !== 0) {
    const reason = (result.stderr ?? "").trim().split("\n").slice(0, 3).join(" | ");
    return fail(id, title, `node could not import the package from runtime: ${reason}`, ERROR_CODES.RESOLUTION_UNPROVEN);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    return fail(id, title, `the resolution probe produced no readable report: ${result.stdout}`, ERROR_CODES.RESOLUTION_UNPROVEN);
  }
  if (!report.callable) {
    return fail(id, title, "the package loaded but does not expose validateContract; runtime imports it", ERROR_CODES.RESOLUTION_UNPROVEN);
  }

  const expectedPrefix = pathToFileURL(join(realpathSync(materializedPath(root)), "dist") + sep).href;
  if (!report.url.toLowerCase().startsWith(expectedPrefix.toLowerCase())) {
    return fail(id, title, `resolved to ${report.url}, which is outside the materialised package ${expectedPrefix}`, ERROR_CODES.RESOLUTION_UNPROVEN);
  }
  return pass(id, title, `${report.url} loaded, ${report.exported} exported bindings`);
}

// ── PKG-09 ──────────────────────────────────────────────────────────────────

/**
 * الأنواع تُحلّ بمُحلِّل TypeScript نفسه، بنفس إعدادات runtime، لا بفحص وجود ملف.
 * alias في tsconfig كان سيرضي هذا الفحص وحده — ولذلك لا يقف وحده أبدًا.
 */
function checkTypeScriptResolution(root) {
  const id = "PKG-09";
  const title = "TypeScript resolves the package declarations with the runtime's own settings";
  const runtime = join(root, "runtime");
  let ts;
  try {
    ts = createRequire(join(runtime, "package.json"))("typescript");
  } catch (error) {
    return fail(id, title, `typescript is not installed in runtime: ${error.code ?? error.message}`, ERROR_CODES.DEPENDENCIES_NOT_INSTALLED);
  }

  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
  };
  const containing = join(runtime, "src", "runtime.ts");
  const resolved = ts.resolveModuleName(CONTRACTS_PACKAGE, containing, options, ts.sys);
  const file = resolved.resolvedModule?.resolvedFileName;
  if (file === undefined) {
    return fail(
      id,
      title,
      `TypeScript ${ts.version} cannot resolve ${CONTRACTS_PACKAGE} from ${containing}. This is the TS2307 the runtime typecheck reports.`,
      ERROR_CODES.TYPES_UNRESOLVED,
    );
  }
  if (!file.endsWith(".d.ts") || !existsSync(file)) {
    return fail(id, title, `TypeScript resolved ${file}, which is not an existing declaration file`, ERROR_CODES.TYPES_UNRESOLVED);
  }
  const inside = relative(realpathSync(materializedPath(root)), realpathSync(file));
  if (inside.startsWith("..")) {
    return fail(id, title, `TypeScript resolved ${file}, which is outside the materialised package`, ERROR_CODES.TYPES_UNRESOLVED);
  }
  return pass(id, title, `TypeScript ${ts.version} → ${file}`);
}

// ── PKG-10 ──────────────────────────────────────────────────────────────────

function collectFiles(directory, extensions, accumulator = []) {
  if (!existsSync(directory)) return accumulator;
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.name === "node_modules" || item.name === "dist") continue;
    const full = join(directory, item.name);
    if (item.isDirectory()) collectFiles(full, extensions, accumulator);
    else if (extensions.some((extension) => item.name.endsWith(extension))) accumulator.push(full);
  }
  return accumulator;
}

/**
 * ADR-002: مصدر الحقيقة واحد. لا نسخة من مصادر العقود ولا من مخططاتها داخل
 * مصدر runtime. يُقاس بالمحتوى لا بالاسم.
 *
 * الحزمة المثبَّتة تحت node_modules ليست تكرارًا: هي أثر مدير حزم، مشتقّ آليًا
 * من المصدر، مُهمَل في git، ويُثبت PKG-07 أنه مطابق للبناء بالبصمة. التكرار
 * الممنوع هو مصدرٌ ثانٍ يُحرَّر بيد إنسان.
 */
function checkNoDuplication(root) {
  const id = "PKG-10";
  const title = "the contracts source of truth is not duplicated inside runtime source";
  const contracts = join(root, "contracts");
  const runtime = join(root, "runtime");

  const forbiddenDirectories = [join(runtime, "contracts"), join(runtime, "schemas"), join(runtime, "src", "contracts")];
  const present = forbiddenDirectories.filter((path) => existsSync(path));
  if (present.length > 0) {
    return fail(id, title, `contract-shaped directories inside runtime: ${present.map((p) => relative(root, p)).join(", ")}`, ERROR_CODES.CONTRACTS_DUPLICATED);
  }

  const manifest = readJson(join(runtime, "package.json"));
  const contractOnly = ["ajv", "ajv-formats", "json-schema-to-typescript"];
  const leaked = contractOnly.filter(
    (name) => manifest.dependencies?.[name] !== undefined || manifest.devDependencies?.[name] !== undefined,
  );
  if (leaked.length > 0) {
    return fail(id, title, `runtime declares contract-owned dependencies directly: ${leaked.join(", ")}`, ERROR_CODES.CONTRACTS_DUPLICATED);
  }

  const sources = new Map();
  for (const path of collectFiles(join(contracts, "src"), [".ts"])) sources.set(digest(path), relative(root, path));
  for (const path of collectFiles(join(contracts, "schemas"), [".json"])) sources.set(digest(path), relative(root, path));
  for (const path of collectFiles(join(contracts, "generated"), [".ts"])) sources.set(digest(path), relative(root, path));

  const copies = [];
  for (const path of [...collectFiles(join(runtime, "src"), [".ts", ".json"]), ...collectFiles(join(runtime, "tests"), [".ts", ".json"])]) {
    const found = sources.get(digest(path));
    if (found !== undefined) copies.push(`${relative(root, path)} is a copy of ${found}`);
  }
  if (copies.length > 0) {
    return fail(id, title, copies.join("; "), ERROR_CODES.CONTRACTS_DUPLICATED);
  }
  return pass(id, title, `${sources.size} contract sources, none copied into runtime source`);
}

// ── PKG-11 ──────────────────────────────────────────────────────────────────

/**
 * نظافة مسار الحلّ. Node يصعد من runtime إلى جذور أعلى بحثًا عن node_modules،
 * وأي شجرة أخرى داخل المستودع تستطيع أن تخطف الحزمة. البقايا المعزولة تبقى
 * دليلًا، بشرط أن يُثبت هنا أنها خارج كل مسار حلّ.
 */
function checkResolutionPath(root) {
  const id = "PKG-11";
  const title = "nothing outside the runtime package can take part in resolving @polaris/contracts";

  if ((process.env.NODE_PATH ?? "").trim() !== "") {
    return fail(id, title, `NODE_PATH is set to "${process.env.NODE_PATH}"; module resolution is no longer decided by the repository`, ERROR_CODES.RESOLUTION_PATH_POLLUTED);
  }

  const rootModules = join(root, "node_modules");
  if (existsSync(rootModules)) {
    return fail(id, title, `${rootModules} exists and shadows the runtime dependency tree`, ERROR_CODES.RESOLUTION_PATH_POLLUTED);
  }

  const offenders = [];
  for (const name of QUARANTINE_DIRECTORIES) {
    const directory = join(root, name);
    if (!existsSync(directory)) continue;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      offenders.push(`${name} is unreadable (${error.code ?? error.message})`);
      continue;
    }
    for (const item of entries) {
      if (item.name === "node_modules") offenders.push(`${name}/node_modules`);
    }
  }
  if (offenders.length > 0) {
    return fail(id, title, `quarantined directories carry resolvable trees: ${offenders.join(", ")}`, ERROR_CODES.RESOLUTION_PATH_POLLUTED);
  }

  const quarantined = QUARANTINE_DIRECTORIES.filter((name) => existsSync(join(root, name)));
  return pass(
    id,
    title,
    quarantined.length === 0
      ? "no repository-level node_modules, no quarantined directories"
      : `no repository-level node_modules; quarantined and unreachable: ${quarantined.join(", ")}`,
  );
}

// ── التشغيل ─────────────────────────────────────────────────────────────────

/**
 * يُشغّل الفحوص بالترتيب الذي يجعل أول فشل هو السبب لا العرَض: الإعلان، ثم
 * التثبيت، ثم شكل التحقّق، ثم البناء، ثم سطح الحزمة، ثم الحلّ الفعلي.
 */
export function runChecks(root) {
  const checks = [];
  const guarded = (body) => {
    try {
      return body();
    } catch (error) {
      return fail("PKG-XX", "an unexpected condition stopped the check", String(error?.stack ?? error), ERROR_CODES.RESOLUTION_UNPROVEN);
    }
  };

  checks.push(guarded(() => checkDeclaration(root)));
  checks.push(guarded(() => checkInstalled(root, "contracts")));
  checks.push(guarded(() => checkInstalled(root, "runtime")));
  checks.push(guarded(() => checkMaterialization(root)));
  checks.push(guarded(() => checkNoRetiredEntries(root)));
  checks.push(guarded(() => checkContractsBuilt(root)));
  checks.push(guarded(() => checkMaterializedSurface(root)));
  checks.push(guarded(() => checkNodeResolution(root)));
  checks.push(guarded(() => checkTypeScriptResolution(root)));
  checks.push(guarded(() => checkNoDuplication(root)));
  checks.push(guarded(() => checkResolutionPath(root)));
  return checks;
}

export function firstErrorCode(checks) {
  return checks.find((check) => check.status === "FAIL")?.error_code ?? null;
}

export { CONTRACTS_PACKAGE, DECLARED_SPECIFIER, QUARANTINE_DIRECTORIES };
