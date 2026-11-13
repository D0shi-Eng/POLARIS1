// حارس صنف العيب P01_PRODUCT_BINARY_BUILT_IN_TAURI_DEV_MODE.
//
// العيب: المشغّل بنى المنتج بـ`cargo build --release` وحده. ملف `release` لا
// يعني بناء Tauri إنتاجيًا: بلا الميزة `tauri/custom-protocol` يُصدر سكربت بناء
// tauri ‏`cargo:rustc-cfg=dev`، فيضمّن `generate_context!` قيمة `devUrl`، وتفتح
// نافذة المنتج http://localhost:5173 بدل ملفات `frontendDist`.
//
// طبقتان:
//  - فحص ساكن قبل الترجمة: الإعداد، والميزة، وأوامر المشغّل، وغياب خادم التطوير.
//  - فحص بعد البناء: رسائل cargo بصيغة JSON للبناء نفسه، لا تخمين من مجلد
//    `target`. رسالة `build-script-executed` تحمل `cfgs` الفعلية، ورسالة
//    `compiler-artifact` تحمل مسار الثنائي والميزات الفعلية.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument } from "./p01-groups.mjs";

export const FEATURE = "custom-protocol";

/** أصول الواجهة المحزومة في Tauri v2. أي أصل آخر ليس الملفات المحزومة. */
export const PACKAGED_ORIGINS = Object.freeze(["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]);

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

const defaultIo = {
  readText: (p) => readFileSync(p, "utf8"),
  exists: existsSync,
  list: (p) => (existsSync(p) ? readdirSync(p) : []),
};

const result = (id, ok, detail = "") => ({ id, verdict: ok ? "PASS" : "FAIL", detail });

/** أسطر PowerShell التنفيذية فقط: بلا تعليقات `#` وبلا كتل `<# #>`. */
export function executableLines(source) {
  const lines = [];
  let block = false;
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (block) {
      if (line.includes("#>")) block = false;
      continue;
    }
    if (line.startsWith("<#")) {
      if (!line.includes("#>")) block = true;
      continue;
    }
    if (line === "" || line.startsWith("#")) continue;
    lines.push(line);
  }
  return lines;
}

/** قسم `[features]` من Cargo.toml كخريطة اسم إلى نص القيمة. */
export function cargoFeatures(toml) {
  const features = {};
  let inside = false;
  for (const raw of toml.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line.startsWith("[")) {
      inside = line === "[features]";
      continue;
    }
    if (!inside || line === "") continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (match) features[match[1]] = match[2];
  }
  return features;
}

/** أوامر `cargo build` التي تبني المضيف، مع الميزات الممرَّرة لكل منها. */
export function hostBuildInvocations(lines) {
  return lines
    .filter((line) => /'build'/.test(line) && /'polaris-host'/.test(line))
    .map((line) => {
      const match = /'--features'\s+'([^']*)'/.exec(line);
      const features = match ? match[1].split(/[\s,]+/).filter(Boolean) : [];
      return { line, features, targetDir: /'--target-dir'\s+'([^']*)'/.exec(line)?.[1] ?? "target" };
    });
}

/** ما يبدأ خادم تطوير أو يعتمد عليه. أي تطابق في سطر تنفيذي يُرفض. */
const DEV_SERVER_PATTERNS = [
  /'run'\s+'dev'/i,
  /\brun\s+dev\b/i,
  /\bvite\b/i,
  /\btauri\s*'?\s*'?dev\b/i,
  /\b(localhost|127\.0\.0\.1):\d+/i,
];

export function devServerReferences(lines) {
  return lines.filter((line) => DEV_SERVER_PATTERNS.some((pattern) => pattern.test(line)));
}

/**
 * الفحص الساكن. يعمل قبل أي ترجمة، ويقرأ الإعداد وسكربتات المشغّل من الشجرة.
 */
