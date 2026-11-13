// فحص الملف عند استقباله مرفقًا (تكليف المكافأة الوظيفية مع Manus، 2026-10-19).
//
// الامتداد وحده لا يُصدَّق: يُقرأ توقيع المحتوى (البايتات الأولى) ويُقارن بما يدّعيه الاسم. ملف يدّعي صيغة ثنائية
// معروفة (صورة، PDF، مستند Office…) ومحتواه شيء آخر يُرفض `SPOOFED`، فلا يصل إلى محلّل أو نموذج بهوية كاذبة.
// الناتج يقول بصدق ما يستطيعه POLARIS بالملف: نصّ يُستخرج للنموذج، أو صورة تُعطى لنموذج يرى الصور، أو تخزين فقط.
// لا شيء هنا يفكّ ضغطًا أو يحلّل بنية كاملة أو ينفّذ محتوى؛ هذا فحص رؤوس فقط.

use serde::Serialize;

/// عائلة الصيغة كما يراها المستخدم.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Family {
    Text,
    Code,
    Document,
    Spreadsheet,
    Presentation,
    Image,
    Audio,
    Video,
    Archive,
    Binary,
}

impl Family {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "TEXT",
            Self::Code => "CODE",
            Self::Document => "DOCUMENT",
            Self::Spreadsheet => "SPREADSHEET",
            Self::Presentation => "PRESENTATION",
            Self::Image => "IMAGE",
            Self::Audio => "AUDIO",
            Self::Video => "VIDEO",
            Self::Archive => "ARCHIVE",
            Self::Binary => "BINARY",
        }
    }
}

/// كيف يصل الملف إلى النموذج في هذا البناء.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModelAccess {
    /// يُحوَّل نصًّا بأداة القراءة (`polaris.workspace.read`).
    TextExtraction,
    /// صورة تُعطى بايتاتها لنموذج يعلن قدرة الرؤية، ولا تُعطى لغيره.
    ImageInput,
    /// يُخزَّن ويُنقل ويُصدَّر، ولا يُدّعى فهم محتواه (لا محلّل أو محوّل في هذا البناء).
    StoreOnly,
}

impl ModelAccess {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TextExtraction => "TEXT_EXTRACTION",
            Self::ImageInput => "IMAGE_INPUT",
            Self::StoreOnly => "STORE_ONLY",
        }
    }
}

/// نتيجة مقارنة التوقيع بالامتداد.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContentCheck {
    /// المحتوى يطابق الصيغة التي يدّعيها الاسم.
    Matched,
    /// صيغة بلا توقيع ثابت (نصّ، أو امتداد غير معروف): قُبلت دون إثبات صيغتها.
    Unverified,
}

impl ContentCheck {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Matched => "MATCHED",
            Self::Unverified => "UNVERIFIED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Inspection {
    pub family: Family,
    pub mime_type: &'static str,
    pub content_check: ContentCheck,
    pub model_access: ModelAccess,
    /// أبعاد الصورة من رأسها، إن عُرفت.
    pub dimensions: Option<(u32, u32)>,
    /// ملاحظات صادقة للمستخدم والوكيل (محتوى نشط في SVG، صيغة قديمة تحتاج محوّلًا…).
    pub notes: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spoofed {
    pub claimed: &'static str,
    pub detected: &'static str,
}

/// توقيع معروف في أول البايتات.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sniff {
    Png,
    Jpeg,
    Gif,
    Webp,
    Bmp,
    Tiff,
    Heic,
    Pdf,
    Zip,
    Ole,
    Rtf,
    Gzip,
    SevenZip,
    Rar,
    Wav,
    Avi,
    Mp3,
    Ogg,
    Flac,
    Mp4,
    Matroska,
}

impl Sniff {
    fn name(self) -> &'static str {
        match self {
            Self::Png => "PNG",
            Self::Jpeg => "JPEG",
            Self::Gif => "GIF",
            Self::Webp => "WEBP",
            Self::Bmp => "BMP",
            Self::Tiff => "TIFF",
            Self::Heic => "HEIC",
            Self::Pdf => "PDF",
            Self::Zip => "ZIP",
            Self::Ole => "OLE",
            Self::Rtf => "RTF",
            Self::Gzip => "GZIP",
            Self::SevenZip => "7Z",
            Self::Rar => "RAR",
            Self::Wav => "WAV",
            Self::Avi => "AVI",
            Self::Mp3 => "MP3",
            Self::Ogg => "OGG",
            Self::Flac => "FLAC",
            Self::Mp4 => "MP4",
            Self::Matroska => "MATROSKA",
        }
    }
}

