// حاوية ZIP لحزم OOXML: كتابة حتمية وقراءة محدودة مع تحقق CRC.
//
// لماذا نكتبها بأنفسنا ولا نعتمد على مكتبة أرشفة: ما نحتاجه ضيّق ومحدَّد (ملفات
// مسطّحة، بلا تشفير، بلا ZIP64)، وما لا نحتاجه — استخراج إلى القرص بأسماء يحدّدها
// الأرشيف — هو بالضبط سطح هجوم «zip slip». القارئ هنا لا يكتب شيئًا على القرص
// إطلاقًا: يعيد بايتات في الذاكرة ضمن سقف معلن، والأسماء تُفحص قبل قبولها.

use miniz_oxide::deflate::compress_to_vec;
use miniz_oxide::inflate::decompress_to_vec_with_limit;

/// سقف مجموع البايتات المفكوكة لأرشيف واحد. حماية من «قنبلة ZIP».
pub const MAX_UNCOMPRESSED_TOTAL: usize = 64 * 1024 * 1024;
/// سقف عدد المدخلات. حزمة OOXML عادية تحمل عشرات، لا آلافًا.
pub const MAX_ENTRIES: usize = 4096;

const LOCAL_SIG: u32 = 0x0403_4b50;
const CENTRAL_SIG: u32 = 0x0201_4b50;
const EOCD_SIG: u32 = 0x0605_4b50;
/// تاريخ DOS ثابت (1980-01-01): المخرجات الحتمية تجعل البصمة قابلة للمقارنة بين تشغيلين.
const DOS_DATE: u16 = 0x0021;
/// البت 11: الأسماء بترميز UTF-8.
const FLAG_UTF8: u16 = 0x0800;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ZipError {
    Truncated,
    BadSignature(&'static str),
    UnsupportedMethod(u16),
    Encrypted,
    Zip64,
    TooManyEntries(usize),
    TooLarge,
    CrcMismatch(String),
    UnsafeName(String),
    DuplicateName(String),
    Inflate(String),
}

impl std::fmt::Display for ZipError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Truncated => write!(f, "the archive is truncated"),
            Self::BadSignature(what) => write!(f, "bad {what} signature"),
            Self::UnsupportedMethod(m) => write!(f, "compression method {m} is not supported"),
            Self::Encrypted => write!(f, "encrypted entries are not supported"),
            Self::Zip64 => write!(f, "ZIP64 archives are not supported"),
            Self::TooManyEntries(n) => write!(f, "{n} entries exceed the limit"),
            Self::TooLarge => write!(f, "the uncompressed content exceeds the limit"),
            Self::CrcMismatch(name) => write!(f, "CRC mismatch in {name}"),
            Self::UnsafeName(name) => write!(f, "unsafe entry name {name}"),
            Self::DuplicateName(name) => write!(f, "duplicate entry name {name}"),
            Self::Inflate(e) => write!(f, "inflate failed: {e}"),
        }
    }
}

/// CRC-32 (IEEE 802.3) بجدول يُبنى وقت الترجمة.
const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        table[i] = c;
        i += 1;
    }
    table
};

pub fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c = CRC_TABLE[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8);
    }
    c ^ 0xFFFF_FFFF
}

/// اسم مدخل آمن: نسبي، بفواصل أمامية، بلا مقطع فارغ ولا `..` ولا حرف تحكّم.
/// الاسم الذي يُرفض هنا لا يُصحَّح: التصحيح الصامت هو ما يصنع ثغرة المسار.
pub fn is_safe_entry_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 512 || name.starts_with('/') || name.contains('\\') || name.contains(':') {
        return false;
    }
    name.split('/').all(|segment| !segment.is_empty() && segment != "." && segment != ".." && !segment.chars().any(char::is_control))
}

fn put16(out: &mut Vec<u8>, v: u16) {
    out.extend_from_slice(&v.to_le_bytes());
}
fn put32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

