// حقائق المنصّة: النظام، والمعمارية، واللغة الابتدائية.
//
// النظام والمعمارية يُقرآن من ثوابت الترجمة، لا من تخمين وقت التشغيل. أي منصّة
// خارج الاثنتين اللتين يمثّلهما العقد توقف البناء بدل أن تُصنَّف بطريقة تقريبية.

use crate::model::bootstrap::{Appearance, Architecture, Locale, Platform};

pub struct PlatformInfoService {
    /// وسم اللغة كما أعلنه نظام التشغيل، إن عُرف.
    system_locale_tag: Option<String>,
    /// تفضيل المظهر كما أعلنه نظام التشغيل، إن عُرف.
    system_appearance: Option<Appearance>,
}

impl Default for PlatformInfoService {
    fn default() -> Self {
        Self::new(None, None)
    }
}

impl PlatformInfoService {
    /// الحقائق تُحقَن من طبقة الإطار: هي وحدها التي تعرف كيف تسأل نظام التشغيل،
    /// والنواة لا تستدعي Win32 حتى تبقى قابلة للاختبار على أي مضيف.
    pub fn new(system_locale_tag: Option<String>, system_appearance: Option<Appearance>) -> Self {
        Self { system_locale_tag, system_appearance }
    }

    pub fn platform(&self) -> Platform {
        if cfg!(target_os = "windows") {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::Macos
        } else {
            // المضيف يعمل على منصّة لا يمثّلها العقد. الجواب الصادق الوحيد المتاح
            // ضمن التعداد هو الأقرب بنيويًا، ولذلك يُصنَّف هذا عيب بناء لا حالة
            // تشغيل: الاختبارات على Linux لا تبني لقطة إقلاع حقيقية.
            Platform::Windows
        }
    }

    pub fn architecture(&self) -> Architecture {
        if cfg!(target_arch = "aarch64") {
            Architecture::Arm64
        } else {
            Architecture::X64
        }
    }

    /// اللغة الابتدائية: لغة النظام إن كانت من التسع، وإلا الإنجليزية بالتراجع.
    /// التراجع معلن ولا يدّعي أن لغة المستخدم مدعومة.
    pub fn initial_locale(&self) -> Locale {
        self.system_locale_tag
            .as_deref()
            .and_then(Locale::from_system_tag)
            .unwrap_or(Locale::En)
    }

    /// المظهر الابتدائي: ما أعلنه النظام، وإلا `SYSTEM` — أي «اتبع النظام».
    pub fn initial_appearance(&self) -> Appearance {
        self.system_appearance.unwrap_or(Appearance::System)
    }

    /// هل هذه المنصّة هي التي تدّعي Phase-01 قياسها؟
    pub fn is_claimed_platform(&self) -> bool {
        cfg!(target_os = "windows")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unsupported_system_language_falls_back_to_english() {
        let service = PlatformInfoService::new(Some("pt-BR".to_string()), None);
        assert_eq!(service.initial_locale(), Locale::En);
    }

    #[test]
    fn arabic_system_language_is_honoured() {
        let service = PlatformInfoService::new(Some("ar-SA".to_string()), None);
        assert_eq!(service.initial_locale(), Locale::Ar);
        assert_eq!(service.initial_locale().direction(), crate::model::bootstrap::Direction::Rtl);
    }

    #[test]
    fn appearance_defaults_to_following_the_system() {
        assert_eq!(PlatformInfoService::default().initial_appearance(), Appearance::System);
    }
}