fn sniff(b: &[u8]) -> Option<Sniff> {
    let at = |offset: usize, sig: &[u8]| b.len() >= offset + sig.len() && &b[offset..offset + sig.len()] == sig;
    if at(0, b"\x89PNG\r\n\x1a\n") {
        return Some(Sniff::Png);
    }
    if at(0, b"\xFF\xD8\xFF") {
        return Some(Sniff::Jpeg);
    }
    if at(0, b"GIF87a") || at(0, b"GIF89a") {
        return Some(Sniff::Gif);
    }
    if at(0, b"RIFF") && at(8, b"WEBP") {
        return Some(Sniff::Webp);
    }
    if at(0, b"RIFF") && at(8, b"WAVE") {
        return Some(Sniff::Wav);
    }
    if at(0, b"RIFF") && at(8, b"AVI ") {
        return Some(Sniff::Avi);
    }
    if at(0, b"BM") && b.len() >= 26 {
        return Some(Sniff::Bmp);
    }
    if at(0, b"II*\0") || at(0, b"MM\0*") {
        return Some(Sniff::Tiff);
    }
    if at(4, b"ftyp") {
        let brand = b.get(8..12).unwrap_or_default();
        return Some(if [b"heic", b"heix", b"mif1", b"msf1", b"hevc"].iter().any(|x| brand == *x) { Sniff::Heic } else { Sniff::Mp4 });
    }
    if at(0, b"%PDF-") {
        return Some(Sniff::Pdf);
    }
    if at(0, b"PK\x03\x04") || at(0, b"PK\x05\x06") {
        return Some(Sniff::Zip);
    }
    if at(0, b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1") {
        return Some(Sniff::Ole);
    }
    if at(0, b"{\\rtf") {
        return Some(Sniff::Rtf);
    }
    if at(0, b"\x1F\x8B") {
        return Some(Sniff::Gzip);
    }
    if at(0, b"7z\xBC\xAF\x27\x1C") {
        return Some(Sniff::SevenZip);
    }
    if at(0, b"Rar!\x1A\x07") {
        return Some(Sniff::Rar);
    }
    if at(0, b"ID3") || (b.len() >= 2 && b[0] == 0xFF && (b[1] & 0xE0) == 0xE0) {
        return Some(Sniff::Mp3);
    }
    if at(0, b"OggS") {
        return Some(Sniff::Ogg);
    }
    if at(0, b"fLaC") {
        return Some(Sniff::Flac);
    }
    if at(0, b"\x1A\x45\xDF\xA3") {
        return Some(Sniff::Matroska);
    }
    None
}

/// ما يدّعيه امتداد: عائلته ونوعه، والتواقيع المقبولة له (فارغة = صيغة بلا توقيع ثابت)، وطريق وصوله إلى النموذج.
struct Claim {
    family: Family,
    mime: &'static str,
    accepted: &'static [Sniff],
    access: ModelAccess,
    note: Option<&'static str>,
}

const NEEDS_CONVERTER: &str = "this format is stored and can be downloaded, but this build has no reader for it (REQUIRES_CONVERTER)";

