// أنواع مستوى التحكّم في الإعدادات: الإعداد مُصنَّف، وقيمته مُصنَّفة، ومصدرها معلَن.
//
// القاعدة (البند 38): لا كتلة JSON حرّة. كل إعداد نوعه واحد من ثمانية، وحدوده في
// تعريفه، وقيمته تُتحقق قبل أن تُحفظ وبعد أن تُقرأ. والمصدر (البند 37) جزء من القيمة
// المحلولة لا تعليق عليها: الواجهة تعرض من أين جاءت كل قيمة مهمّة.

use serde::Serialize;
use serde_json::Value;

/// أنواع الإعدادات. مغلقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SettingKind {
    Boolean,
    Integer,
    /// عدد عشري دقيق، يُحفظ نصًّا ويُحلّ إلى أجزاء المليون. لا عائم ثنائي في مال.
    Decimal,
    Enum,
    String,
    /// مدّة بالميلي ثانية.
    Duration,
    /// حجم بالبايت.
    Bytes,
    List,
}

impl SettingKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Boolean => "BOOLEAN",
            Self::Integer => "INTEGER",
            Self::Decimal => "DECIMAL",
            Self::Enum => "ENUM",
            Self::String => "STRING",
            Self::Duration => "DURATION",
            Self::Bytes => "BYTES",
            Self::List => "LIST",
        }
    }
}

/// أقسام الإعدادات التسعة عشر (البند 35). مغلقة وبترتيب العرض.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Section {
    General,
    Appearance,
    Language,
    Models,
    Providers,
    Agents,
    Skills,
    Tools,
    Mcp,
    Memory,
    Browser,
    Computer,
    Connectors,
    Privacy,
    Security,
    Budgets,
    Cost,
    Observability,
    Advanced,
}

impl Section {
    pub const ALL: [Section; 19] = [
        Self::General,
        Self::Appearance,
        Self::Language,
        Self::Models,
        Self::Providers,
        Self::Agents,
        Self::Skills,
        Self::Tools,
        Self::Mcp,
        Self::Memory,
        Self::Browser,
        Self::Computer,
        Self::Connectors,
        Self::Privacy,
        Self::Security,
        Self::Budgets,
        Self::Cost,
        Self::Observability,
        Self::Advanced,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::General => "GENERAL",
            Self::Appearance => "APPEARANCE",
            Self::Language => "LANGUAGE",
            Self::Models => "MODELS",
            Self::Providers => "PROVIDERS",
            Self::Agents => "AGENTS",
            Self::Skills => "SKILLS",
            Self::Tools => "TOOLS",
            Self::Mcp => "MCP",
            Self::Memory => "MEMORY",
            Self::Browser => "BROWSER",
            Self::Computer => "COMPUTER",
            Self::Connectors => "CONNECTORS",
            Self::Privacy => "PRIVACY",
            Self::Security => "SECURITY",
            Self::Budgets => "BUDGETS",
            Self::Cost => "COST",
            Self::Observability => "OBSERVABILITY",
            Self::Advanced => "ADVANCED",
        }
    }
}

/// الطبقات التي تُكتب. `DEFAULT` في الشيفرة لا في المخزن، ولا تُكتب.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Layer {
    User,
    Project,
    Mission,
    /// حدود الأمان التي يضعها صاحب الجهاز. لا تُوسّع سقف البناء، وتُضيّق كل ما تحتها.
    Security,
}

impl Layer {
    pub const ALL: [Layer; 4] = [Self::User, Self::Project, Self::Mission, Self::Security];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "USER",
            Self::Project => "PROJECT",
            Self::Mission => "MISSION",
            Self::Security => "SECURITY",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|l| l.as_str() == code)
    }

    /// هل تحتاج الطبقة معرّف نطاق (مشروع أو مهمّة)؟
    pub fn scoped(self) -> bool {
        matches!(self, Self::Project | Self::Mission)
    }
}

/// مصدر القيمة المحلولة (البند 37).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValueSource {
    Default,
    User,
    Project,
    Mission,
    SecurityClamp,
}

