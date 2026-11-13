// أساس حزم المهارات القابلة للتثبيت: واصف ببيان وإصدار ومؤلف وأذونات وقدرات وتوقيع ومصدر.
//
// كل حزمة مستوردة UNTRUSTED. التحقق بنيوي (مخطط مغلق، آثار معروفة، لا قدرة خارج مِنحة زمن
// التشغيل، لا تنفيذ على المضيف ولا وصول إلى سرّ)، والتوقيع يُفحص بمفتاح Ed25519 موثوق إن
// وُجد — ولا مفتاح موثوق في هذا البناء، فالحزمة الموقّعة تبقى «موقّعة بمفتاح غير معروف».
// والأهم: الحزمة لا تمنح سلطة. حتى الحزمة VALIDATED لا تسجّل أداة ولا تفعّل شيئًا بنفسها.

use std::sync::Arc;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::p04::effect::{runtime_holds, ToolEffect};
use crate::storage::Database;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageSignature {
    pub key_id: String,
    /// توقيع Ed25519 على بايتات البيان القانونية (بلا حقل التوقيع)، بترميز hex.
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SkillPackageManifest {
    pub package_id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    #[serde(default)]
    pub description: String,
    /// الآثار التي تطلبها أدوات الحزمة.
    pub permissions: Vec<String>,
    /// القدرات المطلوبة (يجب أن تطابق الآثار).
    pub capabilities: Vec<String>,
    /// معرّفات أدوات موجودة تسمّيها الحزمة. لا شيفرة في الحزمة.
    pub tools: Vec<String>,
    pub source: String,
    #[serde(default)]
    pub signature: Option<PackageSignature>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PackageView {
    pub package_id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub manifest_sha256: String,
    pub signature_state: String,
    pub source: String,
    pub trust_state: String,
    pub rejection: Option<String>,
    pub imported_at: String,
    /// ثابت: الحزمة لا تمنح سلطة، مهما كانت حالتها.
    pub grants_authority: bool,
}

fn semver(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.len() <= 6 && p.chars().all(|c| c.is_ascii_digit()))
}

/// يتحقّق من البيان ويعيد سبب الرفض إن وُجد.
pub fn validate(manifest: &SkillPackageManifest) -> Result<(), String> {
    let id_ok = manifest.package_id.len() >= 3 && manifest.package_id.len() <= 120 && manifest.package_id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-' | '_'));
    if !id_ok {
        return Err("package_id must be 3..120 lowercase letters, digits, dots, dashes or underscores".into());
    }
    if manifest.name.trim().is_empty() || manifest.name.len() > 120 || manifest.author.trim().is_empty() || manifest.author.len() > 120 {
        return Err("name and author must be 1..120 characters".into());
    }
    if !semver(&manifest.version) {
        return Err("version must be MAJOR.MINOR.PATCH".into());
    }
    if manifest.source.trim().is_empty() || manifest.source.len() > 400 {
        return Err("source must be 1..400 characters".into());
    }
    let mut needed = Vec::new();
    for p in &manifest.permissions {
        let effect = ToolEffect::parse(p).ok_or_else(|| format!("{p} is not a known effect"))?;
        if matches!(effect, ToolEffect::ProcessExecution | ToolEffect::SecretAccess) {
            return Err(format!("{p} has no capability in this build; a package cannot ask for it"));
        }
        needed.push(effect.required_capability().to_string());
    }
    for c in &manifest.capabilities {
        if !runtime_holds(c) {
            return Err(format!("{c} is not held by the runtime"));
        }
        if !needed.contains(c) {
            return Err(format!("{c} is not implied by any declared permission"));
        }
    }
    if manifest.tools.len() > 64 || manifest.tools.iter().any(|t| !crate::p04::tool::is_valid_tool_id(t)) {
        return Err("tools must be at most 64 valid tool identifiers".into());
    }
    Ok(())
}

/// بايتات البيان القانونية للتوقيع: البيان بلا حقل التوقيع، بمفاتيح مرتّبة.
pub fn canonical_bytes(manifest: &SkillPackageManifest) -> Vec<u8> {
    let mut unsigned = manifest.clone();
    unsigned.signature = None;
    let value = serde_json::to_value(&unsigned).unwrap_or_default();
    crate::p04::gateway::canonical_arguments(&value).into_bytes()
}

/// حالة التوقيع. لا مفتاح موثوق في هذا البناء: الحزمة الموقّعة تبقى بمفتاح غير معروف.
pub fn signature_state(manifest: &SkillPackageManifest, trusted_keys: &[(&str, [u8; 32])]) -> &'static str {
    let Some(sig) = &manifest.signature else { return "UNSIGNED" };
    let Some((_, key)) = trusted_keys.iter().find(|(id, _)| *id == sig.key_id) else { return "SIGNED_UNKNOWN_KEY" };
    let bytes: Option<Vec<u8>> = (0..sig.value.len()).step_by(2).map(|i| sig.value.get(i..i + 2).and_then(|h| u8::from_str_radix(h, 16).ok())).collect();
    let Some(bytes) = bytes.filter(|b| b.len() == 64) else { return "SIGNATURE_INVALID" };
    let Ok(verifying) = ed25519_dalek::VerifyingKey::from_bytes(key) else { return "SIGNATURE_INVALID" };
    let mut raw = [0u8; 64];
    raw.copy_from_slice(&bytes);
    let signature = ed25519_dalek::Signature::from_bytes(&raw);
    if verifying.verify_strict(&canonical_bytes(manifest), &signature).is_ok() {
        "SIGNED_TRUSTED"
    } else {
        "SIGNATURE_INVALID"
    }
}