fn claim(ext: &str) -> Claim {
    use Family::*;
    use ModelAccess::*;
    let c = |family, mime, accepted: &'static [Sniff], access, note| Claim { family, mime, accepted, access, note };
    match ext {
        "txt" | "log" => c(Text, "text/plain", &[], TextExtraction, None),
        "md" | "markdown" => c(Text, "text/markdown", &[], TextExtraction, None),
        "csv" => c(Spreadsheet, "text/csv", &[], TextExtraction, None),
        "tsv" => c(Spreadsheet, "text/tab-separated-values", &[], TextExtraction, None),
        "json" | "jsonl" => c(Code, "application/json", &[], TextExtraction, None),
        "yaml" | "yml" => c(Code, "application/yaml", &[], TextExtraction, None),
        "xml" => c(Code, "application/xml", &[], TextExtraction, None),
        "html" | "htm" => c(Code, "text/html", &[], TextExtraction, Some("HTML is read as text; its scripts never run in POLARIS")),
        "css" => c(Code, "text/css", &[], TextExtraction, None),
        "js" | "mjs" | "ts" | "tsx" | "jsx" | "py" | "rs" | "sql" | "toml" | "ps1" | "java" | "c" | "h" | "cpp" | "go" | "sh" => c(Code, "text/plain", &[], TextExtraction, None),
        "pdf" => c(Document, "application/pdf", &[Sniff::Pdf], TextExtraction, Some("PDF text is extracted; images and scanned pages inside it are not read (no OCR)")),
        "docx" => c(Document, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", &[Sniff::Zip], TextExtraction, None),
        "xlsx" => c(Spreadsheet, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", &[Sniff::Zip], TextExtraction, None),
        "pptx" => c(Presentation, "application/vnd.openxmlformats-officedocument.presentationml.presentation", &[Sniff::Zip], TextExtraction, None),
        "doc" => c(Document, "application/msword", &[Sniff::Ole], StoreOnly, Some(NEEDS_CONVERTER)),
        "xls" => c(Spreadsheet, "application/vnd.ms-excel", &[Sniff::Ole], StoreOnly, Some(NEEDS_CONVERTER)),
        "ppt" => c(Presentation, "application/vnd.ms-powerpoint", &[Sniff::Ole], StoreOnly, Some(NEEDS_CONVERTER)),
        "rtf" => c(Document, "application/rtf", &[Sniff::Rtf], StoreOnly, Some(NEEDS_CONVERTER)),
        "odt" => c(Document, "application/vnd.oasis.opendocument.text", &[Sniff::Zip], StoreOnly, Some(NEEDS_CONVERTER)),
        "ods" => c(Spreadsheet, "application/vnd.oasis.opendocument.spreadsheet", &[Sniff::Zip], StoreOnly, Some(NEEDS_CONVERTER)),
        "odp" => c(Presentation, "application/vnd.oasis.opendocument.presentation", &[Sniff::Zip], StoreOnly, Some(NEEDS_CONVERTER)),
        "epub" => c(Document, "application/epub+zip", &[Sniff::Zip], StoreOnly, Some(NEEDS_CONVERTER)),
        "png" => c(Image, "image/png", &[Sniff::Png], ImageInput, None),
        "jpg" | "jpeg" => c(Image, "image/jpeg", &[Sniff::Jpeg], ImageInput, None),
        "gif" => c(Image, "image/gif", &[Sniff::Gif], ImageInput, None),
        "webp" => c(Image, "image/webp", &[Sniff::Webp], ImageInput, None),
        "bmp" => c(Image, "image/bmp", &[Sniff::Bmp], StoreOnly, Some("BMP is stored; models receive PNG, JPEG, GIF or WEBP only (REQUIRES_CONVERTER)")),
        "tif" | "tiff" => c(Image, "image/tiff", &[Sniff::Tiff], StoreOnly, Some("TIFF is stored; models receive PNG, JPEG, GIF or WEBP only (REQUIRES_CONVERTER)")),
        "heic" | "heif" => c(Image, "image/heic", &[Sniff::Heic], StoreOnly, Some("HEIC is stored; this build has no HEIC decoder (REQUIRES_CONVERTER)")),
        "svg" => c(Image, "image/svg+xml", &[], TextExtraction, Some("SVG is read as XML text; it is never rendered or run")),
        "wav" => c(Audio, "audio/wav", &[Sniff::Wav], StoreOnly, Some("audio is stored; transcription needs the configured speech-to-text server")),
        "mp3" => c(Audio, "audio/mpeg", &[Sniff::Mp3], StoreOnly, Some("audio is stored; transcription needs the configured speech-to-text server")),
        "m4a" => c(Audio, "audio/mp4", &[Sniff::Mp4], StoreOnly, Some("audio is stored; transcription needs the configured speech-to-text server")),
        "ogg" => c(Audio, "audio/ogg", &[Sniff::Ogg], StoreOnly, Some("audio is stored; transcription needs the configured speech-to-text server")),
        "flac" => c(Audio, "audio/flac", &[Sniff::Flac], StoreOnly, Some("audio is stored; transcription needs the configured speech-to-text server")),
        "mp4" => c(Video, "video/mp4", &[Sniff::Mp4], StoreOnly, Some("video is stored; this build does not analyse video")),
        "mov" => c(Video, "video/quicktime", &[Sniff::Mp4], StoreOnly, Some("video is stored; this build does not analyse video")),
        "webm" => c(Video, "video/webm", &[Sniff::Matroska], StoreOnly, Some("video is stored; this build does not analyse video")),
        "mkv" => c(Video, "video/x-matroska", &[Sniff::Matroska], StoreOnly, Some("video is stored; this build does not analyse video")),
        "avi" => c(Video, "video/x-msvideo", &[Sniff::Avi], StoreOnly, Some("video is stored; this build does not analyse video")),
        "zip" => c(Archive, "application/zip", &[Sniff::Zip], StoreOnly, Some("archives are stored, not unpacked")),
        "gz" | "tgz" => c(Archive, "application/gzip", &[Sniff::Gzip], StoreOnly, Some("archives are stored, not unpacked")),
        "tar" => c(Archive, "application/x-tar", &[], StoreOnly, Some("archives are stored, not unpacked")),
        "7z" => c(Archive, "application/x-7z-compressed", &[Sniff::SevenZip], StoreOnly, Some("archives are stored, not unpacked")),
        "rar" => c(Archive, "application/vnd.rar", &[Sniff::Rar], StoreOnly, Some("archives are stored, not unpacked")),
        _ => c(Binary, "application/octet-stream", &[], StoreOnly, Some("an unknown format is stored, and its content is not read")),
    }
}

fn be16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(*b.get(at)?) << 8 | u32::from(*b.get(at + 1)?))
}

