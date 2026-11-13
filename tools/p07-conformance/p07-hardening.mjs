// تصليب Phase-07: ما يُقرأ من الثنائيات المبنية ومن إعداد النافذة ومن المصدر.
//
//   - ترويسة PE لكل ثنائي يُشحن: ASLR (DYNAMIC_BASE وHIGH_ENTROPY_VA)، وDEP (NX_COMPAT)،
//     وControl Flow Guard (GUARD_CF)، والنظام الفرعي (نافذة للمنتج، طرفية لأداة الصيانة).
//   - إعداد Tauri: سياسة المحتوى، ولا Tauri عالميًّا في الصفحة، وبروتوكول الأصول مغلق،
//     وقدرة النافذة الوحيدة بأذوناتها الثلاث، ولا ملحق Tauri في البناء.
//   - المصدر: `unsafe` محصور في ملفات FFI مسمّاة، والنواة والمزوّدون والأداة تمنعه،
//     ولا تشغيل عمليات من كود المنتج، ولا تجاوز للتحقق من شهادات TLS، ومواضع الكتابة
//     على القرص كلها تحت مجلد البيانات أو في مسار يختاره المستخدم.
//
// الاستعمال: node p07-hardening.mjs --root <root>

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, header, P07_TOOLS, RAW_DIRECTORY, writeEvidence } from "./p07-common.mjs";
import { productCode } from "./p07-inventory.mjs";

export const DLL = Object.freeze({ HIGH_ENTROPY_VA: 0x20, DYNAMIC_BASE: 0x40, FORCE_INTEGRITY: 0x80, NX_COMPAT: 0x100, NO_SEH: 0x400, GUARD_CF: 0x4000 });
export const SUBSYSTEM = Object.freeze({ 2: "WINDOWS_GUI", 3: "WINDOWS_CUI" });

/** يقرأ ترويسة PE: الآلة، والصيغة، والنظام الفرعي، وأعلام DllCharacteristics. */
export function readPe(buffer) {
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) return { pe: false, reason: "NO_MZ" };
  const offset = buffer.readUInt32LE(0x3c);
  if (offset + 24 > buffer.length || buffer.readUInt32LE(offset) !== 0x00004550) return { pe: false, reason: "NO_PE_SIGNATURE" };
  const machine = buffer.readUInt16LE(offset + 4);
  const optional = offset + 24;
  const magic = buffer.readUInt16LE(optional);
  // الإزاحتان واحدة في PE32 وPE32+: النظام الفرعي عند 68، والأعلام عند 70.
  const subsystem = buffer.readUInt16LE(optional + 68);
  const characteristics = buffer.readUInt16LE(optional + 70);
  const flags = Object.fromEntries(Object.entries(DLL).map(([name, bit]) => [name, (characteristics & bit) !== 0]));
  return {
    pe: true,
    machine: machine === 0x8664 ? "X64" : machine === 0x14c ? "X86" : machine === 0xaa64 ? "ARM64" : `0x${machine.toString(16)}`,
    format: magic === 0x20b ? "PE32+" : magic === 0x10b ? "PE32" : `0x${magic.toString(16)}`,
    subsystem: SUBSYSTEM[subsystem] ?? `SUBSYSTEM_${subsystem}`,
    dll_characteristics: `0x${characteristics.toString(16).padStart(4, "0")}`,
    flags,
  };
}

/** الأعلام الأربعة المطلوبة لكل ثنائي 64-بت يُشحن. */
export function peHardened(info) {
  if (!info.pe) return false;
  const required = ["DYNAMIC_BASE", "NX_COMPAT", "GUARD_CF", ...(info.format === "PE32+" ? ["HIGH_ENTROPY_VA"] : [])];
  return required.every((flag) => info.flags[flag] === true);
}

export function binaries(root) {
  const release = join(root, "desktop", "host", "target", "release");
  const targets = [
    { id: "product", path: join(release, "polaris-desktop.exe"), subsystem: "WINDOWS_GUI" },
    { id: "maintenance", path: join(release, "polaris-maint.exe"), subsystem: "WINDOWS_CUI" },
  ];
  return targets.map((target) => {
    if (!existsSync(target.path)) return { id: target.id, path: rel(root, target.path), present: false, hardened: false };
    const info = readPe(readFileSync(target.path));
    return {
      id: target.id,
      path: rel(root, target.path),
      present: true,
      ...info,
      expected_subsystem: target.subsystem,
      hardened: peHardened(info) && info.subsystem === target.subsystem,
    };
  });
}