impl ValueSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Default => "DEFAULT",
            Self::User => "USER",
            Self::Project => "PROJECT",
            Self::Mission => "MISSION",
            Self::SecurityClamp => "SECURITY_CLAMP",
        }
    }

    pub fn of_layer(layer: Layer) -> Self {
        match layer {
            Layer::User => Self::User,
            Layer::Project => Self::Project,
            Layer::Mission => Self::Mission,
            Layer::Security => Self::SecurityClamp,
        }
    }
}

/// قيمة مُصنَّفة. الشكل على الحدّ JSON بسيط بحسب النوع، ويُحلّ هنا إلى هذا التعداد.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingValue {
    Boolean(bool),
    Integer(i64),
    /// أجزاء المليون.
    Decimal(i64),
    Enum(String),
    Text(String),
    DurationMs(u64),
    Bytes(u64),
    List(Vec<String>),
}

impl SettingValue {
    pub fn kind(&self) -> SettingKind {
        match self {
            Self::Boolean(_) => SettingKind::Boolean,
            Self::Integer(_) => SettingKind::Integer,
            Self::Decimal(_) => SettingKind::Decimal,
            Self::Enum(_) => SettingKind::Enum,
            Self::Text(_) => SettingKind::String,
            Self::DurationMs(_) => SettingKind::Duration,
            Self::Bytes(_) => SettingKind::Bytes,
            Self::List(_) => SettingKind::List,
        }
    }

    /// الشكل على الحدّ وفي المخزن.
    pub fn to_json(&self) -> Value {
        match self {
            Self::Boolean(b) => Value::Bool(*b),
            Self::Integer(n) => Value::from(*n),
            Self::Decimal(micros) => Value::String(format_decimal(*micros)),
            Self::Enum(code) | Self::Text(code) => Value::String(code.clone()),
            Self::DurationMs(ms) | Self::Bytes(ms) => Value::from(*ms),
            Self::List(items) => Value::Array(items.iter().cloned().map(Value::String).collect()),
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Boolean(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Self::Integer(n) | Self::Decimal(n) => Some(*n),
            Self::DurationMs(n) | Self::Bytes(n) => i64::try_from(*n).ok(),
            _ => None,
        }
    }

    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Self::DurationMs(n) | Self::Bytes(n) => Some(*n),
            Self::Integer(n) | Self::Decimal(n) => u64::try_from(*n).ok(),
            _ => None,
        }
    }

    pub fn as_code(&self) -> Option<&str> {
        match self {
            Self::Enum(code) | Self::Text(code) => Some(code),
            _ => None,
        }
    }
}

/// يصوغ أجزاء المليون عددًا عشريًّا بلا أصفار زائدة: 12500000 ← "12.5".
pub fn format_decimal(micros: i64) -> String {
    let negative = micros < 0;
    let abs = micros.unsigned_abs();
    let whole = abs / 1_000_000;
    let fraction = abs % 1_000_000;
    let mut text = if fraction == 0 { whole.to_string() } else { format!("{whole}.{fraction:06}").trim_end_matches('0').to_string() };
    if negative {
        text.insert(0, '-');
    }
    text
}

/// يحلّ نصًّا عشريًّا إلى أجزاء المليون. لا أُسّ، ولا أكثر من ستّ خانات بعد الفاصلة.
pub fn parse_decimal(text: &str) -> Option<i64> {
    let text = text.trim();
    if text.is_empty() || text.len() > 24 {
        return None;
    }
    let (negative, body) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let (whole, fraction) = match body.split_once('.') {
        Some((w, f)) => (w, f),
        None => (body, ""),
    };
    if whole.is_empty() || !whole.chars().all(|c| c.is_ascii_digit()) || fraction.len() > 6 || !fraction.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let whole: i64 = whole.parse().ok()?;
    let padded = format!("{fraction:0<6}");
    let fraction: i64 = if padded.is_empty() { 0 } else { padded.parse().ok()? };
    let micros = whole.checked_mul(1_000_000)?.checked_add(fraction)?;
    Some(if negative { -micros } else { micros })
}

