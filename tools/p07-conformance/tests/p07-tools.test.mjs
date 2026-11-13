// اختبارات أدوات Phase-07: القرّاء والأحكام تُختبر بمدخلات معروفة قبل أن تحكم على التشغيل.
//
// ما يُثبت هنا أن الأداة لا تكذب: قياس غائب NOT_TESTED، ومجموعة فاشلة FAIL، وثنائي بلا
// CFG غير مُصلَّب، ورخصة بلا بديل متساهل مرفوضة، وأحكام الإصدار لا تندمج في «جاهز للإنتاج».

import assert from "node:assert/strict";
import { createHash, verify, createPublicKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateClaim, groupMeasure, P07_CLAIMS, testMeasure } from "../p07-claims.mjs";
import { P07_EVIDENCE, verdictOf, worst } from "../p07-common.mjs";
import { parseThreats } from "../p07-derive.mjs";
import { releaseVerdicts } from "../p07-final-gate.mjs";
import { peHardened, readPe } from "../p07-hardening.mjs";
import { classifyCrate, licenseAllows, parseCargoLock, productCode } from "../p07-inventory.mjs";
import { createLegacyStore, migrationScripts } from "../p07-legacy-db.mjs";
import { buildSignedUpdate } from "../p07-update-fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function pe({ characteristics, subsystem = 2, magic = 0x20b }) {
  const buffer = Buffer.alloc(0x200);
  buffer.writeUInt16LE(0x5a4d, 0);
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.writeUInt32LE(0x00004550, 0x80);
  buffer.writeUInt16LE(0x8664, 0x84);
  buffer.writeUInt16LE(magic, 0x98);
  buffer.writeUInt16LE(subsystem, 0x98 + 68);
  buffer.writeUInt16LE(characteristics, 0x98 + 70);
  return buffer;
}

test("P07-TOOL-01 the PE reader finds ASLR, DEP and CFG, and a binary without CFG is not hardened", () => {
  const full = readPe(pe({ characteristics: 0x20 | 0x40 | 0x100 | 0x4000 }));
  assert.equal(full.format, "PE32+");
  assert.equal(full.subsystem, "WINDOWS_GUI");
  assert.ok(peHardened(full));
  const noCfg = readPe(pe({ characteristics: 0x20 | 0x40 | 0x100 }));
  assert.equal(noCfg.flags.GUARD_CF, false);
  assert.ok(!peHardened(noCfg));
  assert.equal(readPe(Buffer.from("not a binary")).pe, false);
});

test("P07-TOOL-02 lockfile sources: crates.io needs a checksum, git and unknown paths are offenders", () => {
  const lock = parseCargoLock(`[[package]]\nname = "serde"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${"a".repeat(64)}"\n\n[[package]]\nname = "evil"\nversion = "0.1.0"\nsource = "git+https://example.invalid/evil"\n\n[[package]]\nname = "polaris-host-core"\nversion = "0.1.0"\n\n[[package]]\nname = "vendored"\nversion = "0.1.0"\n`);
  assert.deepEqual(lock.map(classifyCrate), ["CRATES_IO", "GIT", "WORKSPACE", "UNKNOWN_PATH"]);
});

test("P07-TOOL-03 a licence is accepted only with a permissive alternative", () => {
  assert.equal(licenseAllows("MIT OR Apache-2.0"), true);
  assert.equal(licenseAllows("MIT/Apache-2.0"), true);
  assert.equal(licenseAllows("MIT OR Apache-2.0 OR LGPL-2.1-or-later"), true);
  assert.equal(licenseAllows("(MIT OR Apache-2.0) AND Unicode-3.0"), true);
  assert.equal(licenseAllows("GPL-3.0-only"), false);
  assert.equal(licenseAllows("AGPL-3.0 OR SSPL-1.0"), false);
  assert.equal(licenseAllows("MIT AND GPL-2.0"), false);
  assert.equal(licenseAllows(null), null);
});

test("P07-TOOL-04 product code excludes the test block and line comments", () => {
  const code = productCode("fn a() {}\n// TcpStream::connect in a comment\n#[cfg(test)]\nmod tests { fn b() { TcpStream::connect(); } }");
  assert.ok(!code.includes("TcpStream"));
  assert.ok(code.includes("fn a()"));
});