export function checkStaticBuildMode(root, io = defaultIo) {
  const app = path.join(root, "desktop", "host", "app");
  const results = [];

  const config = JSON.parse(io.readText(path.join(app, "tauri.conf.json")));
  const build = config.build ?? {};
  const expectedDist = path.resolve(root, "desktop", "renderer", "dist");
  const frontendDist = typeof build.frontendDist === "string" ? build.frontendDist : "";
  const isUrl = /^[a-z]+:\/\//i.test(frontendDist);
  const resolvedDist = isUrl || frontendDist === "" ? "" : path.resolve(app, frontendDist);
  results.push(result(
    "P01-BUILD-001",
    !isUrl && resolvedDist !== "" && path.relative(expectedDist, resolvedDist) === "",
    `frontendDist=${JSON.stringify(frontendDist)} resolves to ${resolvedDist || "(nothing)"}; expected ${expectedDist}`,
  ));

  const devUrl = build.devUrl;
  results.push(result(
    "P01-BUILD-002",
    devUrl === undefined || (typeof devUrl === "string" && LOOPBACK.test(devUrl)),
    `devUrl=${JSON.stringify(devUrl)} is allowed only as a loopback development server`,
  ));
  const hooks = [build.beforeBuildCommand, build.beforeDevCommand].filter((v) => typeof v === "string" && v.trim() !== "");
  results.push(result("P01-BUILD-003", hooks.length === 0, hooks.length ? `build hooks present: ${hooks.join(" | ")}` : "no before*Command hooks"));

  const features = cargoFeatures(io.readText(path.join(app, "Cargo.toml")));
  const declared = features[FEATURE] ?? "";
  const defaults = features.default ?? "";
  results.push(result(
    "P01-BUILD-004",
    /"tauri\/custom-protocol"/.test(declared) && !defaults.includes(FEATURE),
    `features.${FEATURE}=${declared || "(missing)"}; default=${defaults || "(none)"}`,
  ));

  const runnerPath = path.join(root, "tools", "p01-conformance", "run.ps1");
  const runner = executableLines(io.readText(runnerPath));
  const builds = hostBuildInvocations(runner);
  const product = builds.find((b) => b.targetDir === "target");
  const measurement = builds.find((b) => b.targetDir === "target-e2e");
  results.push(result(
    "P01-BUILD-005",
    builds.length === 2 &&
      product !== undefined && product.features.includes(FEATURE) && !product.features.includes("e2e") &&
      measurement !== undefined && measurement.features.includes(FEATURE) && measurement.features.includes("e2e"),
    builds.map((b) => `${b.targetDir}: [${b.features.join(",")}]`).join("; ") || "no host build found",
  ));

  const launchers = ["run.ps1", "desktop-native.ps1", "frontend-lane.ps1"]
    .map((name) => path.join(root, "tools", "p01-conformance", name))
    .filter((p) => io.exists(p));
  const offenders = launchers.flatMap((p) =>
    devServerReferences(executableLines(io.readText(p))).map((line) => `${path.basename(p)}: ${line}`));
  results.push(result("P01-BUILD-006", offenders.length === 0, offenders.join(" | ") || "no dev server is started or addressed"));

  const productExe = runner.some((l) => /^\$productExe\s*=.*'target\\release\\polaris-desktop\.exe'/.test(l));
  const e2eExe = runner.some((l) => /^\$e2eExe\s*=.*'target-e2e\\release\\polaris-desktop\.exe'/.test(l));
  const productLaunches = runner.filter((l) => /Invoke-PolarisLaunchProbe\s+-ExecutablePath\s+\$productExe/.test(l)).length;
  results.push(result(
    "P01-BUILD-007",
    productExe && e2eExe && productLaunches === 2,
    `productExe=${productExe} e2eExe=${e2eExe} productLaunches=${productLaunches}`,
  ));

  return results;
}

/** محتوى `frontendDist` على القرص: صفحة الدخول وأصولها. */
export function checkFrontendDist(root, io = defaultIo) {
  const dist = path.join(root, "desktop", "renderer", "dist");
  const index = path.join(dist, "index.html");
  const assets = io.list(path.join(dist, "assets"));
  const ok = io.exists(index) && assets.some((n) => n.endsWith(".js")) && assets.some((n) => n.endsWith(".css"));
  return result("P01-BUILD-008", ok, `index.html=${io.exists(index)} assets=[${assets.join(",")}]`);
}