/// اتجاه التوسيع لإعداد يحمل أمنًا. ما لا يحمل أمنًا لا اتجاه له.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Widening {
    /// صحيح أوسع من خطأ (السماح بالنماذج البعيدة مثلًا).
    TrueIsWider,
    /// خطأ أوسع من صحيح (إيقاف «محلي فقط» يوسّع).
    FalseIsWider,
    /// الأكبر أوسع (حدود، أعداد، مدد، أحجام).
    LargerIsWider,
    /// ترتيب القيم من الأضيق إلى الأوسع.
    Ordered(&'static [&'static str]),
}

impl Widening {
    /// هل `candidate` أوسع من `reference`؟ نوعان مختلفان يُعاملان أوسع: الفشل مغلق.
    pub fn is_wider(self, candidate: &SettingValue, reference: &SettingValue) -> bool {
        match self {
            Self::TrueIsWider => matches!((candidate, reference), (SettingValue::Boolean(true), SettingValue::Boolean(false))) || candidate.kind() != reference.kind(),
            Self::FalseIsWider => matches!((candidate, reference), (SettingValue::Boolean(false), SettingValue::Boolean(true))) || candidate.kind() != reference.kind(),
            Self::LargerIsWider => match (candidate.as_i64(), reference.as_i64()) {
                (Some(a), Some(b)) => a > b,
                _ => true,
            },
            Self::Ordered(order) => {
                let rank = |v: &SettingValue| v.as_code().and_then(|c| order.iter().position(|o| *o == c));
                match (rank(candidate), rank(reference)) {
                    (Some(a), Some(b)) => a > b,
                    _ => true,
                }
            }
        }
    }
}

/// حدود قيمة إعداد. كل نوع يقرأ الحقل الذي يخصّه.
#[derive(Debug, Clone, Copy)]
pub struct Bounds {
    pub min: i64,
    pub max: i64,
    pub max_len: usize,
    pub allowed: &'static [&'static str],
    pub max_items: usize,
}

impl Bounds {
    pub const fn range(min: i64, max: i64) -> Self {
        Self { min, max, max_len: 0, allowed: &[], max_items: 0 }
    }

    pub const fn options(allowed: &'static [&'static str]) -> Self {
        Self { min: 0, max: 0, max_len: 0, allowed, max_items: 0 }
    }

    pub const fn text(max_len: usize) -> Self {
        Self { min: 0, max: 0, max_len, allowed: &[], max_items: 0 }
    }

    pub const fn list(max_items: usize, max_len: usize) -> Self {
        Self { min: 0, max: 0, max_len, allowed: &[], max_items }
    }

    pub const NONE: Bounds = Bounds { min: 0, max: 0, max_len: 0, allowed: &[], max_items: 0 };
}

/// متى يسري التغيير. يُعرض مع الإعداد فلا يُكتشف بالتجربة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Applies {
    /// عند النداء التالي الذي يقرأ الإعداد.
    NextOperation,
    /// عند بدء المهمّة التالية.
    NextMission,
    /// في العارض فورًا.
    Immediately,
}

/// حالة الإعداد في هذا البناء.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SettingState {
    Editable,
    /// قيمته مقفلة بسقف البناء. تُعرض ولا تُوسَّع.
    Locked,
    /// لمرحلة لاحقة. تُعرض بسببها ولا تحمل تحكّمًا.
    UnavailableThisPhase,
}

