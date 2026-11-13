// تشخيص على جانب المضيف.
//
// التفصيل الداخلي يُحتفظ به هنا ولا يعبر الحدّ. الحدّ الأعلى للسجل مقصود: سجل
// غير محدود في عملية طويلة العمر تسريبُ ذاكرة بثياب ميزة.
//
// الملف اختياري ومحدود أيضًا: سجلّ الذاكرة يموت مع العملية، فخطأ يظهر للمالك
// «INTERNAL_ERROR» وحده لا يُشخَّص بعد إغلاق التطبيق (2026-10-06، قائمة النماذج).
// الملف على جهاز المالك وحده، ولا يعبر الحدّ كما لا يعبره سجل الذاكرة.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::ipc::errors::HostError;

const MAX_RECORDS: usize = 256;
/// حين يتجاوز الملف هذا الحجم يُنقل إلى `.1` ويبدأ ملف جديد: ملفّان على الأكثر.
const MAX_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Default)]
pub struct Diagnostics {
    lines: Mutex<Vec<String>>,
    file: Option<PathBuf>,
}

impl Diagnostics {
    pub fn new() -> Self {
        Self { lines: Mutex::new(Vec::new()), file: None }
    }

    /// مثل `new`، ويُلحق كل سطر بالملف أيضًا. فشل الكتابة لا يُفشل الطلب.
    pub fn with_file(path: PathBuf) -> Self {
        Self { lines: Mutex::new(Vec::new()), file: Some(path) }
    }

    fn append_to_file(&self, line: &str) {
        let Some(path) = &self.file else { return };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::metadata(path).map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(false) {
            let _ = std::fs::rename(path, path.with_extension("log.1"));
        }
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{} {}", crate::time::now_rfc3339_utc(), line);
        }
    }

    pub fn record(&self, error: &HostError) {
        if let Ok(mut lines) = self.lines.lock() {
            if lines.len() >= MAX_RECORDS {
                lines.remove(0);
            }
            let line = error.diagnostic_line();
            self.append_to_file(&line);
            lines.push(line);
        }
    }

    /// نسخة من السجل. تُستعمل في اختبارات المضيف وفي تصدير تشخيصي لاحق،
    /// ولا تُعاد عبر أي عملية IPC في هذه المرحلة.
    pub fn snapshot(&self) -> Vec<String> {
        self.lines.lock().map(|lines| lines.clone()).unwrap_or_default()
    }

    pub fn len(&self) -> usize {
        self.lines.lock().map(|lines| lines.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_log_is_bounded() {
        let diagnostics = Diagnostics::new();
        for index in 0..(MAX_RECORDS + 10) {
            diagnostics.record(&HostError::internal(format!("event {index}")));
        }
        assert_eq!(diagnostics.len(), MAX_RECORDS);
    }

    #[test]
    fn detail_is_kept_on_the_host_side() {
        let diagnostics = Diagnostics::new();
        diagnostics.record(&HostError::internal("path D:\\POLARIS\\host"));
        assert!(diagnostics.snapshot()[0].contains("D:\\POLARIS\\host"));
    }

    #[test]
    fn the_file_keeps_the_detail_after_the_process() {
        let dir = std::env::temp_dir().join(format!("polaris-diag-{}", crate::ids::new_uuid_v4()));
        let path = dir.join("logs").join("host-diagnostics.log");
        Diagnostics::with_file(path.clone()).record(&HostError::internal("model facts: missing field"));
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("INTERNAL_ERROR - model facts: missing field"), "{text}");
        let _ = std::fs::remove_dir_all(dir);
    }
}
