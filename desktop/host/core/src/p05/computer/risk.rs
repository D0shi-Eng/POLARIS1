// تقدير خطر فعل على سطح المكتب (البند 33/34).
//
// ثلاث نتائج لا أكثر: رفض (واجهة أمان، حقل كلمة مرور)، أو موافقة (فعل يبدو حذفًا
// أو تثبيتًا أو إرسالًا أو شراءً، أو هدف لا يُعرف أثره)، أو آمن. والقاعدة حين لا يمكن
// تحديد الأثر بأمان: لا يُفترض بريئًا. التفاعل مع نوافذ UAC خارج النطاق كليًّا.

use super::observation::ObservedElement;
use super::port::WindowInfo;

/// الحكم.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sensitivity {
    Refuse(&'static str),
    Approve(&'static str),
    Safe,
}

/// ملفات تنفيذية لواجهات أمان واعتماد. لا إدخال إليها في هذه المرحلة.
const SECURITY_EXECUTABLES: &[&str] = &[
    "consent.exe",
    "credentialuibroker.exe",
    "logonui.exe",
    "lockapp.exe",
    "securityhealthsystray.exe",
    "securityhealthhost.exe",
    "useraccountcontrolsettings.exe",
    "msedgewebview2.exe",
];

const SECURITY_TITLE_WORDS: &[&str] = &[
    "user account control",
    "windows security",
    "credential",
    "password",
    "sign in",
    "التحكم في حساب المستخدم",
    "أمان windows",
    "كلمة المرور",
    "تسجيل الدخول",
];

/// كلمات تدلّ على فعل عالي الخطر في نصّ زرّ أو عنصر.
const HIGH_RISK_WORDS: &[&str] = &[
    "delete", "remove", "erase", "wipe", "format", "install", "uninstall", "setup", "run", "execute", "send", "submit", "publish",
    "purchase", "buy", "pay", "order", "checkout", "transfer", "registry", "regedit", "firewall", "defender", "disable", "reset",
    "shutdown", "restart", "sign out", "overwrite", "حذف", "إزالة", "ازالة", "تهيئة", "تثبيت", "تشغيل", "إرسال", "ارسال", "شراء",
    "دفع", "تحويل", "أمان", "إعادة تعيين",
];

/// كلمات تأكيد في مربّع حوار. زرّ «موافق» في حوار يؤكّد ما لا نعرفه.
const CONFIRM_WORDS: &[&str] = &["ok", "yes", "continue", "allow", "confirm", "موافق", "نعم", "متابعة", "سماح", "تأكيد"];

fn has_word(text: &str, words: &[&str]) -> bool {
    let lower = text.to_lowercase();
    words.iter().any(|w| {
        if w.is_ascii() && !w.contains(' ') {
            lower.split(|c: char| !c.is_alphanumeric()).any(|t| t == *w)
        } else {
            lower.contains(w)
        }
    })
}

/// هل النافذة واجهة أمان أو اعتماد؟ يُرفض كل إدخال إليها.
pub fn window_sensitivity(window: &WindowInfo) -> Sensitivity {
    let exe = window.identity.executable_name().to_ascii_lowercase();
    if SECURITY_EXECUTABLES.contains(&exe.as_str()) {
        return Sensitivity::Refuse("SECURITY_PROMPT");
    }
    let class = window.identity.class_name.to_ascii_lowercase();
    if class.contains("credential") {
        return Sensitivity::Refuse("CREDENTIAL_DIALOG");
    }
    if has_word(&window.title, SECURITY_TITLE_WORDS) {
        return Sensitivity::Refuse("CREDENTIAL_DIALOG");
    }
    Sensitivity::Safe
}

fn is_dialog(window: &WindowInfo) -> bool {
    window.identity.class_name == "#32770"
}

/// خطر نقرٍ أو تفعيلٍ لعنصر.
pub fn activation_sensitivity(window: &WindowInfo, element: Option<&ObservedElement>) -> Sensitivity {
    if let Sensitivity::Refuse(reason) = window_sensitivity(window) {
        return Sensitivity::Refuse(reason);
    }
    let Some(element) = element else {
        // نقطة بلا عنصر معروف: الأثر لا يُحدَّد بأمان.
        return Sensitivity::Approve("UNKNOWN_TARGET");
    };
    if !element.enabled {
        return Sensitivity::Refuse("ELEMENT_DISABLED");
    }
    if has_word(&element.text, HIGH_RISK_WORDS) {
        return Sensitivity::Approve("HIGH_RISK_WORDING");
    }
    if is_dialog(window) && has_word(&element.text, CONFIRM_WORDS) {
        return Sensitivity::Approve("DIALOG_CONFIRMATION");
    }
    Sensitivity::Safe
}

/// خطر كتابة نصّ في العنصر المركَّز أو المسمّى.
pub fn typing_sensitivity(window: &WindowInfo, element: Option<&ObservedElement>, text: &str) -> Sensitivity {
    if let Sensitivity::Refuse(reason) = window_sensitivity(window) {
        return Sensitivity::Refuse(reason);
    }
    if element.is_some_and(|e| e.password) {
        return Sensitivity::Refuse("PASSWORD_FIELD");
    }
    if crate::p05::secret::find(text).is_some() {
        return Sensitivity::Refuse("SECRET_LIKE_TEXT");
    }
    if element.is_none() {
        // الكتابة حيث لا نعرف العنصر المستقبِل: لا تُفترض آمنة.
        return Sensitivity::Approve("UNKNOWN_TARGET");
    }
    Sensitivity::Safe
}

#[cfg(test)]
mod tests {
    use super::super::port::{Rect, WindowIdentity};
    use super::*;

    fn window(exe: &str, class: &str, title: &str) -> WindowInfo {
        WindowInfo {
            identity: WindowIdentity { hwnd: 1, pid: 2, process_created_at: 3, executable: format!("C:\\Windows\\System32\\{exe}"), thread_id: 4, class_name: class.into() },
            title: title.into(),
            rect: Rect { left: 0, top: 0, right: 100, bottom: 100 },
            visible: true,
            minimized: false,
        }
    }

    fn element(text: &str, password: bool) -> ObservedElement {
        ObservedElement { element_ref: "c1".into(), role: "BUTTON", text: text.into(), x: 0, y: 0, width: 10, height: 10, enabled: true, password, handle: 9 }
    }

    #[test]
    fn security_prompts_and_credential_dialogs_are_refused() {
        assert_eq!(window_sensitivity(&window("consent.exe", "x", "User Account Control")), Sensitivity::Refuse("SECURITY_PROMPT"));
        assert_eq!(window_sensitivity(&window("app.exe", "Credential Dialog Xaml Host", "")), Sensitivity::Refuse("CREDENTIAL_DIALOG"));
        assert_eq!(window_sensitivity(&window("app.exe", "#32770", "Windows Security")), Sensitivity::Refuse("CREDENTIAL_DIALOG"));
    }

    #[test]
    fn a_password_field_never_receives_text() {
        let w = window("fixture.exe", "Fixture", "fixture");
        assert_eq!(typing_sensitivity(&w, Some(&element("", true)), "hello"), Sensitivity::Refuse("PASSWORD_FIELD"));
        assert_eq!(typing_sensitivity(&w, Some(&element("", false)), "hello"), Sensitivity::Safe);
        assert_eq!(typing_sensitivity(&w, None, "hello"), Sensitivity::Approve("UNKNOWN_TARGET"));
    }

    #[test]
    fn destructive_wording_and_unknown_targets_need_approval() {
        let w = window("fixture.exe", "Fixture", "fixture");
        assert_eq!(activation_sensitivity(&w, Some(&element("Delete all files", false))), Sensitivity::Approve("HIGH_RISK_WORDING"));
        assert_eq!(activation_sensitivity(&w, Some(&element("تثبيت البرنامج", false))), Sensitivity::Approve("HIGH_RISK_WORDING"));
        assert_eq!(activation_sensitivity(&w, Some(&element("Increment", false))), Sensitivity::Safe);
        assert_eq!(activation_sensitivity(&w, None), Sensitivity::Approve("UNKNOWN_TARGET"));
        let dialog = window("app.exe", "#32770", "Confirm");
        assert_eq!(activation_sensitivity(&dialog, Some(&element("OK", false))), Sensitivity::Approve("DIALOG_CONFIRMATION"));
    }
}
