// أنواع السياق: نوع المصدر، وصنف الثقة، وصنف المحتوى، والإتاحة.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceType {
    WorkspaceRoot,
    File,
    Folder,
    TextNote,
    SystemContext,
    UserInstruction,
}

/// صنف الثقة. الإذن بقراءة ملف لا يجعل محتواه تعليمة موثوقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TrustClass {
    DirectUserInstruction,
    UserAuthorizedResource,
    UntrustedContent,
    SystemGenerated,
    ModelGenerated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContentClass {
    SourceCode,
    Documentation,
    Configuration,
    Data,
    Image,
    Audio,
    Binary,
    Unknown,
}

impl ContentClass {
    /// الأصناف التي تُقرأ نصًّا. ما عداها لا يُفسَّر نصًّا أبدًا.
    pub fn is_text(self) -> bool {
        matches!(self, Self::SourceCode | Self::Documentation | Self::Configuration | Self::Data)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceAvailability {
    Available,
    Missing,
    Changed,
    OutOfScope,
    NotReadable,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContextSource {
    pub source_id: String,
    pub project_id: String,
    pub source_type: SourceType,
    pub reference: String,
    pub display_name: String,
    pub trust_class: TrustClass,
    pub content_class: ContentClass,
    pub added_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<String>,
    pub availability: SourceAvailability,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_count: Option<u64>,
    /// نصّ الملاحظة أو التعليمة. يبقى في المضيف ولا يُسلسَل في العرض.
    #[serde(skip)]
    pub text_body: Option<String>,
}

pub fn code<T: Serialize>(value: T) -> String {
    serde_json::to_value(value).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

pub fn parse<T: for<'de> Deserialize<'de>>(code: &str, fallback: T) -> T {
    serde_json::from_value(serde_json::Value::String(code.to_string())).unwrap_or(fallback)
}

/// صنف ثقة المصدر حسب نوعه. يقرّره المضيف لا الطلب.
pub fn trust_for(source_type: SourceType) -> TrustClass {
    match source_type {
        SourceType::UserInstruction => TrustClass::DirectUserInstruction,
        SourceType::SystemContext => TrustClass::SystemGenerated,
        SourceType::WorkspaceRoot | SourceType::File | SourceType::Folder | SourceType::TextNote => TrustClass::UserAuthorizedResource,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_user_instruction_is_a_direct_instruction() {
        for t in [SourceType::File, SourceType::Folder, SourceType::TextNote, SourceType::WorkspaceRoot] {
            assert_eq!(trust_for(t), TrustClass::UserAuthorizedResource);
        }
        assert_eq!(trust_for(SourceType::UserInstruction), TrustClass::DirectUserInstruction);
    }

    #[test]
    fn codes_round_trip() {
        assert_eq!(code(SourceType::WorkspaceRoot), "WORKSPACE_ROOT");
        assert_eq!(parse("OUT_OF_SCOPE", SourceAvailability::Unknown), SourceAvailability::OutOfScope);
        assert_eq!(parse("bogus", SourceAvailability::Unknown), SourceAvailability::Unknown);
    }
}