export function webviewChecks(root) {
  const conf = JSON.parse(readFileSync(join(root, "desktop", "host", "app", "tauri.conf.json"), "utf8"));
  const csp = conf?.app?.security?.csp ?? "";
  const capabilityDir = join(root, "desktop", "host", "app", "capabilities");
  const capabilities = readdirSync(capabilityDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(capabilityDir, f), "utf8")));
  const permissions = capabilities.flatMap((c) => c.permissions ?? []);
  const cargo = readFileSync(join(root, "desktop", "host", "app", "Cargo.toml"), "utf8");
  const plugins = [...cargo.matchAll(/^(tauri-plugin-[a-z0-9-]+)\s*=/gm)].map((m) => m[1]);
  const directives = Object.fromEntries(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1).join(" ")]));
  return {
    csp,
    csp_default_self: directives["default-src"] === "'self'",
    csp_script_self: directives["script-src"] === "'self'",
    csp_object_none: directives["object-src"] === "'none'",
    csp_frame_none: directives["frame-src"] === "'none'",
    csp_no_unsafe_eval: !csp.includes("unsafe-eval"),
    global_tauri: conf?.app?.withGlobalTauri === true,
    freeze_prototype: conf?.app?.security?.freezePrototype === true,
    asset_protocol: conf?.app?.security?.assetProtocol?.enable === true,
    capabilities: capabilities.length,
    permissions,
    plugins,
    ok:
      directives["default-src"] === "'self'" &&
      directives["script-src"] === "'self'" &&
      directives["object-src"] === "'none'" &&
      !csp.includes("unsafe-eval") &&
      conf?.app?.withGlobalTauri !== true &&
      conf?.app?.security?.freezePrototype === true &&
      conf?.app?.security?.assetProtocol?.enable !== true &&
      capabilities.length === 1 &&
      permissions.every((p) => ["core:event:default", "core:window:default", "core:webview:default"].includes(p)) &&
      plugins.length === 0,
  };
}

function walk(directory, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (extname(entry.name) === ".rs") found.push(full);
  }
  return found;
}

const rel = (root, file) => relative(root, file).replace(/\\/g, "/");

/** ملفات FFI المسمّاة التي يجوز فيها `unsafe`: طبقة Win32 الرقيقة في الربط وحدها. */
export const DECLARED_UNSAFE_FILES = Object.freeze([
  "desktop/host/app/src/credentials.rs",
  "desktop/host/app/src/desktop_win32.rs",
  "desktop/host/app/src/shutdown.rs",
  // Phase-08 (ADR-028): كائن المهمّة ومُطلِقه، وصندوق AppContainer. ملفّا FFI مسمّيان في حزمة
  // منافذ ويندوز المستقلّة (desktop/host/win)، لا في الربط.
  "desktop/host/win/src/process.rs",
  "desktop/host/win/src/sandbox.rs",
]);

/**
 * من يُطلق عملية في كود المنتج، ولماذا. Phase-07 أُغلق على «لا أحد»؛ Phase-08 (ADR-028) أضاف مُطلِقًا
 * واحدًا مسمّى: كائن المهمّة الذي يشغّل صندوق AppContainer وEdge بلا واجهة، ولا غيره.
 */
export const DECLARED_SPAWNERS = Object.freeze({
  "desktop/host/win/src/process.rs": "the Job-Object launcher: the AppContainer execution sandbox and headless Edge, each tree killed on close",
});

/** مواضع الكتابة على القرص في كود المنتج، ولكلٍّ جذرها. موضع جديد لا يُضاف بصمت. */
export const DECLARED_WRITE_FILES = Object.freeze({
  "desktop/host/core/src/storage/db.rs": "data folder: the store and its pre-migration copy",
  "desktop/host/core/src/storage/lock.rs": "data folder: the instance lock",
  "desktop/host/core/src/p07/backup.rs": "data folder: backups",
  "desktop/host/core/src/p07/restore.rs": "data folder: quarantine and the restored store",
  "desktop/host/core/src/p07/recovery.rs": "data folder: quarantine, the restored store, the recovery report",
  "desktop/host/core/src/p07/retention.rs": "data folder: pruning backups, diagnostics and old downloads",
  "desktop/host/core/src/p06/service.rs": "data folder: diagnostics exports",
  "desktop/host/core/src/p05/browser/runtime.rs": "data folder: quarantined downloads",
  "desktop/host/core/src/p02/projects/workspace.rs": "a workspace root the user chose",
  "desktop/host/core/src/p02/projects/service.rs": "a workspace root the user chose",
  "desktop/host/app/src/startup.rs": "a report path set only by the measurement environment variable",
  // Phase-08 (ADR-028): مساحات المهامّ وما يُشتقّ منها، كلها تحت مجلد البيانات، ومجلد التصدير الذي يطلبه المستخدم.
  "desktop/host/core/src/p08/workspace.rs": "data folder: mission workspaces (confined paths, atomic writes)",
  "desktop/host/core/src/p08/attachments.rs": "data folder: staged attachments and their copy into a mission workspace",
  "desktop/host/core/src/p08/execution/runtime.rs": "data folder: the owned Python runtime copy",
  "desktop/host/core/src/p08/execution/service.rs": "data folder: per-run scripts inside the mission workspace",
  "desktop/host/core/src/p08/execution/tools.rs": "data folder: scripts the agent runs, inside the mission workspace",
  "desktop/host/core/src/p08/workspace_tools.rs": "the export folder, only through an approved export tool call, never overwriting",
  "desktop/host/core/src/p08/ipc.rs": "the export folder, only on the user's own export request, never overwriting",
  "desktop/host/core/src/p08/integrations/device.rs": "data folder: imported workspace bundles after digest checks",
  "desktop/host/core/src/p08/integrations/publish.rs": "data folder: the local publisher's copies after an approval",
  "desktop/host/core/src/p08/browser/service.rs": "data folder: per-mission browser profiles, removed when the session closes",
});

