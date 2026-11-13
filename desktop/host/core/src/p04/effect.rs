// تصنيف آثار الأدوات، والقدرة التي يلزم امتلاكها لكل أثر.
//
// القاعدة (البند 39/108): الأداة تُصنَّف بما تستطيع أن تُحدثه، لا بما تنوي فعله.
// أداة تستطيع تعديل شيء بطريق غير مباشر ليست «قراءة فقط»، ولذلك يُعلن كل أثر
// قابل للبلوغ صراحةً ويُفحص قبل التنفيذ.
//
// الحدّ الحاسم هنا: المِنحة التي يملكها زمن التشغيل ثابتة في الشيفرة ولا يوسّعها
// إعداد ولا خادم ولا نموذج. أثران خارجها — تنفيذ عملية، والوصول إلى سرّ — لا
// قدرة لهما أصلًا في هذا البناء، فالأداة التي تُعلنهما تُرفض بنيويًّا لا بسياسة
// قابلة للتبديل.

use serde::{Deserialize, Serialize};

/// ما تستطيع الأداة إحداثه. مجموعة مغلقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ToolEffect {
    /// حساب محلي بحت: لا قراءة ولا كتابة ولا شبكة.
    LocalCompute,
    /// قراءة مورد محلي أذن به المستخدم صراحةً (مصدر سياق مسجَّل).
    ReadLocal,
    /// كتابة في مورد محلي أذن به المستخدم.
    WriteLocal,
    /// خروج على الشبكة. في هذه المرحلة: الحلقة المحلية وحدها.
    NetworkEgress,
    /// تشغيل عملية. لا قدرة له في هذا البناء.
    ProcessExecution,
    /// وصول إلى سرّ. لا قدرة له في هذا البناء.
    SecretAccess,
    DatabaseRead,
    DatabaseWrite,
    /// أثر يخرج عن حدود الجهاز أو يُلاحَظ من خارجه.
    ExternalSideEffect,
    /// إدخال (مؤشّر، لوحة مفاتيح، تمرير، تركيز) في نافذة منحها المستخدم لمهمّة
    /// بعينها (Phase-05). يغيّر حالة تطبيق آخر فهو ليس قراءة، ولا يُعفى من سياسة
    /// الخطر: فعلٌ يتبيّن أنه حذف أو إرسال أو تثبيت يُرفع إلى أثر خارجي يوجب موافقة.
    DesktopInput,
    /// قراءة داخل مساحة عمل المهمّة التي يملكها POLARIS (Phase-08). ليست ملفات المستخدم.
    WorkspaceRead,
    /// كتابة داخل مساحة عمل المهمّة وحدها (Phase-08). حدّها المسار المحلول والصندوق معًا.
    WorkspaceWrite,
    /// تشغيل عملية داخل الصندوق المعزول (AppContainer + Job) في مساحة المهمّة، بلا شبكة
    /// ما لم يُوافَق عليها (Phase-08). تنفيذ العملية على المضيف مباشرةً (`ProcessExecution`)
    /// يبقى بلا قدرة في هذا البناء.
    SandboxedExecution,
}