/// تعريف إعداد واحد. بيانات لا منطق: المستهلك يقرأ القيمة المحلولة لا التعريف.
#[derive(Debug, Clone)]
pub struct SettingDef {
    pub key: &'static str,
    pub section: Section,
    pub kind: SettingKind,
    pub default: DefaultValue,
    pub bounds: Bounds,
    /// الطبقات التي يجوز أن تكتبه. `SECURITY` تعني أن للإعداد حدًّا أمنيًّا قابلًا للضبط.
    pub layers: &'static [Layer],
    /// حامل أمن؟ الطبقات الأدنى لا توسّعه، وحدّ الأمان يُضيّقه.
    pub widening: Option<Widening>,
    /// سقف البناء: لا طبقة توسّعه، ولا حتى طبقة الأمان.
    pub ceiling: Option<DefaultValue>,
    pub applies: Applies,
    pub state: SettingState,
    /// أين يُقرأ الإعداد فعلًا. يُعرض ويُفحص: إعداد بلا مستهلك واجهة كاذبة.
    pub consumer: &'static str,
}

/// قيمة افتراضية ثابتة، تصلح لتعريف ساكن.
#[derive(Debug, Clone, Copy)]
pub enum DefaultValue {
    Boolean(bool),
    Integer(i64),
    Decimal(i64),
    Enum(&'static str),
    Text(&'static str),
    DurationMs(u64),
    Bytes(u64),
    List(&'static [&'static str]),
}

impl DefaultValue {
    pub fn value(self) -> SettingValue {
        match self {
            Self::Boolean(b) => SettingValue::Boolean(b),
            Self::Integer(n) => SettingValue::Integer(n),
            Self::Decimal(n) => SettingValue::Decimal(n),
            Self::Enum(code) => SettingValue::Enum(code.to_string()),
            Self::Text(text) => SettingValue::Text(text.to_string()),
            Self::DurationMs(ms) => SettingValue::DurationMs(ms),
            Self::Bytes(n) => SettingValue::Bytes(n),
            Self::List(items) => SettingValue::List(items.iter().map(|s| s.to_string()).collect()),
        }
    }
}

/// لماذا رُفضت قيمة. مغلق.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValueRefusal {
    UnknownSetting,
    WrongKind,
    OutOfBounds,
    NotAllowedValue,
    LayerNotPermitted,
    /// طبقة أدنى تحاول أن توسّع إعدادًا يحمل أمنًا.
    WidensSecurity,
    /// قيمة أوسع من سقف البناء.
    AboveCeiling,
    Unavailable,
}

impl ValueRefusal {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UnknownSetting => "UNKNOWN_SETTING",
            Self::WrongKind => "WRONG_KIND",
            Self::OutOfBounds => "OUT_OF_BOUNDS",
            Self::NotAllowedValue => "NOT_ALLOWED_VALUE",
            Self::LayerNotPermitted => "LAYER_NOT_PERMITTED",
            Self::WidensSecurity => "WIDENS_SECURITY",
            Self::AboveCeiling => "ABOVE_CEILING",
            Self::Unavailable => "UNAVAILABLE_THIS_PHASE",
        }
    }
}

impl SettingDef {
    pub fn default_value(&self) -> SettingValue {
        self.default.value()
    }

    pub fn ceiling_value(&self) -> Option<SettingValue> {
        self.ceiling.map(DefaultValue::value)
    }

    pub fn security_bearing(&self) -> bool {
        self.widening.is_some()
    }

