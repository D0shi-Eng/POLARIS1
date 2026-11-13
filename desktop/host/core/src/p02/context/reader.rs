// القراءة المحدودة.
//
// الملف يُفتح مرة واحدة، وحجمه وتاريخه يُقرآن من المقبض نفسه، والبايتات تُقرأ حتى
// حدّ ثابت. ملف أكبر من الحدّ لا يُقرأ ولا يُبصم جزئيًا: بصمة جزء تبدو بصمة كاملة.
// والقيد المعلن: التحقق من الهوية ثم الاستعمال ليس ذرّيًا هنا — القراءة تتبع
// الفحص مباشرةً، والنافذة بينهما مذكورة في وثيقة الأمان.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use super::classify::{by_name, refine};
use super::model::ContentClass;
use crate::digest::sha256_hex;
use crate::time::format_rfc3339_utc;

/// أقصى ملف يُقرأ كاملًا للبصمة.
pub const MAX_READ_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct FileSnapshot {
    pub size: u64,
    pub modified_at: Option<String>,
    pub class: ContentClass,
    /// متاح فقط إن كان الملف ضمن الحدّ.
    pub digest: Option<String>,
    pub bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadFailure {
    NotAFile,
    NotReadable,
    TooLarge,
}

pub fn snapshot(path: &Path) -> Result<FileSnapshot, ReadFailure> {
    let mut file = File::open(path).map_err(|_| ReadFailure::NotReadable)?;
    let meta = file.metadata().map_err(|_| ReadFailure::NotReadable)?;
    if !meta.is_file() {
        return Err(ReadFailure::NotAFile);
    }
    let size = meta.len();
    let modified_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| format_rfc3339_utc(d.as_secs() as i64));
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let class = by_name(&name);
    if size > MAX_READ_BYTES {
        return Ok(FileSnapshot { size, modified_at, class, digest: None, bytes: None });
    }
    let mut bytes = Vec::with_capacity(size as usize);
    (&mut file).take(MAX_READ_BYTES + 1).read_to_end(&mut bytes).map_err(|_| ReadFailure::NotReadable)?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        // نما الملف بين القراءتين: لا بصمة لمحتوى متحرّك.
        return Err(ReadFailure::TooLarge);
    }
    let class = refine(class, &bytes);
    let digest = Some(sha256_hex(&bytes));
    Ok(FileSnapshot { size: bytes.len() as u64, modified_at, class, digest, bytes: Some(bytes) })
}

/// يقصّ نصًّا عند حدّ بايتات دون كسر محرف.
pub fn truncate_utf8(text: &str, max_bytes: usize) -> (&str, bool) {
    if text.len() <= max_bytes {
        return (text, false);
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    (&text[..end], true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = crate::test_scratch::root().join(format!("read-{}", crate::ids::new_uuid_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn a_text_file_is_read_and_digested() {
        let path = temp("a.md", "مرحبا".as_bytes());
        let snap = snapshot(&path).unwrap();
        assert_eq!(snap.class, ContentClass::Documentation);
        assert_eq!(snap.digest.as_deref(), Some(sha256_hex("مرحبا".as_bytes()).as_str()));
        assert!(snap.modified_at.unwrap().ends_with('Z'));
    }

    #[test]
    fn a_huge_file_is_not_digested_partially() {
        let path = temp("big.txt", &vec![b'x'; (MAX_READ_BYTES + 10) as usize]);
        let snap = snapshot(&path).unwrap();
        assert!(snap.digest.is_none());
        assert!(snap.bytes.is_none());
        assert_eq!(snap.size, MAX_READ_BYTES + 10);
    }

    #[test]
    fn a_directory_is_not_a_file() {
        let path = temp("x.md", b"x");
        // على Windows يفشل فتح مجلد كملف أصلًا؛ على غيره يُفتح ويُرفض. كلاهما رفض.
        let failure = snapshot(path.parent().unwrap()).err();
        assert!(matches!(failure, Some(ReadFailure::NotAFile) | Some(ReadFailure::NotReadable)), "{failure:?}");
    }

    #[test]
    fn truncation_respects_character_boundaries() {
        let text = "أبجد";
        let (cut, truncated) = truncate_utf8(text, 3);
        assert!(truncated);
        assert_eq!(cut, "أ");
        assert_eq!(truncate_utf8("abc", 10), ("abc", false));
    }
}