pub struct PackageService {
    db: Arc<Database>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
}

impl PackageService {
    pub fn new(db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock) -> Self {
        Self { db, audit, clock }
    }

    /// يستورد بيانًا. الحزمة تُسجَّل دائمًا (مرفوضة أو صالحة) ليرى المستخدم ما حدث.
    pub fn import(&self, manifest_json: &str) -> Result<PackageView, String> {
        if manifest_json.len() > 32_000 {
            return Err("the manifest is larger than 32 KB".into());
        }
        let manifest: SkillPackageManifest = serde_json::from_str(manifest_json).map_err(|e| format!("the manifest does not match its contract: {e}"))?;
        let sha = crate::digest::sha256_hex(&canonical_bytes(&manifest));
        let signature = signature_state(&manifest, &[]);
        let (trust, rejection) = match validate(&manifest) {
            Err(why) => ("REJECTED", Some(why)),
            Ok(()) if signature == "SIGNATURE_INVALID" => ("REJECTED", Some("the signature does not verify".to_string())),
            Ok(()) => ("VALIDATED", None),
        };
        let now = self.clock.now();
        self.db
            .with(|c| {
                c.execute(
                    "INSERT INTO p08_skill_packages (package_id, name, version, author, manifest_json, manifest_sha256, signature_state, source, trust_state, rejection, imported_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(package_id) DO UPDATE SET name = excluded.name, version = excluded.version, author = excluded.author, manifest_json = excluded.manifest_json, manifest_sha256 = excluded.manifest_sha256, signature_state = excluded.signature_state, source = excluded.source, trust_state = excluded.trust_state, rejection = excluded.rejection, imported_at = excluded.imported_at",
                    params![manifest.package_id, manifest.name.chars().take(120).collect::<String>(), manifest.version, manifest.author.chars().take(120).collect::<String>(), manifest_json, sha, signature, manifest.source.chars().take(400).collect::<String>(), trust, rejection, now],
                )?;
                Ok(())
            })
            .map_err(|e| e.to_string())?;
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::SkillPackageImported,
            "skill_package",
            manifest.package_id.chars().take(120).collect::<String>(),
            if trust == "REJECTED" { AuditOutcome::Denied } else { AuditOutcome::Success },
            serde_json::json!({ "trust_state": trust, "signature_state": signature, "manifest_sha256": sha }),
        ));
        self.list()?.into_iter().find(|p| p.package_id == manifest.package_id).ok_or_else(|| "the package vanished".into())
    }

    pub fn list(&self) -> Result<Vec<PackageView>, String> {
        self.db
            .with(|c| {
                let mut s = c.prepare("SELECT package_id, name, version, author, manifest_sha256, signature_state, source, trust_state, rejection, imported_at FROM p08_skill_packages ORDER BY imported_at DESC")?;
                let rows = s
                    .query_map([], |r| {
                        Ok(PackageView {
                            package_id: r.get(0)?,
                            name: r.get(1)?,
                            version: r.get(2)?,
                            author: r.get(3)?,
                            manifest_sha256: r.get(4)?,
                            signature_state: r.get(5)?,
                            source: r.get(6)?,
                            trust_state: r.get(7)?,
                            rejection: r.get(8)?,
                            imported_at: r.get(9)?,
                            grants_authority: false,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(permissions: &[&str]) -> String {
        serde_json::json!({
            "package_id": "acme.report-kit", "name": "Report kit", "version": "1.2.0", "author": "Acme",
            "permissions": permissions, "capabilities": permissions.iter().filter_map(|p| ToolEffect::parse(p)).map(|e| e.required_capability()).collect::<Vec<_>>(),
            "tools": ["polaris.artifact.document"], "source": "file://local"
        })
        .to_string()
    }

    fn service() -> PackageService {
        let db = Arc::new(Database::in_memory().unwrap());
        PackageService::new(db.clone(), Arc::new(AuditLedger::new(db)), RuntimeClock::system())
    }

    #[test]
    fn a_valid_package_is_validated_but_grants_nothing() {
        let v = service().import(&manifest(&["WORKSPACE_WRITE"])).unwrap();
        assert_eq!(v.trust_state, "VALIDATED");
        assert_eq!(v.signature_state, "UNSIGNED");
        assert!(!v.grants_authority);
    }

    #[test]
    fn a_package_asking_for_host_execution_or_secrets_is_rejected() {
        let s = service();
        assert_eq!(s.import(&manifest(&["PROCESS_EXECUTION"])).unwrap().trust_state, "REJECTED");
        assert_eq!(s.import(&manifest(&["SECRET_ACCESS"])).unwrap().trust_state, "REJECTED");
        assert!(s.import(r#"{"package_id":"x.y","auto_enable":true}"#).is_err(), "an undeclared field was accepted");
    }

    #[test]
    fn a_signature_is_checked_only_against_trusted_keys() {
        use ed25519_dalek::{Signer, SigningKey};
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let mut m: SkillPackageManifest = serde_json::from_str(&manifest(&["WORKSPACE_READ"])).unwrap();
        let sig = key.sign(&canonical_bytes(&m));
        m.signature = Some(PackageSignature { key_id: "k1".into(), value: sig.to_bytes().iter().map(|b| format!("{b:02x}")).collect() });
        assert_eq!(signature_state(&m, &[]), "SIGNED_UNKNOWN_KEY");
        assert_eq!(signature_state(&m, &[("k1", key.verifying_key().to_bytes())]), "SIGNED_TRUSTED");
        m.version = "9.9.9".into();
        assert_eq!(signature_state(&m, &[("k1", key.verifying_key().to_bytes())]), "SIGNATURE_INVALID");
    }
}
