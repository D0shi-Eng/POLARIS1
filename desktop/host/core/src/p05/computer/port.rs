// منفذ سطح المكتب: ما تحتاجه طبقة التحكّم من نظام التشغيل، ولا شيء غيره.
//
// النواة لا تعرف Win32 (ولا `unsafe` فيها). التنفيذ الحقيقي على Windows يعيش في
// طبقة الربط، في ملف واحد مُسمّى، وهنا العقد وحده. غياب المنصّة يُعلن «غير متاح»
// ولا يُحاكى: لا نقر مُتخيَّل ولا لقطة مصطنعة في مسار المنتج.

use serde::{Deserialize, Serialize};

/// هويّة نافذة. العنوان ليس هويّة (البند 30): يتغيّر، ويتكرّر، وتكتبه النافذة عن
/// نفسها. الهويّة هنا المقبض، ومعرّف العملية، ووقت إنشائها (يكشف إعادة استعمال
/// المعرّف)، ومسار ملفّها التنفيذي، وخيطها.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowIdentity {
    pub hwnd: u64,
    pub pid: u32,
    /// وقت إنشاء العملية بوحدات 100 نانوثانية منذ 1601 (FILETIME). صفر يعني «تعذّرت القراءة»،
    /// وهويّة بلا وقت إنشاء لا تُقبل هدفًا.
    pub process_created_at: u64,
    pub executable: String,
    pub thread_id: u32,
    pub class_name: String,
}

impl WindowIdentity {
    /// تطابق تامّ: المقبض والعملية ووقت إنشائها والملف التنفيذي. معرّف عملية مُعاد
    /// استعماله يحمل وقت إنشاء آخر، فلا يطابق.
    pub fn same_as(&self, other: &WindowIdentity) -> bool {
        self.hwnd == other.hwnd
            && self.pid == other.pid
            && self.process_created_at == other.process_created_at
            && self.executable.eq_ignore_ascii_case(&other.executable)
    }

    pub fn is_complete(&self) -> bool {
        self.hwnd != 0 && self.pid != 0 && self.process_created_at != 0 && !self.executable.is_empty()
    }

    pub fn executable_name(&self) -> String {
        self.executable.rsplit(['\\', '/']).next().unwrap_or("").to_string()
    }

    pub fn key(&self) -> String {
        format!("{:x}:{}:{}", self.hwnd, self.pid, self.process_created_at)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn width(&self) -> i32 {
        (self.right - self.left).max(0)
    }

    pub fn height(&self) -> i32 {
        (self.bottom - self.top).max(0)
    }

    pub fn center(&self) -> (i32, i32) {
        (self.left + self.width() / 2, self.top + self.height() / 2)
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
}

/// نافذة كما يراها الجرد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowInfo {
    pub identity: WindowIdentity,
    pub title: String,
    pub rect: Rect,
    pub visible: bool,
    pub minimized: bool,
}

/// دور عنصر داخل النافذة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ElementRole {
    Button,
    Edit,
    Text,
    CheckBox,
    ComboBox,
    List,
    Other,
}

impl ElementRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Button => "BUTTON",
            Self::Edit => "EDIT",
            Self::Text => "TEXT",
            Self::CheckBox => "CHECKBOX",
            Self::ComboBox => "COMBOBOX",
            Self::List => "LIST",
            Self::Other => "OTHER",
        }
    }
}

/// عنصر داخل النافذة (نافذة فرعية في Win32). نصّه محتوى شاشة غير موثوق.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UiElement {
    pub handle: u64,
    pub role: ElementRole,
    pub class_name: String,
    pub text: String,
    /// بإحداثيات الشاشة.
    pub rect: Rect,
    pub enabled: bool,
    pub visible: bool,
    /// حقل كلمة مرور (ES_PASSWORD أو محرف إخفاء). لا يُكتب فيه، ولا يُقرأ نصّه.
    pub password: bool,
    pub focused: bool,
}

/// لقطة نافذة واحدة. البكسلات لا تغادر المنفذ: بصمتها وأبعادها وحدها.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pixel_digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Left,
    Right,
}

/// مفتاح أو تركيبة من قائمة مغلقة. لا رموز افتراضية حرّة.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyChord {
    Enter,
    Tab,
    ShiftTab,
    Escape,
    Backspace,
    Delete,
    Space,
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    PageUp,
    PageDown,
    SelectAll,
}

