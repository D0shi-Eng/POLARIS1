// قفل المثيل على مجلد البيانات.
//
// لماذا ملف قفل منفصل لا قفل على القاعدة نفسها: قفل SQLite يخصّ المعاملة، أما
// الاستعادة فتستبدل الملف كله، ولا يجوز أن تحدث وتطبيقٌ يحمل الملف مفتوحًا.
// المنتج يأخذ قفلًا مشتركًا طوال عمره، وأداة الصيانة تطلب قفلًا حصريًا بلا انتظار:
// إن كان التطبيق يعمل رُفض طلبها، ولا تُستبدل قاعدة تحت عملية حيّة.
// وفوقه قفل المثيل الواحد: حصري على ملف منفصل يأخذه التطبيق وحده، فلا تعمل نسختان على
// مجلد البيانات نفسه (قيس 2026-10-01: نسختان تشاركتا القاعدة وكلّ منهما تكتب حالة مهامّها).
// ملف منفصل لأن الصيانة تقيس الحصري على `polaris.lock`، ولا يتغيّر عقدها.

use std::fs::{File, OpenOptions, TryLockError};
use std::path::Path;

/// اسم ملف القفل داخل مجلد البيانات. فارغ دائمًا: القفل في نظام الملفات لا في المحتوى.
pub const LOCK_FILE: &str = "polaris.lock";

/// ملف قفل المثيل الواحد للتطبيق. لا تلمسه أداة الصيانة.
pub const APP_LOCK_FILE: &str = "polaris-app.lock";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LockError {
    /// عملية أخرى تحمل قفلًا يتعارض مع المطلوب.
    Busy,
    Io(String),
}

impl std::fmt::Display for LockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy => f.write_str("the data directory is in use by another process"),
            Self::Io(e) => write!(f, "lock: {e}"),
        }
    }
}

/// قفل محمول؛ يُحرَّر حين يُسقط الكائن أو تنتهي العملية، ولو بانهيار.
#[derive(Debug)]
pub struct InstanceLock {
    _file: File,
    exclusive: bool,
}

fn open_lock_file(directory: &Path) -> Result<File, LockError> {
    open_named(directory, LOCK_FILE)
}

fn open_named(directory: &Path, name: &str) -> Result<File, LockError> {
    std::fs::create_dir_all(directory).map_err(|e| LockError::Io(e.to_string()))?;
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join(name))
        .map_err(|e| LockError::Io(e.to_string()))
}

fn map_try(error: TryLockError) -> LockError {
    match error {
        TryLockError::WouldBlock => LockError::Busy,
        TryLockError::Error(e) => LockError::Io(e.to_string()),
    }
}

impl InstanceLock {
    /// قفل التطبيق: مشترك، بلا انتظار. يفشل فقط إن كانت الصيانة تحمل الحصري.
    pub fn shared(directory: &Path) -> Result<Self, LockError> {
        let file = open_lock_file(directory)?;
        file.try_lock_shared().map_err(map_try)?;
        Ok(Self { _file: file, exclusive: false })
    }

    /// قفل الصيانة: حصري، بلا انتظار. يفشل إن كان أي مثيل للتطبيق يعمل.
    pub fn exclusive(directory: &Path) -> Result<Self, LockError> {
        let file = open_lock_file(directory)?;
        file.try_lock().map_err(map_try)?;
        Ok(Self { _file: file, exclusive: true })
    }

    /// قفل المثيل الواحد: حصري على ملفه، بلا انتظار. يفشل بـ`Busy` إن كانت نسخة أخرى من
    /// التطبيق تعمل على المجلد نفسه، ولا يتعارض مع قفل القاعدة المشترك ولا مع الصيانة.
    pub fn application(directory: &Path) -> Result<Self, LockError> {
        let file = open_named(directory, APP_LOCK_FILE)?;
        file.try_lock().map_err(map_try)?;
        Ok(Self { _file: file, exclusive: true })
    }

    pub fn is_exclusive(&self) -> bool {
        self.exclusive
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = crate::test_scratch::root().join(format!("lock-{name}-{}-{}", std::process::id(), crate::ids::new_uuid_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn two_shared_holders_coexist_and_block_an_exclusive_request() {
        let dir = temp_dir("shared");
        let first = InstanceLock::shared(&dir).unwrap();
        let second = InstanceLock::shared(&dir).unwrap();
        assert_eq!(InstanceLock::exclusive(&dir).unwrap_err(), LockError::Busy);
        drop(first);
        assert_eq!(InstanceLock::exclusive(&dir).unwrap_err(), LockError::Busy, "one holder is still alive");
        drop(second);
        let exclusive = InstanceLock::exclusive(&dir).unwrap();
        assert!(exclusive.is_exclusive());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_application_is_refused_while_the_first_runs_and_the_database_lock_is_unchanged() {
        let dir = temp_dir("application");
        let first = InstanceLock::application(&dir).unwrap();
        assert_eq!(InstanceLock::application(&dir).unwrap_err(), LockError::Busy);
        // قفل القاعدة المشترك وقفل الصيانة على ملف آخر: لا يتأثران.
        let shared = InstanceLock::shared(&dir).unwrap();
        drop(shared);
        assert!(InstanceLock::exclusive(&dir).is_ok());
        drop(first);
        assert!(InstanceLock::application(&dir).is_ok(), "the lock outlived the first application");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_exclusive_holder_refuses_the_application() {
        let dir = temp_dir("exclusive");
        let maintenance = InstanceLock::exclusive(&dir).unwrap();
        assert_eq!(InstanceLock::shared(&dir).unwrap_err(), LockError::Busy);
        drop(maintenance);
        assert!(InstanceLock::shared(&dir).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
