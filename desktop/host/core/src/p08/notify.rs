// إشعارات النظام (ADR-042، تكليف 2026-10-19): انتهت مهمّة، أو فشلت أو حُجبت، أو تنتظر موافقة — والمجدولة كذلك لأنها تمرّ بالمسار نفسه.
//
// النواة تقرّر متى ولماذا، ومنفذ النظام (`SystemNotifier`) يُري الإشعار. النصّ عامّ عمدًا: لا عنوان مهمّة ولا جزء من جوابها ولا اسم
// ملف، فلا يظهر شيء من عمل المستخدم على شاشة القفل أو في مركز الإشعارات. الإعداد `notifications.enabled` يطفئها، و`notifications.sound`
// يتحكّم بصوتها (مطفأ افتراضيًّا). النتيجة تُسجَّل كما قالها النظام: «عُرض» لا يُقال إلا حين قبله النظام.

use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;

use super::integrations::settings::Phase08Settings;
use crate::p03::port::{MissionObserver, MissionOutcomeNote};

pub const SETTING_ENABLED: &str = "notifications.enabled";
pub const SETTING_SOUND: &str = "notifications.sound";

/// ما يعيده منفذ النظام.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Delivery {
    /// قبله النظام وعرضه.
    Shown,
    /// نافذة POLARIS في المقدّمة: المستخدم يرى النتيجة، فلا إشعار.
    SkippedForeground,
    /// رفضه النظام أو تعذّر.
    Failed,
}

/// منفذ إشعار النظام. يملؤه الربط على ويندوز؛ غيابه يعني «لا إشعارات على هذا المضيف».
pub trait SystemNotifier: Send + Sync {
    fn notify(&self, title: &str, body: &str, sound: bool) -> Delivery;
}

/// سبب الإشعار.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NotificationKind {
    MissionCompleted,
    MissionNeedsAttention,
    ApprovalRequired,
}

/// سجلّ إشعار واحد كما قرّره المضيف وقاله النظام.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NotificationRecord {
    pub kind: NotificationKind,
    pub delivery: Option<Delivery>,
    /// لماذا لم يُرسل: الإعداد مطفأ، أو لا منفذ على هذا المضيف.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<&'static str>,
}

/// سبب الإشعار من حالة المهمّة عند نهاية التشغيل. الإلغاء فعل المستخدم نفسه فلا يُبلَّغ به.
pub fn kind_of(state: &str) -> Option<NotificationKind> {
    match state {
        "COMPLETED" => Some(NotificationKind::MissionCompleted),
        "FAILED" | "BLOCKED" => Some(NotificationKind::MissionNeedsAttention),
        "WAITING_FOR_APPROVAL" => Some(NotificationKind::ApprovalRequired),
        _ => None,
    }
}

/// النصّ العامّ بلغة الواجهة. بلا أي محتوى من المهمّة.
pub fn text_of(kind: NotificationKind, arabic: bool) -> (&'static str, &'static str) {
    match (kind, arabic) {
        (NotificationKind::MissionCompleted, false) => ("POLARIS", "A task finished."),
        (NotificationKind::MissionCompleted, true) => ("POLARIS", "انتهت مهمة."),
        (NotificationKind::MissionNeedsAttention, false) => ("POLARIS", "A task stopped and needs your attention."),
        (NotificationKind::MissionNeedsAttention, true) => ("POLARIS", "توقفت مهمة وتحتاج انتباهك."),
        (NotificationKind::ApprovalRequired, false) => ("POLARIS", "A task is waiting for your approval."),
        (NotificationKind::ApprovalRequired, true) => ("POLARIS", "مهمة تنتظر موافقتك."),
    }
}

/// أقصى ما يُحفظ من سجلّ الإشعارات في الذاكرة.
const KEEP: usize = 50;

pub struct NotificationService {
    settings: Arc<Phase08Settings>,
    notifier: OnceLock<Arc<dyn SystemNotifier>>,
    /// لغة الواجهة الحالية، يقرؤها المضيف من إعداداته عند كل إشعار.
    locale: OnceLock<Arc<dyn Fn() -> String + Send + Sync>>,
    history: Mutex<Vec<NotificationRecord>>,
}

impl NotificationService {
    pub fn new(settings: Arc<Phase08Settings>) -> Self {
        Self { settings, notifier: OnceLock::new(), locale: OnceLock::new(), history: Mutex::new(Vec::new()) }
    }

    /// يربط منفذ النظام مرّة واحدة (الربط على ويندوز بعد أن تُنشأ النافذة).
    pub fn bind(&self, notifier: Arc<dyn SystemNotifier>) -> bool {
        self.notifier.set(notifier).is_ok()
    }

    pub fn bind_locale(&self, locale: Arc<dyn Fn() -> String + Send + Sync>) -> bool {
        self.locale.set(locale).is_ok()
    }

    /// مفعّلة ما لم يطفئها المستخدم. نصّها عامّ، فلا يكشف تفعيلُها شيئًا من العمل.
    pub fn enabled(&self) -> bool {
        self.settings.get(SETTING_ENABLED).and_then(|v| v.as_bool()) != Some(false)
    }

    pub fn sound(&self) -> bool {
        self.settings.get(SETTING_SOUND).and_then(|v| v.as_bool()) == Some(true)
    }

    /// آخر الإشعارات كما قرّرها المضيف وقالها النظام، الأحدث آخرًا.
    pub fn history(&self) -> Vec<NotificationRecord> {
        self.history.lock().map(|h| h.clone()).unwrap_or_default()
    }

    pub fn emit(&self, kind: NotificationKind) -> NotificationRecord {
        let record = if !self.enabled() {
            NotificationRecord { kind, delivery: None, skipped: Some("DISABLED") }
        } else if let Some(notifier) = self.notifier.get() {
            let arabic = self.locale.get().map(|f| f()).is_some_and(|l| l.starts_with("ar"));
            let (title, body) = text_of(kind, arabic);
            NotificationRecord { kind, delivery: Some(notifier.notify(title, body, self.sound())), skipped: None }
        } else {
            NotificationRecord { kind, delivery: None, skipped: Some("NO_SYSTEM_NOTIFIER") }
        };
        if let Ok(mut history) = self.history.lock() {
            history.push(record.clone());
            let excess = history.len().saturating_sub(KEEP);
            history.drain(..excess);
        }
        record
    }
}

impl MissionObserver for NotificationService {
    fn mission_finished(&self, note: &MissionOutcomeNote) {
        if let Some(kind) = kind_of(note.state) {
            self.emit(kind);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_text_carries_nothing_from_the_task() {
        for kind in [NotificationKind::MissionCompleted, NotificationKind::MissionNeedsAttention, NotificationKind::ApprovalRequired] {
            for arabic in [false, true] {
                let (title, body) = text_of(kind, arabic);
                assert_eq!(title, "POLARIS");
                assert!(body.len() < 80);
            }
        }
        assert_eq!(kind_of("CANCELLED"), None, "the user's own cancel is not announced");
        assert_eq!(kind_of("BLOCKED"), Some(NotificationKind::MissionNeedsAttention));
    }
}
