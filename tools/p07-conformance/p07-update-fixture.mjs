// تجهيزة التحديث الموقَّع: مفتاح Ed25519 مؤقّت للاختبار، وبيان يصف ملفًا حقيقيًا، وتوقيع.
//
// الغرض إثبات خطّ التحقق من طرفين مستقلّين: Node يوقّع بمكتبته، والمنتج (Rust،
// ed25519-dalek) يتحقق. المفتاح يُولَّد لهذا التشغيل ويبقى في الذاكرة: يُكتب المفتاح
// العام وحده ومعرّفه، ويعلن المعرّف والقناة أنهما TEST FIXTURE. هذا ليس توقيع إصدار،
// ولا يدّعي أحدٌ أنه كذلك: المنتج نفسه لا يثق بهذا المفتاح (قائمته فارغة).
//
// الاستعمال: node p07-update-fixture.mjs --artifact <file> --out <dir> [--version 0.2.0]

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument } from "./p07-common.mjs";

export const TEST_KEY_ID = "p07-test-fixture-key";

/** يعيد المفتاح العام خامًا (32 بايتًا) بصيغة ست عشرية من JWK. */
function rawPublicHex(publicKey) {
  const jwk = publicKey.export({ format: "jwk" });
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

export function buildSignedUpdate(artifactPath, version = "0.2.0") {
  const bytes = readFileSync(artifactPath);
  const manifest = {
    format: "polaris.update/1",
    product: "POLARIS",
    channel: "test-fixture",
    version,
    released_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    artifacts: [{ name: basename(artifactPath), platform: "windows-x86_64", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }],
  };
  const manifestJson = JSON.stringify(manifest);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signature = sign(null, Buffer.from(manifestJson, "utf8"), privateKey).toString("hex");
  return {
    signed: { format: "polaris.signed-update/1", key_id: TEST_KEY_ID, manifest_json: manifestJson, signature_hex: signature },
    public_key_hex: rawPublicHex(publicKey),
    key_id: TEST_KEY_ID,
    artifact: manifest.artifacts[0],
  };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const artifact = argument("--artifact", "");
  const out = argument("--out", "");
  if (artifact === "" || out === "") {
    console.error("usage: p07-update-fixture.mjs --artifact <file> --out <dir> [--version V]");
    process.exitCode = 2;
  } else {
    const built = buildSignedUpdate(artifact, argument("--version", "0.2.0"));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "signed-update.json"), `${JSON.stringify(built.signed, null, 2)}\n`);
    // المفتاح الخاص لا يُكتب: يموت مع هذه العملية.
    writeFileSync(join(out, "test-key.json"), `${JSON.stringify({ key_id: built.key_id, public_key_hex: built.public_key_hex, label: "TEST FIXTURE" }, null, 2)}\n`);
    console.log(JSON.stringify({ key_id: built.key_id, public_key_hex: built.public_key_hex, artifact: built.artifact }));
  }
}