test("P07-TOOL-05 an absent measurement is NOT_TESTED, a failing group FAIL, and the worst verdict wins", () => {
  assert.equal(verdictOf(false, true), "NOT_TESTED");
  assert.equal(verdictOf(true, false), "FAIL");
  assert.equal(worst(["PASS", "NOT_TESTED", "PASS"]), "NOT_TESTED");
  assert.equal(worst(["PASS", "FAIL", "BLOCKED"]), "FAIL");
  assert.equal(worst([]), "NOT_TESTED");
  const inputs = { groups: [{ group_id: "G", verdict: "FAIL", reason: "TESTS_FAILED", counts: { tests: 3, passed: 2 }, tests: [{ name: "a", status: "FAIL" }] }] };
  assert.equal(groupMeasure(inputs, "G").verdict, "FAIL");
  assert.equal(groupMeasure(inputs, "ABSENT").verdict, "NOT_TESTED");
  assert.equal(testMeasure(inputs, "G", "a").verdict, "FAIL");
  assert.equal(testMeasure(inputs, "G", "missing").verdict, "NOT_TESTED");
  const few = { groups: [{ group_id: "G", verdict: "PASS", counts: { tests: 1, passed: 1 }, tests: [] }] };
  assert.equal(groupMeasure(few, "G", 5).verdict, "FAIL", "a group with fewer tests than expected passed");
});

test("P07-TOOL-06 every claim belongs to a canonical document or the gate, and none evaluates to PASS on empty inputs", () => {
  const documents = new Set([...P07_EVIDENCE, "phase-07-final-gate"]);
  const empty = { groups: [], gates: {}, sources: {}, threats: [], performance: [] };
  for (const claim of P07_CLAIMS) {
    assert.ok(documents.has(claim.document), `${claim.id} names ${claim.document}`);
    // الشروط الساكنة تقرأ المصدر؛ بلا مصدر لا تنجح.
    assert.notEqual(evaluateClaim(empty, claim).verdict, "PASS", `${claim.id} passed with nothing measured`);
  }
  for (const document of P07_EVIDENCE) assert.ok(P07_CLAIMS.some((c) => c.document === document), `${document} has no condition`);
});

test("P07-TOOL-07 the release verdicts stay separate and never say production ready", () => {
  const unsigned = releaseVerdicts("PASS", { status: "SIGNING_READY_UNSIGNED" }, { platform: { macos_native_verified: false } });
  assert.deepEqual(
    { rc: unsigned.windows_rc, signing: unsigned.signing, macos: unsigned.macos, public: unsigned.public_release, published: unsigned.published },
    { rc: "READY", signing: "SIGNING_READY_UNSIGNED", macos: "FOUNDATION_ONLY", public: "BLOCKED_ON_SIGNING", published: false },
  );
  assert.ok(unsigned.not_claimed.includes("production ready"));
  assert.ok(unsigned.not_claimed.includes("signed build"));
  const failed = releaseVerdicts("FAIL", { status: "SIGNED" }, {});
  assert.equal(failed.windows_rc, "NOT_READY");
  assert.equal(failed.public_release, "BLOCKED_ON_PHASE_07");
  assert.ok(!JSON.stringify(unsigned).includes("PRODUCTION_READY"));
});

test("P07-TOOL-08 the threat model rows carry their test names", () => {
  const rows = parseThreats("| ID | x | y | Tests |\n|---|---|---|---|\n| T-01 | Tampering | control | tests: a_b, `c::d` |\n| T-02 | x | y | tests: |");
  assert.deepEqual(rows.map((r) => [r.id, r.tests]), [["T-01", ["a_b", "c::d"]], ["T-02", []]]);
  const real = parseThreats(readFileSync(join(ROOT, "docs", "phases", "PHASE-07", "PHASE-07-THREAT-MODEL.md"), "utf8"));
  assert.ok(real.length >= 15, `only ${real.length} threats`);
  assert.ok(real.every((r) => r.tests.length > 0), "a threat has no test");
});

