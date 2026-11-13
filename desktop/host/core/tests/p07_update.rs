// P07 — التحقق من بيان تحديث موقَّع. المفاتيح هنا مفاتيح اختبار من بذور ثابتة، معلَنة
// أنها كذلك؛ لا مفتاح إصدار حقيقي في هذا الملف ولا في البناء.

use ed25519_dalek::{Signer, SigningKey};
use polaris_host_core::p07::update::{verify_artifact, verify_signed_update, TrustedKey, PRODUCT_TRUSTED_KEYS};
use serde_json::json;

const TEST_SEED: [u8; 32] = [7u8; 32];
const OTHER_SEED: [u8; 32] = [9u8; 32];

fn trusted(seed: [u8; 32], id: &'static str) -> TrustedKey {
    TrustedKey { key_id: id.into(), public_key: SigningKey::from_bytes(&seed).verifying_key().to_bytes() }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn artifact_file(dir: &std::path::Path) -> (std::path::PathBuf, String, u64) {
    let path = dir.join("POLARIS_0.2.0_x64-setup.exe");
    let body = b"TEST FIXTURE installer bytes".repeat(100);
    std::fs::write(&path, &body).unwrap();
    use sha2::Digest;
    (path, format!("{:x}", sha2::Sha256::digest(&body)), body.len() as u64)
}

fn manifest(version: &str, sha256: &str, bytes: u64) -> String {
    json!({
        "format": "polaris.update/1", "product": "POLARIS", "channel": "rc", "version": version, "released_at": "2026-09-24T00:00:00Z",
        "artifacts": [{ "name": "POLARIS_0.2.0_x64-setup.exe", "platform": "windows-x86_64", "sha256": sha256, "bytes": bytes }]
    })
    .to_string()
}

fn sign(seed: [u8; 32], key_id: &str, manifest_json: &str) -> Vec<u8> {
    let signature = SigningKey::from_bytes(&seed).sign(manifest_json.as_bytes());
    json!({ "format": "polaris.signed-update/1", "key_id": key_id, "manifest_json": manifest_json, "signature_hex": hex(&signature.to_bytes()) })
        .to_string()
        .into_bytes()
}

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = polaris_host_core::test_scratch::root().join(format!("p07-update-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn p07_update_a_signed_newer_manifest_and_its_artifact_verify() {
    let dir = temp_dir("valid");
    let (path, sha, bytes) = artifact_file(&dir);
    let signed = sign(TEST_SEED, "test-key-1", &manifest("0.2.0", &sha, bytes));
    let verified = verify_signed_update(&signed, &[trusted(TEST_SEED, "test-key-1")], "0.1.0").unwrap();
    assert_eq!(verified.manifest.version, "0.2.0");
    assert_eq!(verify_artifact(&verified, &path).unwrap().sha256, sha);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_update_a_changed_manifest_or_a_foreign_signature_is_refused() {
    let body = manifest("0.2.0", &"a".repeat(64), 10);
    let signed = sign(TEST_SEED, "test-key-1", &body);
    let keys = [trusted(TEST_SEED, "test-key-1")];
    // بايت واحد تغيّر في البيان بعد التوقيع.
    let tampered = String::from_utf8(signed.clone()).unwrap().replace("0.2.0", "0.9.0").into_bytes();
    assert_eq!(verify_signed_update(&tampered, &keys, "0.1.0").unwrap_err().code, "UPDATE_SIGNATURE_INVALID");
    // مفتاح آخر يوقّع باسم المفتاح الموثوق.
    let forged = sign(OTHER_SEED, "test-key-1", &body);
    assert_eq!(verify_signed_update(&forged, &keys, "0.1.0").unwrap_err().code, "UPDATE_SIGNATURE_INVALID");
    // مفتاح غير مُدرج، ولو كان توقيعه سليمًا.
    let unknown = sign(OTHER_SEED, "attacker-key", &body);
    assert_eq!(verify_signed_update(&unknown, &keys, "0.1.0").unwrap_err().code, "UPDATE_KEY_UNTRUSTED");
}

#[test]
fn p07_update_a_downgrade_or_the_same_version_is_refused() {
    let keys = [trusted(TEST_SEED, "k")];
    for (offered, current) in [("0.1.0", "0.1.0"), ("0.0.9", "0.1.0"), ("0.1.0-rc.1", "0.1.0")] {
        let signed = sign(TEST_SEED, "k", &manifest(offered, &"b".repeat(64), 1));
        assert_eq!(verify_signed_update(&signed, &keys, current).unwrap_err().code, "UPDATE_DOWNGRADE_REFUSED", "{offered} over {current}");
    }
}

#[test]
fn p07_update_an_altered_or_unlisted_artifact_is_refused() {
    let dir = temp_dir("artifact");
    let (path, sha, bytes) = artifact_file(&dir);
    let signed = sign(TEST_SEED, "k", &manifest("0.2.0", &sha, bytes));
    let verified = verify_signed_update(&signed, &[trusted(TEST_SEED, "k")], "0.1.0").unwrap();
    std::fs::write(&path, b"a different installer").unwrap();
    assert_eq!(verify_artifact(&verified, &path).unwrap_err().code, "UPDATE_ARTIFACT_MISMATCH");
    let other = dir.join("other.exe");
    std::fs::write(&other, b"x").unwrap();
    assert_eq!(verify_artifact(&verified, &other).unwrap_err().code, "UPDATE_ARTIFACT_UNLISTED");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_update_the_product_build_refuses_every_manifest_until_a_release_key_exists() {
    let signed = sign(TEST_SEED, "test-key-1", &manifest("9.0.0", &"c".repeat(64), 1));
    assert_eq!(verify_signed_update(&signed, PRODUCT_TRUSTED_KEYS, "0.1.0").unwrap_err().code, "UPDATE_KEY_UNTRUSTED");
}

#[test]
fn p07_update_malformed_or_oversized_envelopes_are_refused() {
    let keys = [trusted(TEST_SEED, "k")];
    assert_eq!(verify_signed_update(&vec![b' '; 300 * 1024], &keys, "0.1.0").unwrap_err().code, "UPDATE_MANIFEST_TOO_LARGE");
    assert_eq!(verify_signed_update(b"{", &keys, "0.1.0").unwrap_err().code, "UPDATE_MANIFEST_INVALID");
    let extra = json!({ "format": "polaris.signed-update/1", "key_id": "k", "manifest_json": "{}", "signature_hex": "00", "install_now": true }).to_string();
    assert_eq!(verify_signed_update(extra.as_bytes(), &keys, "0.1.0").unwrap_err().code, "UPDATE_MANIFEST_INVALID");
    // بيان موقَّع لكنه يسمّي ملفًا يتسلّق خارج المجلد.
    let climbing = manifest("0.2.0", &"d".repeat(64), 1).replace("POLARIS_0.2.0_x64-setup.exe", "../../evil.exe");
    let signed = sign(TEST_SEED, "k", &climbing);
    assert_eq!(verify_signed_update(&signed, &keys, "0.1.0").unwrap_err().code, "UPDATE_MANIFEST_INVALID");
}