impl ToolEffect {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LocalCompute => "LOCAL_COMPUTE",
            Self::ReadLocal => "READ_LOCAL",
            Self::WriteLocal => "WRITE_LOCAL",
            Self::NetworkEgress => "NETWORK_EGRESS",
            Self::ProcessExecution => "PROCESS_EXECUTION",
            Self::SecretAccess => "SECRET_ACCESS",
            Self::DatabaseRead => "DATABASE_READ",
            Self::DatabaseWrite => "DATABASE_WRITE",
            Self::ExternalSideEffect => "EXTERNAL_SIDE_EFFECT",
            Self::DesktopInput => "DESKTOP_INPUT",
            Self::WorkspaceRead => "WORKSPACE_READ",
            Self::WorkspaceWrite => "WORKSPACE_WRITE",
            Self::SandboxedExecution => "SANDBOXED_EXECUTION",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Some(match code {
            "LOCAL_COMPUTE" => Self::LocalCompute,
            "READ_LOCAL" => Self::ReadLocal,
            "WRITE_LOCAL" => Self::WriteLocal,
            "NETWORK_EGRESS" => Self::NetworkEgress,
            "PROCESS_EXECUTION" => Self::ProcessExecution,
            "SECRET_ACCESS" => Self::SecretAccess,
            "DATABASE_READ" => Self::DatabaseRead,
            "DATABASE_WRITE" => Self::DatabaseWrite,
            "EXTERNAL_SIDE_EFFECT" => Self::ExternalSideEffect,
            "DESKTOP_INPUT" => Self::DesktopInput,
            "WORKSPACE_READ" => Self::WorkspaceRead,
            "WORKSPACE_WRITE" => Self::WorkspaceWrite,
            "SANDBOXED_EXECUTION" => Self::SandboxedExecution,
            _ => return None,
        })
    }

    /// كل الآثار، بترتيب ثابت. يُستعمل في العرض وفي الاختبار الشامل.
    pub const ALL: [ToolEffect; 13] = [
        Self::LocalCompute,
        Self::ReadLocal,
        Self::WriteLocal,
        Self::NetworkEgress,
        Self::ProcessExecution,
        Self::SecretAccess,
        Self::DatabaseRead,
        Self::DatabaseWrite,
        Self::ExternalSideEffect,
        Self::DesktopInput,
        Self::WorkspaceRead,
        Self::WorkspaceWrite,
        Self::SandboxedExecution,
    ];

    /// القدرة اللازمة لهذا الأثر. واحدة لكل أثر، فلا أثر بلا قدرة تحرسه.
    pub fn required_capability(self) -> &'static str {
        match self {
            Self::LocalCompute => "polaris.capability.tool.local_compute",
            Self::ReadLocal => "polaris.capability.tool.read_local",
            Self::WriteLocal => "polaris.capability.tool.write_local",
            Self::NetworkEgress => "polaris.capability.tool.network",
            Self::ProcessExecution => "polaris.capability.tool.process",
            Self::SecretAccess => "polaris.capability.tool.secret",
            Self::DatabaseRead => "polaris.capability.tool.database_read",
            Self::DatabaseWrite => "polaris.capability.tool.database_write",
            Self::ExternalSideEffect => "polaris.capability.tool.external",
            Self::DesktopInput => "polaris.capability.tool.desktop_input",
            Self::WorkspaceRead => "polaris.capability.tool.workspace_read",
            Self::WorkspaceWrite => "polaris.capability.tool.workspace_write",
            Self::SandboxedExecution => "polaris.capability.tool.sandboxed_process",
        }
    }

    /// هل يغيّر هذا الأثر شيئًا؟ القراءة والحساب لا، وما عداهما نعم.
    pub fn mutates(self) -> bool {
        !matches!(self, Self::LocalCompute | Self::ReadLocal | Self::DatabaseRead | Self::WorkspaceRead)
    }

    /// هل يخرج أثره عن حدود العملية بحيث لا يمكن التراجع عنه بإلغاء؟
    pub fn is_external(self) -> bool {
        matches!(self, Self::ExternalSideEffect)
    }

    /// هل يلمس الشبكة؟
    pub fn is_network(self) -> bool {
        matches!(self, Self::NetworkEgress)
    }

    /// هل يحتاج موافقة بشرية دائمًا مهما قال واصف الأداة؟
    ///
    /// الواصف يستطيع أن يطلب موافقة لأثر منخفض؛ ولا يستطيع أن يُسقطها عن أثر
    /// يغيّر حالة خارج القراءة. «requires_approval: false» في واصف أداة كتابة
    /// اقتراحٌ يُتجاهَل، لا إذن.
    pub fn always_requires_approval(self) -> bool {
        matches!(self, Self::WriteLocal | Self::DatabaseWrite | Self::ExternalSideEffect | Self::ProcessExecution | Self::SecretAccess)
    }
}