    /// يحلّ JSON واردًا إلى قيمة مُصنَّفة ويفحص حدودها. لا تحويل ضمني بين الأنواع.
    pub fn parse(&self, raw: &Value) -> Result<SettingValue, ValueRefusal> {
        let b = self.bounds;
        let within = |n: i64| if n < b.min || n > b.max { Err(ValueRefusal::OutOfBounds) } else { Ok(n) };
        match self.kind {
            SettingKind::Boolean => raw.as_bool().map(SettingValue::Boolean).ok_or(ValueRefusal::WrongKind),
            SettingKind::Integer => {
                let n = raw.as_i64().ok_or(ValueRefusal::WrongKind)?;
                Ok(SettingValue::Integer(within(n)?))
            }
            SettingKind::Decimal => {
                let text = raw.as_str().ok_or(ValueRefusal::WrongKind)?;
                let micros = parse_decimal(text).ok_or(ValueRefusal::WrongKind)?;
                Ok(SettingValue::Decimal(within(micros)?))
            }
            SettingKind::Duration => {
                let n = raw.as_u64().ok_or(ValueRefusal::WrongKind)?;
                let n = i64::try_from(n).map_err(|_| ValueRefusal::OutOfBounds)?;
                Ok(SettingValue::DurationMs(within(n)? as u64))
            }
            SettingKind::Bytes => {
                let n = raw.as_u64().ok_or(ValueRefusal::WrongKind)?;
                let n = i64::try_from(n).map_err(|_| ValueRefusal::OutOfBounds)?;
                Ok(SettingValue::Bytes(within(n)? as u64))
            }
            SettingKind::Enum => {
                let code = raw.as_str().ok_or(ValueRefusal::WrongKind)?;
                if !b.allowed.contains(&code) {
                    return Err(ValueRefusal::NotAllowedValue);
                }
                Ok(SettingValue::Enum(code.to_string()))
            }
            SettingKind::String => {
                let text = raw.as_str().ok_or(ValueRefusal::WrongKind)?;
                if text.chars().count() > b.max_len || text.chars().any(char::is_control) {
                    return Err(ValueRefusal::OutOfBounds);
                }
                Ok(SettingValue::Text(text.to_string()))
            }
            SettingKind::List => {
                let items = raw.as_array().ok_or(ValueRefusal::WrongKind)?;
                if items.len() > b.max_items {
                    return Err(ValueRefusal::OutOfBounds);
                }
                let mut out = Vec::with_capacity(items.len());
                for item in items {
                    let text = item.as_str().ok_or(ValueRefusal::WrongKind)?;
                    if text.is_empty() || text.chars().count() > b.max_len || text.chars().any(char::is_control) {
                        return Err(ValueRefusal::OutOfBounds);
                    }
                    if !b.allowed.is_empty() && !b.allowed.contains(&text) {
                        return Err(ValueRefusal::NotAllowedValue);
                    }
                    out.push(text.to_string());
                }
                out.sort();
                out.dedup();
                Ok(SettingValue::List(out))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimals_round_trip_exactly_and_refuse_what_is_not_a_plain_decimal() {
        assert_eq!(parse_decimal("12.5"), Some(12_500_000));
        assert_eq!(parse_decimal("0.000001"), Some(1));
        assert_eq!(parse_decimal("3"), Some(3_000_000));
        assert_eq!(format_decimal(12_500_000), "12.5");
        assert_eq!(format_decimal(3_000_000), "3");
        assert_eq!(format_decimal(1), "0.000001");
        for bad in ["", "1e3", "1.0000001", ".5", "1,5", "NaN", "0x10", "1.2.3"] {
            assert_eq!(parse_decimal(bad), None, "{bad} was accepted as a decimal");
        }
    }

    #[test]
    fn widening_is_directional_and_a_kind_mismatch_counts_as_wider() {
        let t = SettingValue::Boolean(true);
        let f = SettingValue::Boolean(false);
        assert!(Widening::TrueIsWider.is_wider(&t, &f));
        assert!(!Widening::TrueIsWider.is_wider(&f, &t));
        assert!(Widening::FalseIsWider.is_wider(&f, &t));
        assert!(Widening::LargerIsWider.is_wider(&SettingValue::Integer(5), &SettingValue::Integer(4)));
        assert!(!Widening::LargerIsWider.is_wider(&SettingValue::Integer(4), &SettingValue::Integer(4)));
        let order: &'static [&'static str] = &["DENY", "REQUIRE_APPROVAL"];
        assert!(Widening::Ordered(order).is_wider(&SettingValue::Enum("REQUIRE_APPROVAL".into()), &SettingValue::Enum("DENY".into())));
        assert!(Widening::Ordered(order).is_wider(&SettingValue::Enum("ANYTHING".into()), &SettingValue::Enum("DENY".into())), "an unknown code must fail closed");
        assert!(Widening::TrueIsWider.is_wider(&SettingValue::Integer(0), &f), "a kind mismatch must fail closed");
    }
}