/// يكتب أرشيفًا من مدخلات مرتّبة كما أُعطيت. الترتيب مهم: OOXML يتوقّع
/// `[Content_Types].xml` أولًا لدى بعض القرّاء.
pub fn write_zip(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>, ZipError> {
    if entries.len() > MAX_ENTRIES {
        return Err(ZipError::TooManyEntries(entries.len()));
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in entries {
        if !is_safe_entry_name(name) {
            return Err(ZipError::UnsafeName(name.clone()));
        }
        if !seen.insert(name.clone()) {
            return Err(ZipError::DuplicateName(name.clone()));
        }
        let crc = crc32(data);
        let deflated = compress_to_vec(data, 6);
        // يُختار الأصغر: بيانات مضغوطة سلفًا (صورة) لا تُضغط مرتين بلا فائدة.
        let (method, body): (u16, &[u8]) = if deflated.len() < data.len() { (8, &deflated) } else { (0, data) };
        if out.len() > u32::MAX as usize || data.len() > u32::MAX as usize {
            return Err(ZipError::Zip64);
        }
        let offset = out.len() as u32;
        put32(&mut out, LOCAL_SIG);
        put16(&mut out, 20);
        put16(&mut out, FLAG_UTF8);
        put16(&mut out, method);
        put16(&mut out, 0);
        put16(&mut out, DOS_DATE);
        put32(&mut out, crc);
        put32(&mut out, body.len() as u32);
        put32(&mut out, data.len() as u32);
        put16(&mut out, name.len() as u16);
        put16(&mut out, 0);
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(body);

        put32(&mut central, CENTRAL_SIG);
        put16(&mut central, 20);
        put16(&mut central, 20);
        put16(&mut central, FLAG_UTF8);
        put16(&mut central, method);
        put16(&mut central, 0);
        put16(&mut central, DOS_DATE);
        put32(&mut central, crc);
        put32(&mut central, body.len() as u32);
        put32(&mut central, data.len() as u32);
        put16(&mut central, name.len() as u16);
        put16(&mut central, 0);
        put16(&mut central, 0);
        put16(&mut central, 0);
        put16(&mut central, 0);
        put32(&mut central, 0);
        put32(&mut central, offset);
        central.extend_from_slice(name.as_bytes());
    }
    let central_offset = out.len() as u32;
    out.extend_from_slice(&central);
    put32(&mut out, EOCD_SIG);
    put16(&mut out, 0);
    put16(&mut out, 0);
    put16(&mut out, entries.len() as u16);
    put16(&mut out, entries.len() as u16);
    put32(&mut out, central.len() as u32);
    put32(&mut out, central_offset);
    put16(&mut out, 0);
    Ok(out)
}

fn get16(data: &[u8], at: usize) -> Result<u16, ZipError> {
    data.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]])).ok_or(ZipError::Truncated)
}
fn get32(data: &[u8], at: usize) -> Result<u32, ZipError> {
    data.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])).ok_or(ZipError::Truncated)
}

/// مدخل مقروء: اسمه وبايتاته المفكوكة، بعد تحقق CRC.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZipEntry {
    pub name: String,
    pub data: Vec<u8>,
}

/// يقرأ أرشيفًا كاملًا في الذاكرة. كل مدخل يُتحقق من CRC وسقف حجمه قبل قبوله.
pub fn read_zip(data: &[u8]) -> Result<Vec<ZipEntry>, ZipError> {
    if data.len() < 22 {
        return Err(ZipError::Truncated);
    }
    // سجل النهاية في آخر 22 بايتًا + تعليق حتى 65535.
    let floor = data.len().saturating_sub(22 + 65_535);
    let mut eocd = None;
    let mut at = data.len() - 22;
    loop {
        if get32(data, at)? == EOCD_SIG {
            eocd = Some(at);
            break;
        }
        if at == floor {
            break;
        }
        at -= 1;
    }
    let eocd = eocd.ok_or(ZipError::BadSignature("end of central directory"))?;
    let count = get16(data, eocd + 10)? as usize;
    let central_offset = get32(data, eocd + 16)? as usize;
    if count == 0xFFFF || central_offset == 0xFFFF_FFFF {
        return Err(ZipError::Zip64);
    }
    if count > MAX_ENTRIES {
        return Err(ZipError::TooManyEntries(count));
    }
    let mut entries = Vec::with_capacity(count);
    let mut names = std::collections::BTreeSet::new();
    let mut total = 0usize;
    let mut cursor = central_offset;
    for _ in 0..count {
        if get32(data, cursor)? != CENTRAL_SIG {
            return Err(ZipError::BadSignature("central directory"));
        }
        let flags = get16(data, cursor + 8)?;
        let method = get16(data, cursor + 10)?;
        let crc = get32(data, cursor + 16)?;
        let compressed = get32(data, cursor + 20)? as usize;
        let uncompressed = get32(data, cursor + 24)? as usize;
        let name_len = get16(data, cursor + 28)? as usize;
        let extra_len = get16(data, cursor + 30)? as usize;
        let comment_len = get16(data, cursor + 32)? as usize;
        let local = get32(data, cursor + 42)? as usize;
        let name_bytes = data.get(cursor + 46..cursor + 46 + name_len).ok_or(ZipError::Truncated)?;
        let name = String::from_utf8_lossy(name_bytes).into_owned();
        cursor += 46 + name_len + extra_len + comment_len;
        if flags & 1 != 0 {
            return Err(ZipError::Encrypted);
        }
        // مجلد صريح (اسم ينتهي بـ/) لا يحمل بيانات؛ يُتخطّى بعد فحص اسمه.
        let trimmed = name.trim_end_matches('/');
        if !is_safe_entry_name(trimmed) {
            return Err(ZipError::UnsafeName(name));
        }
        if name.ends_with('/') {
            continue;
        }
        if !names.insert(name.to_ascii_lowercase()) {
            return Err(ZipError::DuplicateName(name));
        }
        total = total.checked_add(uncompressed).ok_or(ZipError::TooLarge)?;
        if total > MAX_UNCOMPRESSED_TOTAL {
            return Err(ZipError::TooLarge);
        }
        if get32(data, local)? != LOCAL_SIG {
            return Err(ZipError::BadSignature("local header"));
        }
        let local_name = get16(data, local + 26)? as usize;
        let local_extra = get16(data, local + 28)? as usize;
        let start = local + 30 + local_name + local_extra;
        let body = data.get(start..start + compressed).ok_or(ZipError::Truncated)?;
        let content = match method {
            0 => body.to_vec(),
            8 => decompress_to_vec_with_limit(body, uncompressed.max(1)).map_err(|e| ZipError::Inflate(format!("{:?}", e.status)))?,
            other => return Err(ZipError::UnsupportedMethod(other)),
        };
        if content.len() != uncompressed || crc32(&content) != crc {
            return Err(ZipError::CrcMismatch(name));
        }
        entries.push(ZipEntry { name, data: content });
    }
    Ok(entries)
}

