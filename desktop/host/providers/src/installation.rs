// اكتشاف تثبيت الخوادم المحلية.
//
// قياس محدود وصادق: وجود ملف أو مجلد في المواضع الافتراضية المعروفة على Windows،
// بلا تشغيل برنامج ولا قراءة محتوى. غيابه لا يعني «غير مثبّت» بل «غير مكتشف»،
// لأن المستخدم قد ثبّته في مكان آخر. خارج Windows لا يُقاس، فيُعلن مجهولًا.

use std::path::PathBuf;

use crate::domain::provider::ProviderKind;
use crate::domain::InstallationState;

/// المواضع المعروفة لنوع مزوّد محلي، مبنية من متغيّرات بيئة المستخدم.
pub fn known_locations(kind: ProviderKind, env: &dyn Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let local = env("LOCALAPPDATA").map(PathBuf::from);
    let profile = env("USERPROFILE").map(PathBuf::from);
    let mut out = Vec::new();
    match kind {
        ProviderKind::Ollama => {
            if let Some(base) = &local {
                out.push(base.join("Programs").join("Ollama").join("ollama.exe"));
            }
        }
        ProviderKind::LmStudio => {
            if let Some(base) = &local {
                out.push(base.join("Programs").join("LM Studio").join("LM Studio.exe"));
                out.push(base.join("Programs").join("lm-studio").join("LM Studio.exe"));
            }
            if let Some(home) = &profile {
                out.push(home.join(".lmstudio"));
            }
        }
        ProviderKind::ClaudeCli => out.extend(crate::adapters::cli::known_locations(crate::adapters::cli::CliFlavor::Claude, env)),
        ProviderKind::CodexCli => out.extend(crate::adapters::cli::known_locations(crate::adapters::cli::CliFlavor::Codex, env)),
        _ => {}
    }
    out
}

/// حالة التثبيت كما تُقاس على هذا المضيف.
pub fn probe(kind: ProviderKind, env: &dyn Fn(&str) -> Option<String>, is_windows: bool) -> InstallationState {
    match kind {
        ProviderKind::Ollama | ProviderKind::LmStudio | ProviderKind::ClaudeCli | ProviderKind::CodexCli => {}
        ProviderKind::LocalOpenaiCompatible => return InstallationState::Unknown,
        _ => return InstallationState::NotApplicable,
    }
    if !is_windows {
        return InstallationState::Unknown;
    }
    let locations = known_locations(kind, env);
    if locations.is_empty() {
        return InstallationState::Unknown;
    }
    if locations.iter().any(|p| p.symlink_metadata().is_ok()) {
        InstallationState::Detected
    } else {
        InstallationState::NotDetected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_kinds_are_not_applicable_and_generic_is_unknown() {
        let env = |_: &str| None;
        assert_eq!(probe(ProviderKind::Openai, &env, true), InstallationState::NotApplicable);
        assert_eq!(probe(ProviderKind::LocalOpenaiCompatible, &env, true), InstallationState::Unknown);
    }

    #[test]
    fn detection_reads_only_the_known_locations() {
        let dir = std::env::temp_dir().join(format!("polaris-install-probe-{}", std::process::id()));
        let exe_dir = dir.join("Programs").join("Ollama");
        std::fs::create_dir_all(&exe_dir).unwrap();
        let root = dir.to_string_lossy().to_string();
        let env = move |name: &str| (name == "LOCALAPPDATA").then(|| root.clone());
        assert_eq!(probe(ProviderKind::Ollama, &env, true), InstallationState::NotDetected);
        std::fs::write(exe_dir.join("ollama.exe"), b"").unwrap();
        assert_eq!(probe(ProviderKind::Ollama, &env, true), InstallationState::Detected);
        assert_eq!(probe(ProviderKind::Ollama, &env, false), InstallationState::Unknown);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
