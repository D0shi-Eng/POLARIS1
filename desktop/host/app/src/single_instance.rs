// المثيل الواحد: نسخة ثانية من التطبيق على مجلد البيانات نفسه لا تعمل؛ تُظهر نافذة الأولى ثم تخرج.
//
// القفل نفسه في `storage::lock` (حصري على ملف منفصل عن قفل القاعدة)، وهنا ما يخصّ النافذة فقط.
// قيس 2026-10-01: نسختان عملتا معًا على القاعدة نفسها، وكل منهما تقرأ حالة مهامّ الأخرى وتكتب.

use std::path::Path;

use polaris_host_core::storage::lock::{InstanceLock, LockError};

/// نتيجة محاولة الحجز.
pub enum Claim {
    /// هذه النسخة وحدها؛ القفل يُحمل طوال عمر التطبيق.
    Held(InstanceLock),
    /// نسخة أخرى تعمل على المجلد نفسه.
    Busy,
    /// لا مجلد بيانات (قاعدة في الذاكرة) أو تعذّر فتح ملف القفل: لا قاعدة مشتركة تُحمى، فيُكمل التطبيق.
    Unguarded,
}

pub fn claim(data_dir: Option<&Path>) -> Claim {
    let Some(dir) = data_dir else { return Claim::Unguarded };
    match InstanceLock::application(dir) {
        Ok(lock) => Claim::Held(lock),
        Err(LockError::Busy) => Claim::Busy,
        Err(LockError::Io(_)) => Claim::Unguarded,
    }
}

/// يُظهر نافذة النسخة العاملة ويقدّمها. يبحث عن نافذة عنوانها عنوان التطبيق في عملية أخرى غير هذه.
#[cfg(windows)]
pub fn focus_existing(title: &str) {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    struct Search {
        title: Vec<u16>,
        own_pid: u32,
        found: HWND,
    }

    unsafe extern "system" fn visit(window: HWND, data: LPARAM) -> i32 {
        // SAFETY: `data` مؤشّر إلى `Search` حيّ طوال نداء EnumWindows المتزامن أدناه.
        let search = unsafe { &mut *(data as *mut Search) };
        let mut pid = 0u32;
        // SAFETY: مقبض نافذة أعطاه النظام للتوّ، ومؤشّر إلى متغيّر محلّي.
        unsafe { GetWindowThreadProcessId(window, &mut pid) };
        if pid == search.own_pid || unsafe { IsWindowVisible(window) } == 0 {
            return 1;
        }
        let mut buffer = [0u16; 64];
        // SAFETY: المخزن بطول معلَن، والنظام لا يكتب بعده.
        let len = unsafe { GetWindowTextW(window, buffer.as_mut_ptr(), buffer.len() as i32) };
        if len > 0 && buffer[..len as usize] == search.title[..] {
            search.found = window;
            return 0;
        }
        1
    }

    let mut search = Search { title: title.encode_utf16().collect(), own_pid: unsafe { GetCurrentProcessId() }, found: std::ptr::null_mut() };
    // SAFETY: النداء متزامن، و`search` يبقى حيًّا حتى يعود.
    unsafe { EnumWindows(Some(visit), &mut search as *mut Search as LPARAM) };
    if search.found.is_null() {
        return;
    }
    // SAFETY: مقبض نافذة صالح وجده التعداد للتوّ؛ إن أُغلقت بينهما فشل النداءان بلا أثر.
    unsafe {
        if IsIconic(search.found) != 0 {
            ShowWindow(search.found, SW_RESTORE);
        }
        SetForegroundWindow(search.found);
    }
}

#[cfg(not(windows))]
pub fn focus_existing(_title: &str) {}