fn le16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(*b.get(at)?) | u32::from(*b.get(at + 1)?) << 8)
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(be16(b, at)? << 16 | be16(b, at + 2)?)
}

/// أبعاد صورة من رأسها وحده (PNG، GIF، JPEG، WEBP). لا فكّ للبكسلات.
fn dimensions(kind: Sniff, b: &[u8]) -> Option<(u32, u32)> {
    match kind {
        Sniff::Png => Some((be32(b, 16)?, be32(b, 20)?)),
        Sniff::Gif => Some((le16(b, 6)?, le16(b, 8)?)),
        Sniff::Webp => match b.get(12..16)? {
            b"VP8X" => Some((1 + (le16(b, 24)? | u32::from(*b.get(26)?) << 16), 1 + (le16(b, 27)? | u32::from(*b.get(29)?) << 16))),
            b"VP8 " => Some((le16(b, 26)? & 0x3FFF, le16(b, 28)? & 0x3FFF)),
            b"VP8L" => {
                let bits = u32::from(*b.get(21)?) | u32::from(*b.get(22)?) << 8 | u32::from(*b.get(23)?) << 16 | u32::from(*b.get(24)?) << 24;
                Some(((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1))
            }
            _ => None,
        },
        Sniff::Jpeg => {
            // يمشي على المقاطع حتى إطار SOF (C0..CF عدا C4 وC8 وCC).
            let mut i = 2;
            while i + 9 < b.len() {
                if b[i] != 0xFF {
                    return None;
                }
                let marker = b[i + 1];
                let len = be16(b, i + 2)? as usize;
                if (0xC0..=0xCF).contains(&marker) && ![0xC4, 0xC8, 0xCC].contains(&marker) {
                    return Some((be16(b, i + 7)?, be16(b, i + 5)?));
                }
                i += 2 + len;
            }
            None
        }
        _ => None,
    }
}

/// سمة حدث في نصّ وسوم (` onload=`، ` onclick=` …): مسافة ثم `on` ثم حروف ثم `=`.
fn has_event_attribute(lower: &str) -> bool {
    lower.match_indices(" on").any(|(at, _)| {
        let rest = &lower[at + 3..];
        let letters = rest.bytes().take_while(u8::is_ascii_lowercase).count();
        letters > 0 && rest[letters..].trim_start().starts_with('=')
    })
}

/// يفحص ملفًّا باسمه وبايتاته. يرفض ملفًّا يدّعي صيغة ثنائية معروفة ومحتواه غيرها.
pub fn inspect(name: &str, bytes: &[u8]) -> Result<Inspection, Spoofed> {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let claim = claim(&ext);
    let detected = sniff(bytes);
    let mut notes: Vec<&'static str> = claim.note.into_iter().collect();
    let content_check = if claim.accepted.is_empty() {
        // صيغة نصّية أو مجهولة: محتوى ثنائي معروف تحت امتداد نصّي هوية كاذبة.
        if let Some(found) = detected.filter(|_| claim.access == ModelAccess::TextExtraction) {
            return Err(Spoofed { claimed: claim.mime, detected: found.name() });
        }
        ContentCheck::Unverified
    } else {
        match detected {
            Some(found) if claim.accepted.contains(&found) => ContentCheck::Matched,
            Some(found) => return Err(Spoofed { claimed: claim.mime, detected: found.name() }),
            None => return Err(Spoofed { claimed: claim.mime, detected: "UNKNOWN" }),
        }
    };
    if ext == "svg" {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(1_048_576)]).to_ascii_lowercase();
        if !head.contains("<svg") {
            return Err(Spoofed { claimed: claim.mime, detected: "NOT_SVG" });
        }
        if head.contains("<script") || head.contains("javascript:") || has_event_attribute(&head) {
            notes.push("the SVG holds script or event attributes; they are never run");
        }
    }
    if ext == "pdf" {
        let text = String::from_utf8_lossy(bytes);
        if text.contains("/JavaScript") || text.contains("/OpenAction") || text.contains("/Launch") {
            notes.push("the PDF declares active content (JavaScript or launch actions); POLARIS only extracts its text and never runs it");
        }
    }
    let dims = detected.and_then(|kind| dimensions(kind, bytes));
    Ok(Inspection { family: claim.family, mime_type: claim.mime, content_check, model_access: claim.access, dimensions: dims, notes })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        b.extend_from_slice(&w.to_be_bytes());
        b.extend_from_slice(&h.to_be_bytes());
        b.extend_from_slice(&[8, 2, 0, 0, 0]);
        b
    }

    #[test]
    fn an_image_is_matched_by_its_signature_and_its_size_is_read_from_the_header() {
        let got = inspect("pasted-image-20261019-190507.png", &png(480, 320)).unwrap();
        assert_eq!((got.family, got.mime_type, got.content_check, got.model_access), (Family::Image, "image/png", ContentCheck::Matched, ModelAccess::ImageInput));
        assert_eq!(got.dimensions, Some((480, 320)));
        let gif = inspect("a.gif", b"GIF89a\x10\x00\x20\x00").unwrap();
        assert_eq!(gif.dimensions, Some((16, 32)));
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xC0, 0, 17, 8, 0, 200, 1, 44, 3, 0, 0, 0, 0];
        assert_eq!(inspect("p.JPG", &jpeg).unwrap().dimensions, Some((300, 200)));
    }

    #[test]
    fn a_renamed_file_is_refused_as_spoofed() {
        // PDF باسم صورة، وصورة باسم PDF، وأرشيف باسم نصّ، ونصّ باسم مستند Word.
        assert_eq!(inspect("photo.png", b"%PDF-1.7 ...").unwrap_err(), Spoofed { claimed: "image/png", detected: "PDF" });
        assert_eq!(inspect("report.pdf", &png(1, 1)).unwrap_err().detected, "PNG");
        assert_eq!(inspect("notes.txt", b"PK\x03\x04....").unwrap_err().detected, "ZIP");
        assert_eq!(inspect("brief.docx", b"just text").unwrap_err().detected, "UNKNOWN");
        assert_eq!(inspect("x.svg", b"hello").unwrap_err().detected, "NOT_SVG");
    }

    #[test]
    fn capabilities_are_stated_honestly_per_family() {
        assert_eq!(inspect("brief.docx", b"PK\x03\x04rest").unwrap().model_access, ModelAccess::TextExtraction);
        let doc = inspect("old.doc", b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1rest").unwrap();
        assert_eq!((doc.family, doc.model_access), (Family::Document, ModelAccess::StoreOnly));
        assert!(doc.notes.iter().any(|n| n.contains("REQUIRES_CONVERTER")));
        assert_eq!(inspect("song.mp3", b"ID3\x04rest").unwrap().family, Family::Audio);
        assert_eq!(inspect("clip.mp4", b"\0\0\0\x18ftypisomrest").unwrap().family, Family::Video);
        assert_eq!(inspect("photo.heic", b"\0\0\0\x18ftypheicrest").unwrap().model_access, ModelAccess::StoreOnly);
        let unknown = inspect("data.bin", &[1, 2, 3]).unwrap();
        assert_eq!((unknown.family, unknown.content_check, unknown.model_access), (Family::Binary, ContentCheck::Unverified, ModelAccess::StoreOnly));
        let notes = inspect("notes.md", "# عنوان".as_bytes()).unwrap();
        assert_eq!((notes.family, notes.content_check), (Family::Text, ContentCheck::Unverified));
    }

    #[test]
    fn active_content_in_svg_and_pdf_is_named_not_run() {
        let svg = inspect("logo.svg", br#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#).unwrap();
        assert!(svg.notes.iter().any(|n| n.contains("never run")));
        let pdf = inspect("form.pdf", b"%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>").unwrap();
        assert!(pdf.notes.iter().any(|n| n.contains("active content")));
    }
}
