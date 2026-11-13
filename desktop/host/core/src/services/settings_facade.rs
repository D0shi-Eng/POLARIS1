// واجهة الإعدادات: تصف وتقرأ، ولا تحلّ.
//
// القيم تأتي من وراء `SettingsResolver`. لا حساب هنا ولا قاعدة عمل في الواجهة،
// وفي Phase-02 يُستبدل المُحقِّق المحلي بمحوّل إلى مُحلِّل `runtime` الموثوق دون أن
// يتغيّر هذا الملف. هذا هو الفرق بين «عميل للمُحلِّل» و«مُحلِّل ثانٍ».

use serde_json::{json, Value};

use crate::ipc::errors::HostError;
use crate::model::settings::{ResolvedSetting, SettingMode};
use crate::settings::catalogue;
use crate::settings::resolver::{ResolvedValue, SettingsResolver};
use crate::SETTINGS_SCHEMA_VERSION;

pub struct SettingsFacade {
    resolver: Box<dyn SettingsResolver>,
}

impl SettingsFacade {
    pub fn new(resolver: Box<dyn SettingsResolver>) -> Self {
        Self { resolver }
    }

    /// `desktop.settings.describe` — بنية وأوضاع فقط. لا قيمة تظهر هنا إطلاقًا.
    pub fn describe(&self, payload: &Value) -> Result<Value, HostError> {
        let filter: Option<Vec<String>> = payload
            .get("section_ids")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect());

        if let Some(ids) = filter.as_ref() {
            if let Some(unknown) = ids.iter().find(|id| catalogue::section(id).is_none()) {
                // قسم غير معروف ليس خطأ داخليًا ولا شاشة فارغة: هو طلب لا يستطيع
                // المضيف الإجابة عنه، ويُصنَّف كذلك.
                return Err(HostError::feature_not_available(format!("unknown settings section {unknown}"))
                    .at("/payload/section_ids"));
            }
        }

        Ok(json!({
            "settings_schema_version": SETTINGS_SCHEMA_VERSION,
            "sections": catalogue::sections(filter.as_deref()),
        }))
    }

    /// `desktop.settings.read` — قسم واحد مُسمّى. قراءة تمتد عبر الأقسام غير قابلة
    /// للتعبير، فلا يمكن لطلب واحد أن يصير تفريغًا كاملًا للإعدادات.
    pub fn read(&self, payload: &Value) -> Result<Value, HostError> {
        let section_id = payload
            .get("section_id")
            .and_then(Value::as_str)
            .ok_or_else(|| HostError::validation("section_id is absent").at("/payload/section_id"))?;

        let section = catalogue::section(section_id).ok_or_else(|| {
            HostError::feature_not_available(format!("unknown settings section {section_id}"))
                .at("/payload/section_id")
        })?;

        let wanted: Option<Vec<&str>> = payload
            .get("setting_ids")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).collect());

        let settings: Vec<ResolvedSetting> = section
            .settings
            .iter()
            .filter(|spec| wanted.as_ref().is_none_or(|ids| ids.contains(&spec.id)))
            .map(|spec| {
                let resolved = self.resolver.resolve(section.id, spec.id);
                let (value, withheld) = match resolved {
                    ResolvedValue::Value(v) => (Some(v), None),
                    ResolvedValue::Withheld => (None, Some(true)),
                    ResolvedValue::Absent => (None, None),
                };
                ResolvedSetting {
                    setting_id: spec.id.to_string(),
                    mode: spec.mode,
                    value,
                    availability_reason: if spec.mode == SettingMode::Active { None } else { spec.reason },
                    value_withheld: withheld,
                }
            })
            .collect();

        Ok(json!({ "section_id": section_id, "settings": settings }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::bootstrap::{Appearance, Locale};
    use crate::settings::resolver::{HostFacts, HostLocalSettingsResolver};

    fn facade() -> SettingsFacade {
        SettingsFacade::new(Box::new(HostLocalSettingsResolver::new(HostFacts::phase_01(
            Locale::Ar,
            Appearance::Dark,
        ))))
    }

    #[test]
    fn describe_returns_the_whole_catalogue_when_unfiltered() {
        let result = facade().describe(&json!({})).unwrap();
        assert_eq!(result["sections"].as_array().unwrap().len(), 31);
        assert_eq!(result["settings_schema_version"], "1.0");
    }

    #[test]
    fn describe_honours_a_section_filter() {
        let result = facade()
            .describe(&json!({ "section_ids": ["general.appearance"] }))
            .unwrap();
        assert_eq!(result["sections"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn describe_refuses_an_unknown_section_rather_than_returning_nothing() {
        let error = facade().describe(&json!({ "section_ids": ["nope"] })).unwrap_err();
        assert_eq!(error.category.as_str(), "FEATURE_NOT_AVAILABLE");
    }

    #[test]
    fn read_returns_real_values_for_observable_settings() {
        let result = facade().read(&json!({ "section_id": "general.language-region" })).unwrap();
        let settings = result["settings"].as_array().unwrap();
        let locale = settings.iter().find(|s| s["setting_id"] == "locale").unwrap();
        assert_eq!(locale["value"]["code_value"], "ar");
        assert_eq!(locale["mode"], "READ_ONLY");
    }

    #[test]
    fn read_omits_the_value_when_there_is_none_instead_of_inventing_one() {
        let result = facade().read(&json!({ "section_id": "data.memory" })).unwrap();
        for setting in result["settings"].as_array().unwrap() {
            assert!(setting.get("value").is_none(), "an absent value was filled in");
            assert!(setting["availability_reason"].is_string());
        }
    }

    #[test]
    fn a_read_cannot_span_sections() {
        // لا يوجد شكل طلب يقبل أكثر من قسم واحد؛ الحقل مفرد في العقد.
        let result = facade().read(&json!({ "section_id": "general.appearance" })).unwrap();
        assert_eq!(result["section_id"], "general.appearance");
    }
}
