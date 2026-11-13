// إشعار النظام على ويندوز (ADR-042، تكليف 2026-10-19): ملف FFI واحد مُسمّى، غرضه `Shell_NotifyIconW` وحده.
//
// لماذا هذا لا إشعار WinRT: التطبيق غير مثبّت بحزمة، فلا معرّف تطبيق (AUMID) مسجّل يقبله `ToastNotificationManager`. فقاعة أيقونة
// منطقة الإعلام يعرضها ويندوز 10/11 إشعارًا في مركز الإشعارات لعملية غير مثبّتة، بلا تبعية جديدة. القبول يُقرأ من قيمة الإرجاع:
// «عُرض» يعني أن `Shell_NotifyIconW` أعاد نجاحًا، لا أكثر. نافذة POLARIS في المقدّمة: لا إشعار، فالمستخدم يرى النتيجة.

use polaris_host_core::p08::notify::{Delivery, SystemNotifier};

/// معرّف أيقونتنا في منطقة الإعلام، ثابت لهذه النافذة.
#[cfg(windows)]
const ICON_ID: u32 = 0x504F;
/// مدّة بقاء الأيقونة بعد الإشعار، ثم تُزال فلا تبقى أيقونة لا عمل لها.
#[cfg(windows)]
const LINGER: std::time::Duration = std::time::Duration::from_secs(20);

pub struct Win32Notifier {
    /// مقبض النافذة الرئيسة. يبقى صالحًا ما دامت النافذة، وهي تعيش ما عاش التطبيق.
    pub hwnd: isize,
}

#[cfg(windows)]
fn wide_into(dst: &mut [u16], text: &str) {
    let units: Vec<u16> = text.encode_utf16().take(dst.len().saturating_sub(1)).collect();
    dst[..units.len()].copy_from_slice(&units);
    dst[units.len()] = 0;
}

#[cfg(windows)]
impl SystemNotifier for Win32Notifier {
    fn notify(&self, title: &str, body: &str, sound: bool) -> Delivery {
        use windows_sys::Win32::UI::Shell::{Shell_NotifyIconW, NIF_ICON, NIF_INFO, NIF_TIP, NIIF_INFO, NIIF_NOSOUND, NIM_ADD, NIM_DELETE, NIM_MODIFY, NOTIFYICONDATAW};
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, LoadIconW, SendMessageW, ICON_SMALL2, IDI_APPLICATION, WM_GETICON};

        let hwnd = self.hwnd as windows_sys::Win32::Foundation::HWND;
        // SAFETY: نداء بلا مدخلات يعيد مقبضًا أو صفرًا.
        if unsafe { GetForegroundWindow() } == hwnd {
            return Delivery::SkippedForeground;
        }
        // SAFETY: NOTIFYICONDATAW بنية بيانات بسيطة؛ الصفر قيمة ابتدائية صالحة لكل حقولها.
        let mut data: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
        data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        data.hWnd = hwnd;
        data.uID = ICON_ID;
        data.uFlags = NIF_ICON | NIF_TIP | NIF_INFO;
        // أيقونة النافذة نفسها، وإلا أيقونة التطبيق العامّة من النظام.
        // SAFETY: مقبض نافذة حيّ، والرسالة لا تكتب في ذاكرتنا.
        let icon = unsafe { SendMessageW(hwnd, WM_GETICON, ICON_SMALL2 as usize, 0) };
        data.hIcon = if icon != 0 { icon as _ } else { unsafe { LoadIconW(std::ptr::null_mut(), IDI_APPLICATION) } };
        wide_into(&mut data.szTip, "POLARIS");
        wide_into(&mut data.szInfoTitle, title);
        wide_into(&mut data.szInfo, body);
        data.dwInfoFlags = NIIF_INFO | if sound { 0 } else { NIIF_NOSOUND };
        // أيقونة باقية من إشعار سابق تُحدَّث، وإلا تُضاف.
        // SAFETY: البنية مملوءة بطولها المعلن، ومؤشّرها حيّ طوال النداء المتزامن.
        let shown = unsafe { Shell_NotifyIconW(NIM_MODIFY, &data) } != 0 || unsafe { Shell_NotifyIconW(NIM_ADD, &data) } != 0;
        if !shown {
            return Delivery::Failed;
        }
        let handle = self.hwnd;
        let _ = std::thread::Builder::new().name("polaris-notify-cleanup".into()).spawn(move || {
            std::thread::sleep(LINGER);
            // SAFETY: كما أعلاه؛ الحذف بالمعرّف والنافذة وحدهما.
            let mut remove: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
            remove.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
            remove.hWnd = handle as windows_sys::Win32::Foundation::HWND;
            remove.uID = ICON_ID;
            unsafe { Shell_NotifyIconW(NIM_DELETE, &remove) };
        });
        Delivery::Shown
    }
}

#[cfg(not(windows))]
impl SystemNotifier for Win32Notifier {
    fn notify(&self, _title: &str, _body: &str, _sound: bool) -> Delivery {
        Delivery::Failed
    }
}

// اختبار دخان أصلي (ADR-042): نافذة مخفية يملكها الاختبار، وإشعار حقيقي عبر ويندوز. يُترجَم بالميزة `win32-smoke` وحدها، ولا
// يلمس نافذة غيره. ما يثبته: أن `Shell_NotifyIconW` قبل الإشعار (`Shown`). ظهوره على الشاشة لا يقيسه الاختبار.
#[cfg(all(test, windows, feature = "win32-smoke"))]
mod tests {
    use super::*;

    #[test]
    fn windows_accepts_a_notification_from_a_window_that_is_not_in_front() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, WS_OVERLAPPED};
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let title: Vec<u16> = "POLARIS notify smoke\0".encode_utf16().collect();
        // SAFETY: صنف نظام معرَّف مسبقًا، ونصّان منتهيان بصفر حيّان طوال النداء؛ لا أب ولا قائمة.
        let hwnd = unsafe { CreateWindowExW(0, class.as_ptr(), title.as_ptr(), WS_OVERLAPPED, 0, 0, 10, 10, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null()) };
        assert!(!hwnd.is_null(), "the test window was not created");
        let notifier = Win32Notifier { hwnd: hwnd as isize };
        let delivery = notifier.notify("POLARIS", "Notification smoke test (ADR-042).", false);
        eprintln!("delivery: {delivery:?}");
        // SAFETY: نافذة أنشأها هذا الاختبار للتوّ.
        unsafe { DestroyWindow(hwnd) };
        assert_eq!(delivery, Delivery::Shown, "Windows did not accept the notification");
    }
}
