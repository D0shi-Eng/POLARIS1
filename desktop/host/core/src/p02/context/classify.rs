// تصنيف المحتوى، واستبعاد الملفات الحساسة.
//
// الامتداد يقترح الصنف، وفحص البايتات يصحّحه: ملف نصّي الامتداد فيه بايت صفري
// ثنائي. والملفات التي تحمل عادةً أسرارًا (`.env`، مفاتيح خاصة، ملفات اعتماد)
// لا تدخل السياق حتى لو اختارها المستخدم ضمن مجلد.

use super::model::ContentClass;

const SOURCE: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "cs", "java", "kt", "go", "c", "h", "cpp", "hpp", "cc", "swift", "rb", "php",
    "ps1", "psm1", "sh", "bash", "sql", "html", "css", "scss", "vue", "svelte", "lua", "dart", "scala", "m", "r",
];
const DOCS: &[&str] = &["md", "markdown", "txt", "rst", "adoc", "org", "tex"];
const CONFIG: &[&str] = &["json", "jsonc", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "props", "csproj", "sln", "editorconfig", "lock"];
const DATA: &[&str] = &["csv", "tsv", "jsonl", "ndjson", "log"];
const IMAGE: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "svg", "tif", "tiff", "heic"];
const AUDIO: &[&str] = &["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"];
const BINARY: &[&str] = &[
    "exe", "dll", "so", "dylib", "bin", "zip", "7z", "rar", "gz", "tar", "tgz", "pdf", "docx", "xlsx", "pptx", "db", "sqlite", "wasm",
    "pdb", "obj", "o", "a", "lib", "class", "jar", "mp4", "mkv", "avi", "mov", "iso", "msi", "parquet", "npy",
];

/// الصنف من الامتداد.
pub fn by_name(file_name: &str) -> ContentClass {
    let lower = file_name.to_ascii_lowercase();
    let ext = match lower.rsplit_once('.') {
        Some((_, ext)) => ext.to_string(),
        None => return if matches!(lower.as_str(), "readme" | "license" | "changelog" | "makefile" | "dockerfile") { ContentClass::Documentation } else { ContentClass::Unknown },
    };
    let in_list = |list: &[&str]| list.contains(&ext.as_str());
    if in_list(SOURCE) {
        ContentClass::SourceCode
    } else if in_list(DOCS) {
        ContentClass::Documentation
    } else if in_list(CONFIG) {
        ContentClass::Configuration
    } else if in_list(DATA) {
        ContentClass::Data
    } else if in_list(IMAGE) {
        ContentClass::Image
    } else if in_list(AUDIO) {
        ContentClass::Audio
    } else if in_list(BINARY) {
        ContentClass::Binary
    } else {
        ContentClass::Unknown
    }
}

/// التصحيح بالبايتات: صفر في أول 8 كيلوبايت يعني ثنائيًا.
pub fn refine(class: ContentClass, head: &[u8]) -> ContentClass {
    if head.iter().take(8192).any(|b| *b == 0) {
        return ContentClass::Binary;
    }
    class
}

/// هل يُستبعد هذا الملف لأنه يحمل أسرارًا عادةً؟
pub fn is_sensitive(file_name: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    lower == ".env"
        || lower.starts_with(".env.")
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
        || lower.ends_with(".pfx")
        || lower.ends_with(".p12")
        || lower.ends_with(".kdbx")
        || lower.starts_with("id_rsa")
        || lower.starts_with("id_ed25519")
        || lower.starts_with("id_ecdsa")
        || lower == ".npmrc"
        || lower == ".pypirc"
        || lower == ".netrc"
        || lower == ".git-credentials"
        || lower.contains("credentials")
        || lower.contains("secrets")
}

/// مجلدات لا تُمشى أبدًا عند توسيع مجلد.
pub fn is_skipped_directory(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name.to_ascii_lowercase().as_str(),
            "node_modules" | "target" | "dist" | "build" | "build-tests" | "__pycache__" | "venv" | ".venv" | "bin" | "obj" | "out"
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_map_to_classes() {
        assert_eq!(by_name("main.rs"), ContentClass::SourceCode);
        assert_eq!(by_name("README.md"), ContentClass::Documentation);
        assert_eq!(by_name("Cargo.toml"), ContentClass::Configuration);
        assert_eq!(by_name("data.CSV"), ContentClass::Data);
        assert_eq!(by_name("logo.png"), ContentClass::Image);
        assert_eq!(by_name("voice.wav"), ContentClass::Audio);
        assert_eq!(by_name("app.exe"), ContentClass::Binary);
        assert_eq!(by_name("mystery.xyz"), ContentClass::Unknown);
        assert_eq!(by_name("README"), ContentClass::Documentation);
    }

    #[test]
    fn a_nul_byte_makes_any_file_binary() {
        assert_eq!(refine(ContentClass::Documentation, b"ab\0cd"), ContentClass::Binary);
        assert_eq!(refine(ContentClass::Documentation, "نص".as_bytes()), ContentClass::Documentation);
    }

    #[test]
    fn secret_bearing_files_are_excluded() {
        for name in [".env", ".env.local", "server.pem", "id_rsa", "aws_credentials.json", "secrets.yaml", ".npmrc"] {
            assert!(is_sensitive(name), "{name}");
        }
        for name in ["README.md", "environment.md", "keyboard.rs"] {
            assert!(!is_sensitive(name), "{name}");
        }
    }
}
