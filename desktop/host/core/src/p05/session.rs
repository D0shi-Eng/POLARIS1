// حالة الجلسة وميزانية الأفعال: مشتركتان بين جلسة المتصفّح وجلسة سطح المكتب.
//
// الجلسة مربوطة بمهمّة واحدة (البند 17/29): لا جلسة بلا مهمّة، ولا إعادة استعمال
// لجلسة مهمّة في مهمّة أخرى. والميزانية تُحجز قبل الأثر لا تُحسب بعده (البند 37).

use serde::Serialize;

/// حالة الجلسة. مغلقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SessionState {
    Created,
    Active,
    /// المهمّة تنتظر قرارًا بشريًّا. الجلسة قائمة ولا فعل فيها حتى يُستأنف.
    Waiting,
    Closed,
    Failed,
    Cancelled,
}

impl SessionState {
    pub const ALL: [SessionState; 6] = [Self::Created, Self::Active, Self::Waiting, Self::Closed, Self::Failed, Self::Cancelled];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "CREATED",
            Self::Active => "ACTIVE",
            Self::Waiting => "WAITING",
            Self::Closed => "CLOSED",
            Self::Failed => "FAILED",
            Self::Cancelled => "CANCELLED",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.as_str() == code)
    }

    /// هل انتهت الجلسة؟ لا فعل جديد في جلسة منتهية.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Closed | Self::Failed | Self::Cancelled)
    }

    /// الانتقالات المسموحة. أي انتقال آخر يُرفض بدل أن يُكتب.
    pub fn can_transition_to(self, next: SessionState) -> bool {
        use SessionState::*;
        match (self, next) {
            (a, b) if a == b => true,
            (Created, Active | Waiting | Closed | Failed | Cancelled) => true,
            (Active, Waiting | Closed | Failed | Cancelled) => true,
            (Waiting, Active | Closed | Failed | Cancelled) => true,
            _ => false,
        }
    }
}

/// ميزانية أفعال Phase-05 لمهمّة واحدة. ثابتة من زمن التشغيل، لا يرفعها نموذج.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ActionBudget {
    pub max_browser_navigations: u32,
    pub max_browser_actions: u32,
    pub max_browser_downloads: u32,
    pub max_browser_uploads: u32,
    pub max_computer_actions: u32,
    pub max_clicks: u32,
    pub max_keyboard_events: u32,
    pub max_screen_captures: u32,
}

impl Default for ActionBudget {
    fn default() -> Self {
        Self {
            max_browser_navigations: 20,
            max_browser_actions: 60,
            max_browser_downloads: 5,
            max_browser_uploads: 3,
            max_computer_actions: 60,
            max_clicks: 30,
            max_keyboard_events: 600,
            max_screen_captures: 30,
        }
    }
}

/// بُعد الميزانية الذي نفد.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetDimension {
    BrowserNavigations,
    BrowserActions,
    BrowserDownloads,
    BrowserUploads,
    ComputerActions,
    Clicks,
    KeyboardEvents,
    ScreenCaptures,
}

impl BudgetDimension {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BrowserNavigations => "max_browser_navigations",
            Self::BrowserActions => "max_browser_actions",
            Self::BrowserDownloads => "max_browser_downloads",
            Self::BrowserUploads => "max_browser_uploads",
            Self::ComputerActions => "max_computer_actions",
            Self::Clicks => "max_clicks",
            Self::KeyboardEvents => "max_keyboard_events",
            Self::ScreenCaptures => "max_screen_captures",
        }
    }
}

/// يحجز وحدات من عدّاد إن بقي في حدّه متّسع لها، وإلا يرفض دون أن يلمس العدّاد.
pub fn reserve(used: &mut u32, amount: u32, limit: u32, dimension: BudgetDimension) -> Result<(), BudgetDimension> {
    if used.saturating_add(amount) > limit {
        return Err(dimension);
    }
    *used += amount;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_terminal_session_cannot_come_back() {
        for terminal in [SessionState::Closed, SessionState::Failed, SessionState::Cancelled] {
            assert!(terminal.is_terminal());
            assert!(!terminal.can_transition_to(SessionState::Active), "{} came back", terminal.as_str());
        }
        assert!(SessionState::Waiting.can_transition_to(SessionState::Active));
        assert!(SessionState::Created.can_transition_to(SessionState::Cancelled));
    }

    #[test]
    fn a_reservation_is_all_or_nothing() {
        let mut used = 9;
        assert_eq!(reserve(&mut used, 2, 10, BudgetDimension::Clicks), Err(BudgetDimension::Clicks));
        assert_eq!(used, 9, "a refused reservation spent budget");
        assert!(reserve(&mut used, 1, 10, BudgetDimension::Clicks).is_ok());
        assert_eq!(used, 10);
    }
}
