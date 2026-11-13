// محلِّل الإعدادات الفعلية: الافتراضي، ثم المستخدم، ثم المشروع، ثم المهمّة، ثم حدّ الأمان.
//
// الحلّ دالّة نقية فوق التعريفات والصفوف المحفوظة، فيُختبر كما هو. قاعدتان لا
// تُفاوَض عليهما:
//   ١ — طبقة أدنى (مشروع أو مهمّة) لا توسّع إعدادًا يحمل أمنًا عمّا فوقها. قيمة كهذه
//       تُرفض عند الكتابة، وإن وُجدت في المخزن بأي طريق تُتجاهل عند الحلّ ويُعلن تجاهلها.
//   ٢ — حدّ الأمان هو الأضيق من سقف البناء وقيمة طبقة الأمان، ويُطبَّق أخيرًا على كل شيء.

use serde::Serialize;
use serde_json::Value;

use super::model::{Layer, SettingDef, SettingState, SettingValue, ValueSource};
use super::store::StoredValue;

/// نطاق الحلّ: مشروع ومهمّة اختياريان. مهمّة بلا مشروعها تُحلّ بلا طبقة مشروع.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConfigScope {
    pub project_id: Option<String>,
    pub mission_id: Option<String>,
}

impl ConfigScope {
    pub fn global() -> Self {
        Self::default()
    }

    pub fn project(project_id: impl Into<String>) -> Self {
        Self { project_id: Some(project_id.into()), mission_id: None }
    }

    pub fn mission(mission_id: impl Into<String>, project_id: Option<String>) -> Self {
        Self { project_id, mission_id: Some(mission_id.into()) }
    }
}

/// قيمة واحدة محلولة، بمصدرها.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedValue {
    pub key: &'static str,
    pub value: SettingValue,
    pub source: ValueSource,
    /// هل قصّ حدّ الأمان القيمة؟
    pub clamped: bool,
    /// طبقات حُفظت لها قيمة للإعداد في هذا النطاق.
    pub present: Vec<Layer>,
    /// طبقات حاولت أن توسّع إعدادًا يحمل أمنًا فتُجوهلت.
    pub ignored: Vec<Layer>,
    /// الحدّ الفعلي، إن كان للإعداد حدّ.
    pub clamp: Option<SettingValue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedValueView {
    pub key: &'static str,
    pub value: Value,
    pub source: &'static str,
    pub clamped: bool,
    pub present_layers: Vec<&'static str>,
    pub ignored_layers: Vec<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clamp: Option<Value>,
}

impl ResolvedValue {
    pub fn view(&self) -> ResolvedValueView {
        ResolvedValueView {
            key: self.key,
            value: self.value.to_json(),
            source: self.source.as_str(),
            clamped: self.clamped,
            present_layers: self.present.iter().map(|l| l.as_str()).collect(),
            ignored_layers: self.ignored.iter().map(|l| l.as_str()).collect(),
            clamp: self.clamp.as_ref().map(SettingValue::to_json),
        }
    }
}

fn lookup<'a>(stored: &'a [StoredValue], layer: Layer, scope_id: &str, key: &str) -> Option<&'a StoredValue> {
    stored.iter().find(|s| s.layer == layer && s.scope_id == scope_id && s.key == key)
}

/// قيمة محفوظة صالحة لتعريفها، أو لا شيء. قيمة تالفة لا تُحلّ ولا تُسقط الحلّ.
fn valid(def: &SettingDef, stored: Option<&StoredValue>, layer: Layer) -> Option<SettingValue> {
    let stored = stored?;
    if !def.layers.contains(&layer) || def.state != SettingState::Editable {
        return None;
    }
    def.parse(&stored.value).ok()
}

