// جذر واحد لمجلدات الاختبار المؤقتة.
//
// لماذا: كل اختبار كان ينشئ `%TEMP%\polaris-*` ولا يحذفه (قواعد بيانات مفتوحة، وملفات
// يمسكها Windows)، فتراكم في جهاز المالك 9414 مجلدًا و4.5 GB. الآن تذهب كلها تحت
// `%TEMP%\polaris-tests`، وأول استدعاء في كل عملية اختبار يحذف منها ما مضى عليه أكثر
// من ساعتين — أي ما تركته تشغيلات سابقة، لا ما يستعمله التشغيل الجاري. فشل الحذف
// (ملف ممسوك) يُتجاهل: المجلد يُحذف في تشغيل لاحق.
//
// ليس للمنتج: لا يستدعيه إلا كود الاختبار.

use std::path::PathBuf;
use std::sync::Once;
use std::time::{Duration, SystemTime};

const STALE_AFTER: Duration = Duration::from_secs(2 * 60 * 60);
static PURGE: Once = Once::new();

#[doc(hidden)]
pub fn root() -> PathBuf {
    let root = std::env::temp_dir().join("polaris-tests");
    PURGE.call_once(|| purge_stale(&root));
    let _ = std::fs::create_dir_all(&root);
    root
}

fn purge_stale(root: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > STALE_AFTER);
        if !old {
            continue;
        }
        let path = entry.path();
        // مجلد أو ملف؛ والوصلة تُحذف هي نفسها لا ما تشير إليه.
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let _ = if is_dir { std::fs::remove_dir_all(&path) } else { std::fs::remove_file(&path) };
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_root_exists_and_is_shared() {
        let a = super::root();
        let b = super::root();
        assert_eq!(a, b);
        assert!(a.is_dir());
        assert!(a.ends_with("polaris-tests"));
    }
}
