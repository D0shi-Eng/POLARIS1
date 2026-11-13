// حارس العيب P01_PRODUCT_BINARY_BUILT_IN_TAURI_DEV_MODE.
// الشجرة الحقيقية أولًا، ثم حالات مصطنعة تثبت أن الحارس يرفض فعلًا.
// سطر الـcfgs في حالة الرفض منقول من مخرَج البناء الأصلي الذي أنتج نافذة
// ERR_CONNECTION_REFUSED: target\release\build\tauri-*\output احتوى cargo:rustc-cfg=dev.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkBuildMessages,
  checkStaticBuildMode,
  devServerReferences,
  executableLines,
  hostBuildInvocations,
  packageName,
} from "../build-mode.mjs";
import { frontendVerdict } from "../p01-native.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

for (const result of checkStaticBuildMode(ROOT)) {
  test(`${result.id} holds for the real tree`, () => {
    assert.equal(result.verdict, "PASS", result.detail);
  });
}

const EXE = "D:\\POLARIS\\desktop\\host\\target\\release\\polaris-desktop.exe";
const script = (name, cfgs) =>
  JSON.stringify({ reason: "build-script-executed", package_id: name, cfgs, out_dir: "x" });
const bin = (features, executable = EXE) =>
  JSON.stringify({
    reason: "compiler-artifact",
    package_id: "path+file:///D:/POLARIS/desktop/host/app#polaris-host@0.1.0",
    target: { kind: ["bin"], name: "polaris-desktop" },
    features,
    executable,
  });
const TAURI = "registry+https://github.com/rust-lang/crates.io-index#tauri@2.11.5";
const HOST = "path+file:///D:/POLARIS/desktop/host/app#polaris-host@0.1.0";

test("REGRESSION: the observed dev-mode build is classified DEV", () => {
  const text = [script(TAURI, ["dev", "desktop"]), script(HOST, ["desktop", "dev"]), bin([])].join("\r\n");
  const verdict = checkBuildMessages(text, "product", EXE);
  assert.equal(verdict.mode, "DEV");
});

test("a packaged product build is classified PACKAGED", () => {
  const text = [script(TAURI, ["custom_protocol", "desktop"]), script(HOST, ["desktop"]), bin(["custom-protocol"])].join("\n");
  assert.equal(checkBuildMessages(text, "product", EXE).mode, "PACKAGED");
});

test("the product must not carry e2e, the measurement binary must", () => {
  const good = [script(TAURI, ["desktop"]), script(HOST, ["desktop"])];
  assert.equal(checkBuildMessages([...good, bin(["custom-protocol", "e2e"])].join("\n"), "product", EXE).mode, "DEV");
  assert.equal(checkBuildMessages([...good, bin(["custom-protocol"])].join("\n"), "measurement", EXE).mode, "DEV");
  assert.equal(checkBuildMessages([...good, bin(["custom-protocol", "e2e"])].join("\n"), "measurement", EXE).mode, "PACKAGED");
});

test("a binary other than the one that is launched is rejected", () => {
  const text = [script(TAURI, []), script(HOST, []), bin(["custom-protocol"], "D:\\other\\polaris-desktop.exe")].join("\n");
  assert.equal(checkBuildMessages(text, "product", EXE).mode, "DEV");
});

test("missing messages are UNKNOWN, never PACKAGED", () => {
  assert.equal(checkBuildMessages("", "product", EXE).mode, "UNKNOWN");
  assert.equal(checkBuildMessages("   Compiling tauri\n", "product", EXE).mode, "UNKNOWN");
});

test("package names are read from both cargo id formats", () => {
  assert.equal(packageName(TAURI), "tauri");
  assert.equal(packageName("registry+https://x#tauri-build@2.0.0"), "tauri-build");
  assert.equal(packageName("tauri 2.11.5 (registry+https://github.com/rust-lang/crates.io-index)"), "tauri");
  assert.equal(packageName("path+file:///D:/POLARIS/desktop/host/polaris-host#0.1.0"), "polaris-host");
});

test("REGRESSION: the old runner line is seen as a build without the packaged frontend", () => {
  const [build] = hostBuildInvocations(["try { & $script:CargoCommand 'build' '--release' '-p' 'polaris-host' | Out-Host } finally { Pop-Location }"]);
  assert.deepEqual(build.features, []);
});

test("a dev server start or address in an executable line is found; comments are ignored", () => {
  const lines = executableLines([
    "# npm run dev is never used here",
    "<#",
    "  vite dev http://localhost:5173",
    "#>",
    "& $script:NpmCommand 'run' 'dev'",
    "Start-Process npx -ArgumentList 'vite'",
    "$u = 'http://localhost:5173'",
    "& $script:NpmCommand 'run' 'build'",
  ].join("\r\n"));
  assert.equal(devServerReferences(lines).length, 3);
});

test("P01-NATIVE-ASSET-001 accepts only a packaged, standalone, packaged-origin run", () => {
  const run = { dev_server_listening: false, startup_report: { renderer_origin: "http://tauri.localhost" } };
  assert.equal(frontendVerdict("PACKAGED", run).verdict, "PASS");
  assert.equal(frontendVerdict("DEV", run).verdict, "FAIL");
  assert.equal(frontendVerdict("PACKAGED", { ...run, dev_server_listening: true }).reason, "DEV_SERVER_LISTENING_AT_LAUNCH");
  assert.equal(frontendVerdict("PACKAGED", { ...run, dev_server_listening: null }).reason, "STANDALONE_NOT_PROVEN");
  const dev = { ...run, startup_report: { renderer_origin: "http://localhost:5173" } };
  assert.equal(frontendVerdict("PACKAGED", dev).reason, "RENDERER_NOT_LOADED_FROM_PACKAGED_ASSETS");
  assert.equal(frontendVerdict("PACKAGED", { ...run, startup_report: {} }).reason, "RENDERER_ORIGIN_NOT_REPORTED");
  assert.equal(frontendVerdict("PACKAGED", null).verdict, "NOT_TESTED");
});
