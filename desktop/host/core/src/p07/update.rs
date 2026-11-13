// أساس التحديث الآمن: التحقق من بيان تحديث موقَّع، ومن الملف الذي يصفه.
//
// ما هنا تحقّق فقط. المنتج لا يجلب شيئًا من الشبكة ولا يثبّت تلقائيًا: لا خادم
// تحديث في هذا البناء (الإعداد advanced.auto_update مؤجَّل). المطلوب أن يكون أول
// تحديث — حين يوجد — مرفوضًا ما لم:
//   ١ — يوقّعه مفتاح من قائمة المفاتيح الموثوقة المضمّنة في البناء (Ed25519، تحقّق صارم)،
//   ٢ — يكون البيان بصيغته المغلقة، للمنتج نفسه، وبإصدار أحدث من الحالي (لا رجوع)،
//   ٣ — يطابق الملف اسمًا وحجمًا وخلاصةً ما في البيان.
//
// التوقيع على بايتات البيان كما هي (حقل نصّي)، لا على JSON مُعاد تسلسله: لا قواعد
// تطبيع يختلف فيها الموقِّع والمتحقِّق.
//
// قائمة المفاتيح الموثوقة في المنتج فارغة: لا مفتاح إصدار حقيقي مُعَدّ. كل بيان
// يُرفض إذن بـ UPDATE_KEY_UNTRUSTED، وهذا هو السلوك الصحيح إلى أن يُعدّ مفتاح.

use std::cmp::Ordering;
use std::path::Path;

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

use super::backup::sha256_file;
use super::error::{MaintenanceError, MaintenanceResult};

pub const SIGNED_FORMAT: &str = "polaris.signed-update/1";
pub const MANIFEST_FORMAT: &str = "polaris.update/1";
pub const PRODUCT: &str = "POLARIS";
/// حدّ حجم الظرف الموقَّع. البيان وصف لبضعة ملفات لا أكثر.
pub const MAX_SIGNED_BYTES: usize = 256 * 1024;
pub const MAX_ARTIFACTS: usize = 16;

/// مفتاح تحقّق موثوق باسمه.
#[derive(Debug, Clone)]
pub struct TrustedKey {
    pub key_id: std::borrow::Cow<'static, str>,
    pub public_key: [u8; 32],
}

/// المفاتيح الموثوقة في بناء المنتج. فارغة عمدًا: لا مفتاح إصدار حقيقي بعد.
pub const PRODUCT_TRUSTED_KEYS: &[TrustedKey] = &[];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedUpdate {
    pub format: String,
    pub key_id: String,
    pub manifest_json: String,
    pub signature_hex: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateArtifact {
    pub name: String,
    pub platform: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateManifest {
    pub format: String,
    pub product: String,
    pub channel: String,
    pub version: String,
    pub released_at: String,
    pub artifacts: Vec<UpdateArtifact>,
}

/// إصدار دلالي مبسّط: major.minor.patch واختياريًا -pre. الإصدار التجريبي أدنى من نهائيّه.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pub pre: Option<String>,
}

impl Version {
    pub fn parse(text: &str) -> Option<Self> {
        if text.len() > 64 {
            return None;
        }
        let (core, pre) = match text.split_once('-') {
            Some((core, pre)) if !pre.is_empty() && pre.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.') => (core, Some(pre.to_string())),
            Some(_) => return None,
            None => (text, None),
        };
        let parts: Vec<&str> = core.split('.').collect();
        if parts.len() != 3 || parts.iter().any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) || (p.len() > 1 && p.starts_with('0'))) {
            return None;
        }
        Some(Self { major: parts[0].parse().ok()?, minor: parts[1].parse().ok()?, patch: parts[2].parse().ok()?, pre })
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch).cmp(&(other.major, other.minor, other.patch)).then_with(|| match (&self.pre, &other.pre) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (Some(a), Some(b)) => a.cmp(b),
        })
    }
}

fn invalid(detail: impl Into<String>) -> MaintenanceError {
    MaintenanceError::new("UPDATE_MANIFEST_INVALID", detail)
}

fn decode_hex<const N: usize>(text: &str) -> Option<[u8; N]> {
    if text.len() != N * 2 {
        return None;
    }
    let mut out = [0u8; N];
    for (i, chunk) in text.as_bytes().chunks(2).enumerate() {
        let pair = std::str::from_utf8(chunk).ok()?;
        out[i] = u8::from_str_radix(pair, 16).ok()?;
    }
    Some(out)
}

/// بيان تحقّق منه: توقيعه، وصيغته، وإصداره.
#[derive(Debug, Clone, Serialize)]
pub struct VerifiedUpdate {
    pub key_id: String,
    pub manifest: UpdateManifest,
}