/// يبحث عن مدخل باسمه الحرفي.
pub fn find<'a>(entries: &'a [ZipEntry], name: &str) -> Option<&'a ZipEntry> {
    entries.iter().find(|e| e.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_matches_the_reference_vector() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn a_written_archive_reads_back_byte_for_byte() {
        let entries = vec![
            ("a.txt".to_string(), b"hello".to_vec()),
            ("dir/b.xml".to_string(), "<x>عربي</x>".repeat(200).into_bytes()),
        ];
        let bytes = write_zip(&entries).unwrap();
        let read = read_zip(&bytes).unwrap();
        assert_eq!(read.len(), 2);
        assert_eq!(read[0].data, b"hello");
        assert_eq!(read[1].data, entries[1].1);
    }

    #[test]
    fn writing_is_deterministic() {
        let entries = vec![("x".to_string(), b"same".to_vec())];
        assert_eq!(write_zip(&entries).unwrap(), write_zip(&entries).unwrap());
    }

    #[test]
    fn traversal_and_absolute_names_are_refused_on_both_sides() {
        for bad in ["../evil", "/abs", "a/../../b", "c:\\x", "a\\b", "a//b", ""] {
            assert!(write_zip(&[(bad.to_string(), vec![1])]).is_err(), "{bad} was written");
        }
        // أرشيف مصنوع يدويًا باسم يتسلّق: القارئ يرفضه.
        let mut good = write_zip(&[("aa/evil".to_string(), vec![1])]).unwrap();
        let text = good.clone();
        let pos = text.windows(7).rposition(|w| w == b"aa/evil").unwrap();
        good[pos..pos + 3].copy_from_slice(b"../");
        assert!(matches!(read_zip(&good), Err(ZipError::UnsafeName(_))));
    }

    #[test]
    fn a_corrupted_body_fails_the_crc_check() {
        let mut bytes = write_zip(&[("a.txt".to_string(), b"abcdef".to_vec())]).unwrap();
        let pos = bytes.windows(6).position(|w| w == b"abcdef").unwrap();
        bytes[pos] = b'X';
        assert!(matches!(read_zip(&bytes), Err(ZipError::CrcMismatch(_))));
    }

    #[test]
    fn a_zip_bomb_is_refused_before_it_is_inflated() {
        let big = vec![0u8; MAX_UNCOMPRESSED_TOTAL + 1];
        let bytes = write_zip(&[("z".to_string(), big)]).unwrap();
        assert_eq!(read_zip(&bytes), Err(ZipError::TooLarge));
    }

    #[test]
    fn duplicate_names_are_refused() {
        let e = vec![("a".to_string(), vec![1]), ("a".to_string(), vec![2])];
        assert!(matches!(write_zip(&e), Err(ZipError::DuplicateName(_))));
    }
}