export function sourceChecks(root) {
  // الكود الذي يُشحن. عُدّة القياس (harness) أداة قياس لا تُحزَم، مثل الاختبارات، فلا تُمسح هنا.
  const files = ["core/src", "providers/src", "app/src", "maint/src", "win/src"].flatMap((d) => walk(join(root, "desktop", "host", d)));
  const unsafeFiles = [];
  const spawners = [];
  const tlsBypass = [];
  const writers = [];
  for (const file of files) {
    const text = productCode(readFileSync(file, "utf8"));
    const name = rel(root, file);
    if (/\bunsafe\s*(\{|fn|impl)/.test(text)) unsafeFiles.push(name);
    if (/\b(process::Command|Command::new|CreateProcessW|CreateProcessAsUserW|ShellExecuteExW|WinExec)\b/.test(text)) spawners.push(name);
    if (/danger_accept_invalid|accept_invalid_certs|accept_invalid_hostnames/.test(text)) tlsBypass.push(name);
    if (/fs::(write|rename|remove_file|remove_dir_all|copy|create_dir_all)\s*\(|OpenOptions::new\(\)[\s\S]{0,80}\.(write|create)\(true\)|File::create\(/.test(text)) writers.push(name);
  }
  const forbids = ["core/src/lib.rs", "providers/src/lib.rs", "maint/src/main.rs"].map((f) => ({ file: `desktop/host/${f}`, forbids_unsafe: /#!\[forbid\(unsafe_code\)\]/.test(readFileSync(join(root, "desktop", "host", f), "utf8")) }));
  return {
    files: files.length,
    unsafe_files: unsafeFiles,
    undeclared_unsafe: unsafeFiles.filter((f) => !DECLARED_UNSAFE_FILES.includes(f)),
    forbids,
    spawners,
    undeclared_spawners: spawners.filter((f) => DECLARED_SPAWNERS[f] === undefined),
    tls_bypass: tlsBypass,
    write_sites: writers.map((f) => ({ file: f, root: DECLARED_WRITE_FILES[f] ?? null })),
    undeclared_write_sites: writers.filter((f) => DECLARED_WRITE_FILES[f] === undefined),
  };
}

export function profileFacts(root) {
  const text = readFileSync(join(root, "desktop", "host", "Cargo.toml"), "utf8");
  const config = join(root, "desktop", "host", ".cargo", "config.toml");
  const flags = existsSync(config) ? readFileSync(config, "utf8") : "";
  return {
    release_profile_overrides: /\[profile\.release\]/.test(text),
    control_flow_guard_flag: /-Ccontrol-flow-guard/.test(flags),
    note: "the release profile is Cargo's default: optimised, debug assertions off, debug information stripped",
  };
}

export function hardening(root) {
  return { binaries: binaries(root), webview: webviewChecks(root), source: sourceChecks(root), profile: profileFacts(root) };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = hardening(root);
  writeEvidence(join(root, RAW_DIRECTORY, "hardening.local.json"), { ...header(P07_TOOLS.hardening, root), ...result });
  for (const b of result.binaries) console.log(`${b.id.padEnd(12)} ${b.present ? `${b.format} ${b.subsystem} ${b.dll_characteristics} hardened=${b.hardened}` : "ABSENT"}`);
  console.log(`webview ok=${result.webview.ok}; unsafe undeclared ${result.source.undeclared_unsafe.length}; spawners ${result.source.spawners.length}; tls bypass ${result.source.tls_bypass.length}; undeclared write sites ${result.source.undeclared_write_sites.join(",") || "none"}`);
}