/** اسم الحزمة من `package_id` بصيغتي cargo القديمة والجديدة. */
export function packageName(id) {
  const hash = id.lastIndexOf("#");
  if (hash >= 0) {
    const fragment = id.slice(hash + 1);
    const at = fragment.lastIndexOf("@");
    if (at > 0) return fragment.slice(0, at);
    return id.slice(0, hash).replace(/[?].*$/, "").replace(/\/+$/, "").split("/").pop();
  }
  return id.split(" ")[0];
}

/**
 * الفحص بعد البناء، من رسائل cargo نفسها.
 * `artifact` هو `product` أو `measurement`.
 */
export function checkBuildMessages(text, artifact, expectedExe) {
  const messages = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.replace(/^﻿/, "").trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      // سطر ليس JSON. لا يُحتسب.
    }
  }
  const scripts = messages.filter((m) => m.reason === "build-script-executed");
  const scriptFor = (name) => scripts.filter((m) => packageName(String(m.package_id ?? "")) === name);
  const results = [];

  for (const [id, name] of [["P01-BUILD-101", "tauri"], ["P01-BUILD-102", "polaris-host"]]) {
    const seen = scriptFor(name);
    const dev = seen.filter((m) => (m.cfgs ?? []).includes("dev"));
    results.push({
      id,
      verdict: seen.length === 0 ? "INCONCLUSIVE" : dev.length === 0 ? "PASS" : "FAIL",
      detail: seen.length === 0
        ? `no build-script-executed message for ${name}`
        : `${name} cfgs: ${seen.map((m) => `[${(m.cfgs ?? []).join(",")}]`).join(" ")}`,
    });
  }

  const bins = messages.filter((m) =>
    m.reason === "compiler-artifact" &&
    packageName(String(m.package_id ?? "")) === "polaris-host" &&
    (m.target?.kind ?? []).includes("bin") &&
    m.target?.name === "polaris-desktop");
  const bin = bins[bins.length - 1];
  const norm = (p) => path.win32.normalize(String(p ?? "")).toLowerCase();
  const features = bin?.features ?? [];
  const wantE2E = artifact === "measurement";
  const binOk = bin !== undefined &&
    norm(bin.executable) === norm(expectedExe) &&
    features.includes(FEATURE) &&
    features.includes("e2e") === wantE2E;
  results.push({
    id: "P01-BUILD-103",
    verdict: bin === undefined ? "INCONCLUSIVE" : binOk ? "PASS" : "FAIL",
    detail: bin === undefined
      ? "no compiler-artifact message for polaris-desktop"
      : `executable=${bin.executable} expected=${expectedExe} features=[${features.join(",")}]`,
  });

  const mode = results.some((r) => r.verdict === "FAIL")
    ? "DEV"
    : results.every((r) => r.verdict === "PASS") ? "PACKAGED" : "UNKNOWN";
  return { artifact, mode, results };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = path.resolve(argument("--root", process.cwd()));
  const messagesPath = argument("--messages", "");
  let failed = false;
  const print = (r) => {
    console.log(`${r.verdict.padEnd(12)} ${r.id}  ${r.detail}`);
    if (r.verdict !== "PASS") failed = true;
  };

  if (messagesPath === "") {
    for (const r of checkStaticBuildMode(root)) print(r);
    print(checkFrontendDist(root));
  } else {
    const artifact = argument("--artifact", "product");
    const expectedExe = argument("--expected-exe", "");
    const verdict = checkBuildMessages(readFileSync(messagesPath, "utf8"), artifact, expectedExe);
    for (const r of verdict.results) print(r);
    const out = argument("--out", "");
    if (out !== "") writeFileSync(out, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
    console.log(`frontend mode (${artifact}): ${verdict.mode}`);
  }
  process.exitCode = failed ? 1 : 0;
}
