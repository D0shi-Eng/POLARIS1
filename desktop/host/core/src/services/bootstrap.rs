// خدمة الإقلاع: تركّب اللقطة من الخدمات الأخرى ولا تعرف شيئًا بنفسها.
//
// هذه هي النقطة التي يسهل أن تتحول فيها إلى خدمة إله تجمع كل شيء. لم تفعل: كل
// حقيقة تأتي من مالكها، وما تملكه هذه الخدمة هو التركيب وحده.

use serde_json::Value;

use crate::capabilities;
use crate::ipc::errors::HostError;
use crate::model::bootstrap::{Appearance, BootstrapSnapshot, BuildChannel, Locale};
use crate::services::app_info::{AppInfoService, BuildChannelSource};
use crate::services::platform_info::PlatformInfoService;
use crate::services::runtime_status::RuntimeStatusService;
use crate::{IPC_PROTOCOL_VERSION, SETTINGS_SCHEMA_VERSION};

pub struct BootstrapService<'a> {
    pub app_info: &'a AppInfoService,
    pub platform_info: &'a PlatformInfoService,
    pub runtime_status: &'a RuntimeStatusService,
}

fn channel(source: BuildChannelSource) -> BuildChannel {
    match source {
        BuildChannelSource::Dev => BuildChannel::Dev,
        BuildChannelSource::Beta => BuildChannel::Beta,
        BuildChannelSource::Stable => BuildChannel::Stable,
    }
}

impl<'a> BootstrapService<'a> {
    pub fn snapshot(&self, locale: Locale, appearance: Appearance) -> BootstrapSnapshot {
        self.snapshot_with(locale, appearance, &capabilities::CapabilityFacts::phase_01())
    }

    pub fn snapshot_with(&self, locale: Locale, appearance: Appearance, facts: &capabilities::CapabilityFacts) -> BootstrapSnapshot {
        BootstrapSnapshot {
            app_version: self.app_info.version().to_string(),
            build_channel: channel(self.app_info.channel()),
            platform: self.platform_info.platform(),
            architecture: self.platform_info.architecture(),
            locale,
            // الاتجاه مشتقّ من اللغة، لا من مفتاح يدوي.
            direction: locale.direction(),
            appearance,
            runtime_status: self.runtime_status.status(),
            enabled_capabilities: capabilities::enabled_ids_with(facts),
            unavailable_capabilities: capabilities::unavailable_with(facts),
            settings_schema_version: SETTINGS_SCHEMA_VERSION.to_string(),
            ipc_protocol_version: IPC_PROTOCOL_VERSION.to_string(),
        }
    }

    pub fn result(&self, locale: Locale, appearance: Appearance) -> Result<Value, HostError> {
        self.result_with(locale, appearance, &capabilities::CapabilityFacts::phase_01())
    }

    pub fn result_with(&self, locale: Locale, appearance: Appearance, facts: &capabilities::CapabilityFacts) -> Result<Value, HostError> {
        serde_json::to_value(self.snapshot_with(locale, appearance, facts))
            .map_err(|e| HostError::internal(format!("bootstrap snapshot could not be serialised: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service_parts() -> (AppInfoService, PlatformInfoService, RuntimeStatusService) {
        (AppInfoService::new(), PlatformInfoService::default(), RuntimeStatusService::new())
    }

    #[test]
    fn the_snapshot_has_exactly_the_twelve_contract_facts() {
        let (app, platform, runtime) = service_parts();
        let service = BootstrapService { app_info: &app, platform_info: &platform, runtime_status: &runtime };
        let value = service.result(Locale::Ar, Appearance::System).unwrap();
        let object = value.as_object().unwrap();
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "app_version",
                "appearance",
                "architecture",
                "build_channel",
                "direction",
                "enabled_capabilities",
                "ipc_protocol_version",
                "locale",
                "platform",
                "runtime_status",
                "settings_schema_version",
                "unavailable_capabilities",
            ]
        );
    }

    #[test]
    fn the_snapshot_carries_no_host_internals() {
        let (app, platform, runtime) = service_parts();
        let service = BootstrapService { app_info: &app, platform_info: &platform, runtime_status: &runtime };
        let text = service.result(Locale::En, Appearance::Light).unwrap().to_string();
        for forbidden in
            ["process_id", "executable_path", "environment", "stack_trace", "policy_set", "native_handles", "config"]
        {
            assert!(!text.contains(forbidden), "the snapshot leaked {forbidden}");
        }
    }

    #[test]
    fn direction_follows_the_locale_not_a_toggle() {
        let (app, platform, runtime) = service_parts();
        let service = BootstrapService { app_info: &app, platform_info: &platform, runtime_status: &runtime };
        use crate::model::bootstrap::Direction;
        assert_eq!(service.snapshot(Locale::Ar, Appearance::Light).direction, Direction::Rtl);
        assert_eq!(service.snapshot(Locale::En, Appearance::Light).direction, Direction::Ltr);
    }
}
