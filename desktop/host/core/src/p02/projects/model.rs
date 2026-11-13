// سجل المشروع.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProjectStatus {
    Active,
    Archived,
}

/// اللغات التسع المعمارية.
pub const LANGUAGES: [&str; 9] = ["ar", "en", "de", "fr", "ru", "zh", "ko", "ja", "es"];

#[derive(Debug, Clone, Serialize)]
pub struct Project {
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub status: ProjectStatus,
    pub language: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model_id: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub context_source_count: i64,
}

pub fn status_code(status: ProjectStatus) -> &'static str {
    match status {
        ProjectStatus::Active => "ACTIVE",
        ProjectStatus::Archived => "ARCHIVED",
    }
}

pub fn parse_status(code: &str) -> ProjectStatus {
    if code == "ARCHIVED" { ProjectStatus::Archived } else { ProjectStatus::Active }
}

/// اسم نظيف: بلا محارف تحكّم، ومقصوص الأطراف، وبطول مقبول.
pub fn clean_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let ok = !trimmed.is_empty() && trimmed.chars().count() <= 120 && !trimmed.chars().any(char::is_control);
    ok.then(|| trimmed.to_string())
}

pub fn clean_description(raw: &str) -> Option<String> {
    let ok = raw.chars().count() <= 2000 && !raw.chars().any(|c| c.is_control() && c != '\n' && c != '\t');
    // العقد يرفض محارف التحكّم كلها؛ الأسطر الجديدة تُستبدل بمسافات قبل الحفظ.
    ok.then(|| raw.replace(['\n', '\t'], " ").trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_cleaned_or_refused() {
        assert_eq!(clean_name("  مشروع  ").as_deref(), Some("مشروع"));
        assert_eq!(clean_name("   "), None);
        assert_eq!(clean_name("a\u{7}b"), None);
        assert_eq!(clean_name(&"x".repeat(121)), None);
    }
}