test("P07-TOOL-09 the legacy store is built from the product's own migration scripts", async () => {
  const source = readFileSync(join(ROOT, "desktop", "host", "core", "src", "storage", "migrations.rs"), "utf8");
  const scripts = migrationScripts(source);
  assert.ok(scripts.size >= 5 && scripts.has(1));
  assert.ok(scripts.get(1).includes("CREATE TABLE projects"));
  const dir = mkdtempSync(join(tmpdir(), "p07-legacy-"));
  try {
    const out = join(dir, "polaris.db");
    const created = await createLegacyStore(ROOT, out, 1);
    assert.equal(created.schema_version, 1);
    await assert.rejects(() => createLegacyStore(ROOT, out, 1), /REFUSING_TO_OVERWRITE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("P07-TOOL-10 the update fixture signs the exact manifest bytes with a per-run key and describes the real file", () => {
  const dir = mkdtempSync(join(tmpdir(), "p07-update-"));
  try {
    const artifact = join(dir, "POLARIS_0.1.0_x64-setup.exe");
    writeFileSync(artifact, Buffer.from("TEST FIXTURE installer"));
    const first = buildSignedUpdate(artifact);
    const second = buildSignedUpdate(artifact);
    assert.notEqual(first.public_key_hex, second.public_key_hex, "the key is not per run");
    const manifest = JSON.parse(first.signed.manifest_json);
    assert.equal(manifest.artifacts[0].sha256, createHash("sha256").update(readFileSync(artifact)).digest("hex"));
    assert.equal(manifest.channel, "test-fixture");
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(first.public_key_hex, "hex").toString("base64url") }, format: "jwk" });
    assert.ok(verify(null, Buffer.from(first.signed.manifest_json), key, Buffer.from(first.signed.signature_hex, "hex")));
    assert.ok(!verify(null, Buffer.from(first.signed.manifest_json.replace("0.2.0", "0.9.0")), key, Buffer.from(first.signed.signature_hex, "hex")));
    assert.ok(!JSON.stringify(first).includes("PRIVATE"), "a private key left the fixture");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("P07-TOOL-11 a prior gate is fresh by decided_at (frozen Phase-00) or measured_at, and stale before the run", () => {
  const claim = P07_CLAIMS.find((c) => c.id === "P07-R0");
  const run = { run_started: "2026-09-24T22:24:58Z" };
  assert.equal(evaluateClaim({ run, gates: { "00": { verdict: "PASS", decided_at: "2026-09-24T22:47:14Z" } } }, claim).verdict, "PASS");
  assert.equal(evaluateClaim({ run, gates: { "00": { verdict: "PASS", measured_at: "2026-09-24T22:47:14Z" } } }, claim).verdict, "PASS");
  assert.equal(evaluateClaim({ run, gates: { "00": { verdict: "PASS", decided_at: "2026-09-23T10:00:00Z" } } }, claim).verdict, "NOT_TESTED");
  assert.equal(evaluateClaim({ run, gates: { "00": { verdict: "FAIL", decided_at: "2026-09-24T22:47:14Z" } } }, claim).verdict, "FAIL");
  assert.equal(evaluateClaim({ run: { ...run, skip_regression: true }, gates: { "00": { verdict: "PASS", decided_at: "2026-09-24T22:47:14Z" } } }, claim).verdict, "NOT_TESTED");
});

// كل مرحلة تُختبر منفصلة (سياسة المالك 2026-09-30): البوابة الأدنى تُقرأ ولا يُعاد تشغيلها، وتبقى شروطها كاملة.
test("P07-TOOLS-PRIOR-GATES an older lower gate counts only in PRIOR_GATES mode, and only when canonical and PASS", () => {
  const r6 = P07_CLAIMS.find((c) => c.id === "P07-R6");
  const r0 = P07_CLAIMS.find((c) => c.id === "P07-R0");
  const gate = { canonical: true, verdict: "PASS", measured_at: "2026-09-30T01:00:00Z" };
  const run = { run_started: "2026-09-30T02:00:00Z" };
  assert.equal(evaluateClaim({ run: { ...run, regression_mode: "RERUN" }, gates: { "06": gate } }, r6).verdict, "NOT_TESTED");
  assert.equal(evaluateClaim({ run: { ...run, regression_mode: "PRIOR_GATES" }, gates: { "06": gate } }, r6).verdict, "PASS");
  assert.equal(evaluateClaim({ run: { ...run, regression_mode: "PRIOR_GATES" }, gates: { "06": { ...gate, verdict: "FAIL" } } }, r6).verdict, "FAIL");
  assert.equal(evaluateClaim({ run: { ...run, regression_mode: "PRIOR_GATES" }, gates: { "06": { ...gate, canonical: false } } }, r6).verdict, "FAIL");
  assert.equal(evaluateClaim({ run: { ...run, regression_mode: "PRIOR_GATES" }, gates: { "00": { native: true, platform: "win32", verdict: "PASS", decided_at: "2026-09-30T01:00:00Z" } } }, r0).verdict, "PASS");
});