/// يتحقق من ظرف موقَّع مقابل مفاتيح موثوقة وإصدار حالي.
pub fn verify_signed_update(bytes: &[u8], trusted: &[TrustedKey], current_version: &str) -> MaintenanceResult<VerifiedUpdate> {
    if bytes.len() > MAX_SIGNED_BYTES {
        return Err(MaintenanceError::new("UPDATE_MANIFEST_TOO_LARGE", format!("{} bytes", bytes.len())));
    }
    let signed: SignedUpdate = serde_json::from_slice(bytes).map_err(|e| invalid(e.to_string()))?;
    if signed.format != SIGNED_FORMAT {
        return Err(invalid(format!("unknown envelope format {}", signed.format)));
    }
    // المفتاح يُختار بالاسم من القائمة المضمّنة، لا يُقبل مفتاح يحمله البيان نفسه.
    let key = trusted
        .iter()
        .find(|k| k.key_id == signed.key_id)
        .ok_or_else(|| MaintenanceError::new("UPDATE_KEY_UNTRUSTED", format!("key {} is not trusted by this build", signed.key_id)))?;
    let verifying = VerifyingKey::from_bytes(&key.public_key).map_err(|_| MaintenanceError::new("UPDATE_KEY_UNTRUSTED", "the trusted key is malformed"))?;
    let signature_bytes = decode_hex::<64>(&signed.signature_hex).ok_or_else(|| MaintenanceError::new("UPDATE_SIGNATURE_INVALID", "the signature is not 64 hex-encoded bytes"))?;
    let signature = Signature::from_bytes(&signature_bytes);
    verifying
        .verify_strict(signed.manifest_json.as_bytes(), &signature)
        .map_err(|_| MaintenanceError::new("UPDATE_SIGNATURE_INVALID", "the signature does not match the manifest"))?;

    // بعد التوقيع فقط يُقرأ البيان: ما لم يُوقَّع لا يُفسَّر.
    let manifest: UpdateManifest = serde_json::from_str(&signed.manifest_json).map_err(|e| invalid(e.to_string()))?;
    if manifest.format != MANIFEST_FORMAT || manifest.product != PRODUCT {
        return Err(invalid("the manifest is not a POLARIS update manifest"));
    }
    if manifest.artifacts.is_empty() || manifest.artifacts.len() > MAX_ARTIFACTS {
        return Err(invalid("the manifest must list between 1 and 16 artifacts"));
    }
    for artifact in &manifest.artifacts {
        let safe_name = !artifact.name.is_empty()
            && artifact.name.len() <= 128
            && artifact.name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            && !artifact.name.starts_with('.');
        if !safe_name || decode_hex::<32>(&artifact.sha256).is_none() {
            return Err(invalid("an artifact name or digest is malformed"));
        }
    }
    let offered = Version::parse(&manifest.version).ok_or_else(|| invalid("the version is not a semantic version"))?;
    let current = Version::parse(current_version).ok_or_else(|| invalid("the current version is not a semantic version"))?;
    if offered <= current {
        return Err(MaintenanceError::new(
            "UPDATE_DOWNGRADE_REFUSED",
            format!("offered {} is not newer than installed {}", manifest.version, current_version),
        ));
    }
    Ok(VerifiedUpdate { key_id: signed.key_id, manifest })
}

/// يتحقق من ملف مقابل بيان مُتحقَّق منه: الاسم مُدرج، والحجم والخلاصة مطابقان.
pub fn verify_artifact(verified: &VerifiedUpdate, path: &Path) -> MaintenanceResult<UpdateArtifact> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let listed = verified
        .manifest
        .artifacts
        .iter()
        .find(|a| a.name == name)
        .ok_or_else(|| MaintenanceError::new("UPDATE_ARTIFACT_UNLISTED", format!("{name} is not in the manifest")))?;
    let (digest, bytes) = sha256_file(path).map_err(|e| MaintenanceError::new("UPDATE_ARTIFACT_MISMATCH", e.detail))?;
    if bytes != listed.bytes || !digest.eq_ignore_ascii_case(&listed.sha256) {
        return Err(MaintenanceError::new("UPDATE_ARTIFACT_MISMATCH", "the file is not the artifact the manifest describes"));
    }
    Ok(listed.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_order_as_semantic_versions() {
        let v = |s| Version::parse(s).unwrap();
        assert!(v("0.1.1") > v("0.1.0"));
        assert!(v("0.2.0") > v("0.1.9"));
        assert!(v("1.0.0") > v("1.0.0-rc.1"));
        assert!(v("1.0.0-rc.2") > v("1.0.0-rc.1"));
        for bad in ["", "1", "1.0", "01.0.0", "1.0.0-", "1.0.0-rc/1", "1.0.0.0", "a.b.c"] {
            assert!(Version::parse(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn the_product_build_trusts_no_key_yet() {
        assert!(PRODUCT_TRUSTED_KEYS.is_empty());
    }
}
