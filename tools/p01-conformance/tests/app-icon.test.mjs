// حارس العيب P01_WINDOWS_RESOURCE_ICON_MISSING.
// يعمل على الشجرة الحقيقية، ثم على حالات مصطنعة تثبت أن الحارس يرفض فعلًا.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildIco, checkTauriIcons, decodeRgbaPng, icoMatchesSource, inspectIco } from "../app-icon.mjs";
import { generateAppIcon } from "../make-app-icon.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP = path.join(ROOT, "desktop", "host", "app");
const disk = { readText: (p) => readFileSync(p, "utf8"), readBytes: (p) => readFileSync(p), exists: existsSync, pathApi: path };

function fake(icons, files = {}) {
  const config = JSON.stringify({ bundle: { icon: icons } });
  const key = (p) => path.relative(path.resolve("/app"), path.resolve(p)).split(path.sep).join("/");
  return {
    readText: () => config,
    readBytes: (p) => files[key(p)],
    exists: (p) => key(p) in files,
    pathApi: path,
  };
}

const verdicts = (results) => Object.fromEntries(results.map((r) => [r.id, r.verdict]));
const source = { width: 32, height: 32, pixels: Buffer.alloc(32 * 32 * 4, 0x80) };

for (const id of ["P01-ASSET-001", "P01-ASSET-002", "P01-ASSET-003", "P01-ASSET-004"]) {
  test(`${id} holds for the real tree`, () => {
    const result = checkTauriIcons(APP, disk).find((r) => r.id === id);
    assert.equal(result.verdict, "PASS", result.detail);
  });
}

test("icon.ico matches its source in every frame (no hand-edited drift)", () => {
  const { target, source: png } = generateAppIcon(ROOT);
  assert.ok(icoMatchesSource(readFileSync(target), png));
});

test("the drift check notices a changed pixel", () => {
  const bytes = Buffer.from(buildIco(source));
  bytes[6 + 7 * 16 + 60] ^= 0xff;
  assert.equal(icoMatchesSource(bytes, source), false);
});

test("the 32px frame reproduces the canonical icon.png pixel for pixel", () => {
  const png = decodeRgbaPng(readFileSync(path.join(APP, "icons", "icon.png")));
  const ico = readFileSync(path.join(APP, "icons", "icon.ico"));
  const frames = inspectIco(ico).frames;
  const index = frames.findIndex((f) => f.width === 32);
  const at = 6 + index * 16;
  const data = ico.subarray(ico.readUInt32LE(at + 12), ico.readUInt32LE(at + 12) + ico.readUInt32LE(at + 8));
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const s = (y * 32 + x) * 4;
      const d = 40 + ((31 - y) * 32 + x) * 4;
      assert.deepEqual([data[d + 2], data[d + 1], data[d], data[d + 3]], [...png.pixels.subarray(s, s + 4)]);
    }
  }
});

test("rejects a missing .ico (the original defect)", () => {
  const v = verdicts(checkTauriIcons("/app", fake(["icons/icon.png"], { "icons/icon.png": Buffer.from([1]) })));
  assert.equal(v["P01-ASSET-001"], "FAIL");
  assert.equal(v["P01-ASSET-003"], "FAIL");
});

test("rejects a declared .ico that is absent or empty", () => {
  assert.equal(verdicts(checkTauriIcons("/app", fake(["icons/icon.ico"])))["P01-ASSET-001"], "FAIL");
  const empty = fake(["icons/icon.ico"], { "icons/icon.ico": Buffer.alloc(0) });
  assert.equal(verdicts(checkTauriIcons("/app", empty))["P01-ASSET-001"], "FAIL");
});

test("rejects absolute and drive-letter icon paths", () => {
  for (const bad of ["C:\\Users\\x\\icon.ico", "D:/absolute/icon.ico", "/etc/icon.ico"]) {
    assert.equal(verdicts(checkTauriIcons("/app", fake([bad])))["P01-ASSET-002"], "FAIL", bad);
  }
});

test("rejects an icon path that escapes the app directory", () => {
  assert.equal(verdicts(checkTauriIcons("/app", fake(["../../secret.ico"])))["P01-ASSET-004"], "FAIL");
});

test("rejects a corrupt container and one without a 256px frame", () => {
  const corrupt = fake(["icons/icon.ico"], { "icons/icon.ico": Buffer.from("not an icon at all") });
  assert.equal(verdicts(checkTauriIcons("/app", corrupt))["P01-ASSET-003"], "FAIL");
  const small = fake(["icons/icon.ico"], { "icons/icon.ico": buildIco(source, [16, 32]) });
  assert.equal(verdicts(checkTauriIcons("/app", small))["P01-ASSET-003"], "FAIL");
  const truncated = buildIco(source).subarray(0, 200);
  assert.ok(inspectIco(truncated).problems.length > 0);
});

test("generation is deterministic", () => {
  assert.ok(buildIco(source).equals(buildIco(source)));
});
