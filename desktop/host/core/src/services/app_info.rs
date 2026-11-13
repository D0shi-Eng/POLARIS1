// حقائق التطبيق نفسه: إصدارُه وقناتُه.
//
// الإصدار يُقرأ من بيانات الحزمة وقت الترجمة لا من ثابت مكتوب بخط اليد، فلا
// ينجرف عن الإصدار الحقيقي للثنائي.

/// إصدار التطبيق كما أعلنته الحزمة. `SemVer` بثلاثة أجزاء بالضبط.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildChannelSource {
    /// بناء تطوير: هذا ما تعنيه غياب علامة إصدار.
    Dev,
    Beta,
    Stable,
}

pub struct AppInfoService {
    channel: BuildChannelSource,
}

impl Default for AppInfoService {
    fn default() -> Self {
        Self::new()
    }
}

impl AppInfoService {
    /// القناة تُقرأ من متغيّر بيئة وقت الترجمة. لا قيمة مخترعة: ما لم يُعلَن
    /// شيء فالبناء بناءُ تطوير، وهذا هو الجواب الصادق.
    pub fn new() -> Self {
        let channel = match option_env!("POLARIS_BUILD_CHANNEL") {
            Some("STABLE") => BuildChannelSource::Stable,
            Some("BETA") => BuildChannelSource::Beta,
            _ => BuildChannelSource::Dev,
        };
        Self { channel }
    }

    pub fn version(&self) -> &'static str {
        APP_VERSION
    }

    pub fn channel(&self) -> BuildChannelSource {
        self.channel
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_version_is_a_three_part_semver() {
        let parts: Vec<&str> = APP_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "app version must be MAJOR.MINOR.PATCH");
        for part in parts {
            assert!(part.parse::<u32>().is_ok(), "version part {part} is not numeric");
        }
    }

    #[test]
    fn an_unmarked_build_is_a_dev_build() {
        // الشرط مقصود: البناء المُعلَّم قناةً أخرى ليس خطأ، والاختبار يقيس القاعدة
        // لا بيئة التشغيل.
        if option_env!("POLARIS_BUILD_CHANNEL").is_none() {
            assert_eq!(AppInfoService::new().channel(), BuildChannelSource::Dev);
        }
    }
}
