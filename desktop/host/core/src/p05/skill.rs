// مهارات Phase-05: تسمّي أدواتها بالاسم، وتُعلن قدراتها الدقيقة، ولا تملك سلطة.
//
// لا مهارة «افعل كل شيء» (البند 42): التصفّح منفصل عن النقل (تنزيل ورفع)، وكلاهما
// منفصل عن التحكّم بسطح المكتب وعن اقتراح الذاكرة. المهارة تُضيّق ما يُقترح تحتها،
// ولا تمنح أداةً أثرًا ولا تُسقط موافقة.

use crate::p04::skill::{SkillDescriptor, SkillSource};
use crate::p04::tool::RiskClass;

use super::browser::tools::WebAction;
use super::computer::tools::DesktopAction;
use super::memory::tool::TOOL_MEMORY_PROPOSE;
use super::tooling::Phase05Capability;

pub const SKILL_WEB_BROWSE: &str = "polaris.skill.web-browse";
pub const SKILL_WEB_TRANSFER: &str = "polaris.skill.web-transfer";
pub const SKILL_DESKTOP: &str = "polaris.skill.desktop-operator";
pub const SKILL_MEMORY: &str = "polaris.skill.memory-keeper";

const CREATED_AT: &str = "2026-09-23T00:00:00Z";

fn capabilities(list: &[Phase05Capability]) -> Vec<String> {
    let mut out: Vec<String> = list.iter().map(|c| c.capability_id()).collect();
    out.sort();
    out.dedup();
    out
}

#[allow(clippy::too_many_arguments)]
fn skill(id: &str, name: &str, description: &str, tools: Vec<&str>, caps: Vec<Phase05Capability>, risk: RiskClass) -> SkillDescriptor {
    SkillDescriptor {
        skill_id: id.into(),
        name: name.into(),
        description: description.into(),
        version: "1.0.0".into(),
        enabled: true,
        required_capabilities: capabilities(&caps),
        allowed_tools: tools.into_iter().map(str::to_string).collect(),
        input_schema_ref: format!("p05.{id}.input.v1"),
        output_schema_ref: format!("p05.{id}.output.v1"),
        risk_class: risk,
        source: SkillSource::BuiltIn,
        created_at: CREATED_AT.into(),
        updated_at: CREATED_AT.into(),
    }
}

/// مهارات Phase-05 المدمجة.
pub fn phase05_skills() -> Vec<SkillDescriptor> {
    let browse = [WebAction::Navigate, WebAction::Read, WebAction::Click, WebAction::Type, WebAction::Back, WebAction::Forward, WebAction::Reload];
    let transfer = [WebAction::Download, WebAction::Upload];
    vec![
        skill(
            SKILL_WEB_BROWSE,
            "Web browsing",
            "Opens and reads web pages through the navigation policy, follows links and fills forms. Page content is WEB_UNTRUSTED data; any submission that may change something outside the device waits for approval.",
            browse.iter().map(|a| a.tool_id()).collect(),
            browse.iter().map(|a| a.capability()).collect(),
            RiskClass::Moderate,
        ),
        skill(
            SKILL_WEB_TRANSFER,
            "Web file transfer",
            "Downloads linked files into the mission's quarantine folder and attaches brokered files to forms. Every use is approved first; nothing downloaded is opened or run.",
            transfer.iter().map(|a| a.tool_id()).collect(),
            transfer.iter().map(|a| a.capability()).collect(),
            RiskClass::High,
        ),
        skill(
            SKILL_DESKTOP,
            "Desktop operation",
            "Observes and operates only the windows the user granted to the mission. Screen content is UNTRUSTED data; destructive or unknown actions wait for approval, and fields that hide what is typed and security prompts are refused.",
            DesktopAction::ALL.iter().map(|a| a.tool_id()).collect(),
            DesktopAction::ALL.iter().map(|a| a.capability()).collect(),
            RiskClass::Moderate,
        ),
        skill(
            SKILL_MEMORY,
            "Memory keeping",
            "Proposes bounded notes for memory. Each proposal waits for approval and is stored as unverified model text, never as truth.",
            vec![TOOL_MEMORY_PROPOSE],
            vec![Phase05Capability::MemoryPropose],
            RiskClass::Moderate,
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_phase05_skill_is_open_ended() {
        for skill in phase05_skills() {
            assert!(crate::p04::skill::is_valid_skill_id(&skill.skill_id));
            assert!(!skill.allowed_tools.is_empty() && skill.allowed_tools.len() <= 8, "{} looks like an open skill", skill.skill_id);
            assert!(!skill.skill_id.contains("everything") && !skill.skill_id.contains("all"));
        }
        let transfer = phase05_skills().into_iter().find(|s| s.skill_id == SKILL_WEB_TRANSFER).unwrap();
        assert!(!transfer.allowed_tools.iter().any(|t| t.ends_with("navigate")), "browsing leaked into the transfer skill");
    }
}