impl KeyChord {
    pub fn parse(code: &str) -> Option<Self> {
        Some(match code {
            "Enter" => Self::Enter,
            "Tab" => Self::Tab,
            "Shift+Tab" => Self::ShiftTab,
            "Escape" => Self::Escape,
            "Backspace" => Self::Backspace,
            "Delete" => Self::Delete,
            "Space" => Self::Space,
            "Up" => Self::Up,
            "Down" => Self::Down,
            "Left" => Self::Left,
            "Right" => Self::Right,
            "Home" => Self::Home,
            "End" => Self::End,
            "PageUp" => Self::PageUp,
            "PageDown" => Self::PageDown,
            "Ctrl+A" => Self::SelectAll,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Enter => "Enter",
            Self::Tab => "Tab",
            Self::ShiftTab => "Shift+Tab",
            Self::Escape => "Escape",
            Self::Backspace => "Backspace",
            Self::Delete => "Delete",
            Self::Space => "Space",
            Self::Up => "Up",
            Self::Down => "Down",
            Self::Left => "Left",
            Self::Right => "Right",
            Self::Home => "Home",
            Self::End => "End",
            Self::PageUp => "PageUp",
            Self::PageDown => "PageDown",
            Self::SelectAll => "Ctrl+A",
        }
    }

    /// مفتاح يفعّل العنصر المركَّز (زرّ افتراضي، أو زرّ مركَّز). خطره خطر ذلك العنصر.
    pub fn activates(self) -> bool {
        matches!(self, Self::Enter | Self::Space)
    }
}

/// خطأ المنفذ. مغلق.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesktopError {
    /// لا منفذ سطح مكتب على هذه المنصّة أو في هذا البناء.
    Unavailable(String),
    WindowGone,
    /// النافذة لم تصر في المقدّمة. لا إدخال يُرسل إلى نافذة لا نعرف أنها المستقبِلة.
    NotForeground,
    /// النقطة تقع على نافذة أخرى تغطّي الهدف.
    Obscured,
    Failed(String),
}

impl DesktopError {
    pub fn describe(&self) -> String {
        match self {
            Self::Unavailable(d) => format!("desktop control is unavailable: {d}"),
            Self::WindowGone => "the target window no longer exists".into(),
            Self::NotForeground => "the target window could not be brought to the foreground, so no input was sent".into(),
            Self::Obscured => "another window covers the target point, so no input was sent".into(),
            Self::Failed(d) => d.clone(),
        }
    }
}

/// المنفذ. كل فعل إدخال يحدث في النافذة المسمّاة أو لا يحدث.
pub trait DesktopPort: Send + Sync {
    fn available(&self) -> bool;
    fn list_windows(&self) -> Result<Vec<WindowInfo>, DesktopError>;
    fn window(&self, hwnd: u64) -> Result<WindowInfo, DesktopError>;
    fn elements(&self, hwnd: u64) -> Result<Vec<UiElement>, DesktopError>;
    fn capture(&self, hwnd: u64) -> Result<Frame, DesktopError>;
    fn focus(&self, hwnd: u64) -> Result<(), DesktopError>;
    fn foreground(&self) -> Result<Option<u64>, DesktopError>;
    /// النافذة العليا (الجذر) الواقعة تحت نقطة شاشة.
    fn root_window_at(&self, x: i32, y: i32) -> Result<Option<u64>, DesktopError>;
    fn pointer_move(&self, x: i32, y: i32) -> Result<(), DesktopError>;
    fn click(&self, x: i32, y: i32, button: MouseButton) -> Result<(), DesktopError>;
    fn key(&self, chord: KeyChord) -> Result<(), DesktopError>;
    fn type_text(&self, text: &str) -> Result<(), DesktopError>;
    fn scroll(&self, x: i32, y: i32, notches: i32) -> Result<(), DesktopError>;
}

/// منفذ غائب: كل نداء «غير متاح». هو المنفذ الافتراضي خارج Windows وفي الاختبار.
pub struct UnavailableDesktop(pub &'static str);

impl DesktopPort for UnavailableDesktop {
    fn available(&self) -> bool {
        false
    }
    fn list_windows(&self) -> Result<Vec<WindowInfo>, DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
    fn window(&self, _: u64) -> Result<WindowInfo, DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
    fn elements(&self, _: u64) -> Result<Vec<UiElement>, DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
    fn capture(&self, _: u64) -> Result<Frame, DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
    fn focus(&self, _: u64) -> Result<(), DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
    fn foreground(&self) -> Result<Option<u64>, DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
    fn root_window_at(&self, _: i32, _: i32) -> Result<Option<u64>, DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
    fn pointer_move(&self, _: i32, _: i32) -> Result<(), DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
    fn click(&self, _: i32, _: i32, _: MouseButton) -> Result<(), DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
    fn key(&self, _: KeyChord) -> Result<(), DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
    fn type_text(&self, _: &str) -> Result<(), DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
    fn scroll(&self, _: i32, _: i32, _: i32) -> Result<(), DesktopError> {
        Err(DesktopError::Unavailable(self.0.into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(pid: u32, created: u64) -> WindowIdentity {
        WindowIdentity { hwnd: 0x10, pid, process_created_at: created, executable: "C:\\x\\fixture.exe".into(), thread_id: 1, class_name: "W".into() }
    }

    #[test]
    fn a_reused_process_id_is_not_the_same_window() {
        let original = identity(4242, 1000);
        let reused = identity(4242, 2000);
        assert!(!original.same_as(&reused), "PID reuse was mistaken for the same process");
        assert!(original.same_as(&identity(4242, 1000)));
    }

    #[test]
    fn an_identity_without_a_creation_time_is_incomplete() {
        assert!(!identity(1, 0).is_complete());
        assert!(identity(1, 5).is_complete());
    }

    #[test]
    fn keys_come_from_a_closed_list() {
        assert!(KeyChord::parse("Alt+F4").is_none());
        assert!(KeyChord::parse("Win+R").is_none());
        assert!(KeyChord::parse("Ctrl+V").is_none(), "paste would type whatever the clipboard holds");
        assert_eq!(KeyChord::parse("Enter"), Some(KeyChord::Enter));
    }
}