/// مِنحة القدرات التي يملكها زمن التشغيل الموثوق في هذا البناء.
///
/// ثابتة في الشيفرة عمدًا: لا إعداد يوسّعها، ولا خادم MCP، ولا نموذج، ولا مهارة.
/// غياب قدرتَي تنفيذ العملية والوصول إلى السرّ ليس سهوًا: هو ما يجعل «ممرًّا عامًّا
/// إلى الصدفة» و«أداة تطلب سرًّا» مرفوضَين بنيويًّا لا بسياسة قابلة للتبديل.
pub const RUNTIME_CAPABILITY_GRANT: &[&str] = &[
    "polaris.capability.tool.local_compute",
    "polaris.capability.tool.read_local",
    "polaris.capability.tool.write_local",
    "polaris.capability.tool.network",
    "polaris.capability.tool.database_read",
    "polaris.capability.tool.database_write",
    "polaris.capability.tool.external",
    // Phase-05: الإدخال في نافذة ممنوحة لمهمّة. المنحة نفسها يعطيها المستخدم لكل
    // مهمّة ونافذة، وهذه القدرة شرطٌ لازم لا كافٍ.
    "polaris.capability.tool.desktop_input",
    // Phase-08 (ADR-028): مساحة عمل المهمّة المملوكة، والتشغيل داخل الصندوق المعزول وحده.
    // هذه ليست `tool.process`: تلك تبقى غائبة، فلا أداة تستطيع تشغيل عملية على المضيف.
    "polaris.capability.tool.workspace_read",
    "polaris.capability.tool.workspace_write",
    "polaris.capability.tool.sandboxed_process",
];

/// هل يملك زمن التشغيل هذه القدرة؟
pub fn runtime_holds(capability: &str) -> bool {
    RUNTIME_CAPABILITY_GRANT.contains(&capability)
}

/// الآثار التي لا قدرة لها في هذا البناء إطلاقًا.
pub fn ungranted_effects() -> Vec<ToolEffect> {
    ToolEffect::ALL.into_iter().filter(|e| !runtime_holds(e.required_capability())).collect()
}

/// يرتّب مجموعة آثار ويزيل تكرارها، فتصير مقارنتها وبصمتها حتميتين.
pub fn normalise(effects: &[ToolEffect]) -> Vec<ToolEffect> {
    let mut out: Vec<ToolEffect> = effects.to_vec();
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_effect_names_a_distinct_capability() {
        let mut capabilities: Vec<&str> = ToolEffect::ALL.iter().map(|e| e.required_capability()).collect();
        capabilities.sort_unstable();
        let count = capabilities.len();
        capabilities.dedup();
        assert_eq!(capabilities.len(), count, "two effects share one capability");
    }

    #[test]
    fn process_execution_and_secret_access_have_no_capability_in_this_build() {
        let missing = ungranted_effects();
        assert!(missing.contains(&ToolEffect::ProcessExecution));
        assert!(missing.contains(&ToolEffect::SecretAccess));
        assert_eq!(missing.len(), 2, "the grant changed: {missing:?}");
    }

    #[test]
    fn a_read_is_not_a_mutation_and_a_write_is() {
        assert!(!ToolEffect::ReadLocal.mutates());
        assert!(!ToolEffect::DatabaseRead.mutates());
        assert!(!ToolEffect::LocalCompute.mutates());
        assert!(ToolEffect::WriteLocal.mutates());
        assert!(ToolEffect::NetworkEgress.mutates(), "network egress is observable outside this process");
        assert!(ToolEffect::ExternalSideEffect.mutates());
    }

    #[test]
    fn a_mutating_effect_always_requires_approval_whatever_a_descriptor_says() {
        for effect in ToolEffect::ALL {
            if matches!(effect, ToolEffect::WriteLocal | ToolEffect::DatabaseWrite | ToolEffect::ExternalSideEffect) {
                assert!(effect.always_requires_approval(), "{} escaped approval", effect.as_str());
            }
        }
        assert!(!ToolEffect::ReadLocal.always_requires_approval());
    }

    #[test]
    fn codes_round_trip_and_an_unknown_code_is_refused() {
        for effect in ToolEffect::ALL {
            assert_eq!(ToolEffect::parse(effect.as_str()), Some(effect));
        }
        assert_eq!(ToolEffect::parse("ANYTHING_GOES"), None);
        assert_eq!(ToolEffect::parse("read_local"), None, "a lowercase code was accepted");
    }

    #[test]
    fn normalisation_is_deterministic() {
        let a = normalise(&[ToolEffect::NetworkEgress, ToolEffect::ReadLocal, ToolEffect::ReadLocal]);
        let b = normalise(&[ToolEffect::ReadLocal, ToolEffect::NetworkEgress]);
        assert_eq!(a, b);
        assert_eq!(a.len(), 2);
    }
}