/// الأضيق من قيمتين تحت اتجاه توسيع.
fn narrower(def: &SettingDef, a: Option<SettingValue>, b: Option<SettingValue>) -> Option<SettingValue> {
    let widening = def.widening?;
    match (a, b) {
        (Some(a), Some(b)) => Some(if widening.is_wider(&a, &b) { b } else { a }),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

/// الحدّ الفعلي لإعداد: سقف البناء، مضيَّقًا بكل حدّ أمان ضُبط له.
///
/// Phase-07: قد يحمل الإعداد حدّين في طبقة الأمان — قيمة صاحب الجهاز وقيمة السياسة
/// المُدارة — فيُطوى الأضيق من الجميع. بصفّ واحد النتيجة هي نفسها قبل التعديل.
pub fn clamp_of(def: &SettingDef, stored: &[StoredValue]) -> Option<SettingValue> {
    def.widening?;
    stored
        .iter()
        .filter(|s| s.layer == Layer::Security && s.scope_id.is_empty() && s.key == def.key)
        .fold(def.ceiling_value(), |limit, row| narrower(def, limit, valid(def, Some(row), Layer::Security)))
}

/// يحلّ إعدادًا واحدًا في نطاق.
pub fn resolve(def: &'static SettingDef, stored: &[StoredValue], scope: &ConfigScope) -> ResolvedValue {
    let mut present = Vec::new();
    let mut ignored = Vec::new();
    let mut value = def.default_value();
    let mut source = ValueSource::Default;

    if def.state == SettingState::Editable {
        let mut layered = vec![(Layer::User, String::new())];
        if let Some(project) = &scope.project_id {
            layered.push((Layer::Project, project.clone()));
        }
        if let Some(mission) = &scope.mission_id {
            layered.push((Layer::Mission, mission.clone()));
        }
        for (layer, scope_id) in layered {
            let raw = lookup(stored, layer, &scope_id, def.key);
            if raw.is_some() {
                present.push(layer);
            }
            let Some(candidate) = valid(def, raw, layer) else { continue };
            // القاعدة ١: المشروع والمهمّة لا يوسّعان ما يحمل أمنًا.
            if layer.scoped() {
                if let Some(widening) = def.widening {
                    if widening.is_wider(&candidate, &value) {
                        ignored.push(layer);
                        continue;
                    }
                }
            }
            value = candidate;
            source = ValueSource::of_layer(layer);
        }
    }
    if lookup(stored, Layer::Security, "", def.key).is_some() {
        present.push(Layer::Security);
    }

    // القاعدة ٢: حدّ الأمان أخيرًا، على كل مصدر بما فيه الافتراضي.
    let clamp = clamp_of(def, stored);
    let mut clamped = false;
    if let (Some(widening), Some(limit)) = (def.widening, clamp.as_ref()) {
        if widening.is_wider(&value, limit) {
            value = limit.clone();
            source = ValueSource::SecurityClamp;
            clamped = true;
        }
    }
    ResolvedValue { key: def.key, value, source, clamped, present, ignored, clamp }
}

/// القيمة الأمّ لطبقة: ما يُحلّ فوقها في النطاق نفسه. بها يُفحص توسيع طبقة أدنى عند الكتابة.
pub fn parent_value(def: &'static SettingDef, stored: &[StoredValue], layer: Layer, scope: &ConfigScope) -> SettingValue {
    let parent_scope = match layer {
        Layer::Mission => ConfigScope { project_id: scope.project_id.clone(), mission_id: None },
        Layer::Project => ConfigScope::global(),
        Layer::User | Layer::Security => ConfigScope::global(),
    };
    if layer == Layer::User || layer == Layer::Security {
        return def.default_value();
    }
    resolve(def, stored, &parent_scope).value
}

#[cfg(test)]
mod tests {
    use super::super::registry::find;
    use super::*;

    const PROJECT: &str = "11111111-1111-4111-8111-111111111111";
    const MISSION: &str = "22222222-2222-4222-8222-222222222222";

    fn row(layer: Layer, scope: &str, key: &str, value: Value) -> StoredValue {
        StoredValue { layer, scope_id: scope.into(), key: key.into(), value, updated_at: "t".into() }
    }

    #[test]
    fn layers_apply_in_order_and_each_value_names_its_source() {
        let def = find("agents.max_tool_calls_per_mission").unwrap();
        let stored = vec![
            row(Layer::User, "", def.key, Value::from(12)),
            row(Layer::Project, PROJECT, def.key, Value::from(10)),
            row(Layer::Mission, MISSION, def.key, Value::from(6)),
        ];
        assert_eq!(resolve(def, &[], &ConfigScope::global()).source, ValueSource::Default);
        let user = resolve(def, &stored, &ConfigScope::global());
        assert_eq!((user.value.as_i64(), user.source), (Some(12), ValueSource::User));
        let project = resolve(def, &stored, &ConfigScope::project(PROJECT));
        assert_eq!((project.value.as_i64(), project.source), (Some(10), ValueSource::Project));
        let mission = resolve(def, &stored, &ConfigScope::mission(MISSION, Some(PROJECT.into())));
        assert_eq!((mission.value.as_i64(), mission.source), (Some(6), ValueSource::Mission));
    }

    #[test]
    fn a_project_or_mission_value_that_widens_a_security_setting_is_ignored_and_reported() {
        let def = find("privacy.allow_connector_egress").unwrap();
        let stored = vec![
            row(Layer::User, "", def.key, Value::Bool(false)),
            // وصل إلى المخزن بطريق غير الكتابة المُتحقَّقة: الحلّ يرفضه أيضًا.
            row(Layer::Project, PROJECT, def.key, Value::Bool(true)),
            row(Layer::Mission, MISSION, def.key, Value::Bool(true)),
        ];
        let resolved = resolve(def, &stored, &ConfigScope::mission(MISSION, Some(PROJECT.into())));
        assert_eq!(resolved.value, SettingValue::Boolean(false));
        assert_eq!(resolved.source, ValueSource::User);
        assert_eq!(resolved.ignored, vec![Layer::Project, Layer::Mission]);
    }

    #[test]
    fn the_security_clamp_narrows_every_source_including_the_default() {
        let def = find("connectors.max_external_calls_per_mission").unwrap();
        let stored = vec![row(Layer::Security, "", def.key, Value::from(3)), row(Layer::User, "", def.key, Value::from(50))];
        let resolved = resolve(def, &stored, &ConfigScope::global());
        assert_eq!(resolved.value.as_i64(), Some(3));
        assert_eq!(resolved.source, ValueSource::SecurityClamp);
        assert!(resolved.clamped);
        // بلا قيمة مستخدم، الافتراضي (20) يُقصّ أيضًا.
        let only_clamp = vec![row(Layer::Security, "", def.key, Value::from(3))];
        assert_eq!(resolve(def, &only_clamp, &ConfigScope::global()).value.as_i64(), Some(3));
    }

    #[test]
    fn a_security_layer_value_cannot_raise_the_build_ceiling() {
        let def = find("agents.max_concurrent_missions").unwrap();
        let stored = vec![row(Layer::Security, "", def.key, Value::from(8)), row(Layer::User, "", def.key, Value::from(8))];
        assert_eq!(resolve(def, &stored, &ConfigScope::global()).value.as_i64(), Some(8));
        // قيمة تالفة فوق السقف لا تُقرأ أصلًا (حدود التعريف)، فيبقى السقف.
        let above = vec![row(Layer::Security, "", def.key, Value::from(99)), row(Layer::User, "", def.key, Value::from(99))];
        let resolved = resolve(def, &above, &ConfigScope::global());
        assert!(resolved.value.as_i64().unwrap() <= 8);
    }

    #[test]
    fn a_locked_setting_ignores_every_stored_value() {
        let def = find("browser.private_network_allowed").unwrap();
        let stored = vec![row(Layer::User, "", def.key, Value::Bool(true)), row(Layer::Security, "", def.key, Value::Bool(true))];
        let resolved = resolve(def, &stored, &ConfigScope::global());
        assert_eq!(resolved.value, SettingValue::Boolean(false));
    }

    #[test]
    fn a_corrupt_stored_value_is_not_resolved_and_does_not_break_resolution() {
        let def = find("observability.event_retention").unwrap();
        let stored = vec![row(Layer::User, "", def.key, Value::String("lots".into()))];
        let resolved = resolve(def, &stored, &ConfigScope::global());
        assert_eq!(resolved.source, ValueSource::Default);
        assert_eq!(resolved.present, vec![Layer::User]);
    }

    #[test]
    fn a_restrictive_boolean_widens_when_turned_off() {
        // لا إعداد مقيّد قابل للكتابة في كل الطبقات في الكتالوج الآن (حُذف «محلي فقط»، ADR-040)؛ القاعدة نفسها تُختبر
        // على تعريف يحملها.
        let mut restrictive = find("privacy.persist_memory").unwrap().clone();
        restrictive.widening = Some(super::super::model::Widening::FalseIsWider);
        restrictive.default = super::super::model::DefaultValue::Boolean(false);
        let def: &'static SettingDef = Box::leak(Box::new(restrictive));
        let stored = vec![row(Layer::User, "", def.key, Value::Bool(true)), row(Layer::Project, PROJECT, def.key, Value::Bool(false))];
        let resolved = resolve(def, &stored, &ConfigScope::project(PROJECT));
        assert_eq!(resolved.value, SettingValue::Boolean(true), "a project turned a restrictive setting off");
        assert_eq!(resolved.ignored, vec![Layer::Project]);
    }
}
