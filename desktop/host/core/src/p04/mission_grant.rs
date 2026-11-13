// «اسمح لهذه المهمّة» (ADR-042، تكليف 2026-10-19): موافقة بشرية واحدة تغطّي تكرار الفعل نفسه في المهمّة نفسها.
//
// ليست «وصولًا كاملًا»: المنحة أداة واحدة، ومورد واحد، وآثار بعينها، في مهمّة واحدة، حتى وقت انتهاء، ويمكن سحبها. والبوابة تقيّم
// السياسة كاملة عند كل نداء قبل أن تنظر في المنحة (الخطوات 1–9)؛ المنحة تحلّ محلّ سؤال الإنسان وحده، لا محلّ الحكم. وثلاثة لا
// تقبلها أبدًا:
// - آثار لا رجوع عنها أو خارج المساحة: سرّ، وإدخال سطح مكتب، وتشغيل عملية على المضيف، وكتابة ملف للمستخدم أو قاعدة، وأثر خارجي
//   إلا واحدًا: أمر أو Python داخل صندوق المهمّة صنّفه زمن التشغيل نفسه بخطر شبكة أو تثبيت حزمة وحدهما. ذلك ما يطلب الموافقة فعلًا
//   في المنتج اليوم؛ وتغيير إعداد النظام أو تشغيل ملف منزَّل أو رفع الصلاحية لا يقبل منحة أبدًا.
// - نداء طلب فيه زمن التشغيل إنسانًا (قاعدة الاثنين): `require_human` يسود كل منحة.
// - مهمّة أخرى، أو أداة أخرى، أو مورد آخر، أو آثار أوسع، أو منحة انتهت أو سُحبت.
// المنح في الذاكرة وحدها عمدًا: إعادة التشغيل تُسقطها فيُسأل المستخدم من جديد. كل منح وسحب واستعمال حدث تدقيق.

use serde::Serialize;
use serde_json::Value;

use super::approval::ApprovalContext;
use super::effect::{self, ToolEffect};
use super::tool::RiskClass;

/// عمر المنحة. ساعة: تغطّي مهمّة طويلة واحدة، ولا تبقى لما بعدها.
pub const MISSION_GRANT_TTL_MS: u64 = 60 * 60 * 1000;

/// أفعال الصندوق التي يصنّفها زمن التشغيل (`p08/execution/tools.rs`) ويقبل خطرها منحة مهمّة.
const SANDBOX_ACTIONS: [&str; 2] = ["EXECUTION_COMMAND", "EXECUTION_PYTHON"];
/// أخطار الصندوق المقبولة. ما سواها (إعداد النظام، ملف منزَّل، رفع صلاحية) يُسأل عنه كل مرة.
const SANDBOX_RISKS: [&str; 2] = ["NETWORK", "PACKAGE_INSTALL"];

/// هل خطر الصندوق كما صنّفه زمن التشغيل مقبول لمنحة مهمّة؟
fn sandbox_risk_ok(context: Option<&ApprovalContext>) -> bool {
    context.is_some_and(|c| {
        SANDBOX_ACTIONS.contains(&c.action.as_str())
            && c.risk <= RiskClass::High
            && !c.expected_effect.trim().is_empty()
            && c.expected_effect.split(',').map(str::trim).all(|r| SANDBOX_RISKS.contains(&r))
    })
}

/// آثار تقبل منحة مهمّة: داخل مساحة المهمّة أو صندوقها، أو قراءة، أو خروج شبكي؛ والأثر الخارجي لفعل صندوق مقبول الخطر وحده.
pub fn eligible(effects: &[ToolEffect], context: Option<&ApprovalContext>) -> bool {
    !effects.is_empty()
        && effects.iter().all(|e| match e {
            ToolEffect::LocalCompute
            | ToolEffect::ReadLocal
            | ToolEffect::DatabaseRead
            | ToolEffect::NetworkEgress
            | ToolEffect::WorkspaceRead
            | ToolEffect::WorkspaceWrite
            | ToolEffect::SandboxedExecution => true,
            ToolEffect::ExternalSideEffect => sandbox_risk_ok(context),
            _ => false,
        })
}

/// مضيف عنوان http(s) بأحرف صغيرة، بلا منفذ ولا مستخدم. غيره: لا شيء.
fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://").map(|(scheme, rest)| (scheme.to_ascii_lowercase(), rest)).filter(|(s, _)| s == "http" || s == "https")?.1;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?.split(':').next()?.to_ascii_lowercase();
    (!host.is_empty()).then_some(host)
}

/// المورد الذي تُربط به المنحة. فعل صندوق صنّفه زمن التشغيل: الفعل وأخطاره المرتّبة، فمنحة «شبكة» لا تغطّي «تثبيت حزمة». وإلا
/// من حجج النداء: مجلد ملف المساحة، أو مضيف العنوان، أو البحث نفسه، أو الصندوق بحالة شبكته. ما لا يُعرف مورده يُربط بحججه نفسها
/// (بصمتها)، فلا تغطّي المنحة إلا تكرار النداء نفسه حرفيًّا.
pub fn resource_of(tool_id: &str, arguments: &Value, arguments_digest: &str, context: Option<&ApprovalContext>) -> String {
    if let Some(c) = context.filter(|c| SANDBOX_ACTIONS.contains(&c.action.as_str())) {
        let mut risks: Vec<&str> = c.expected_effect.split(',').map(str::trim).filter(|r| !r.is_empty()).collect();
        risks.sort_unstable();
        return format!("ctx:{}:{}", c.action, risks.join("+"));
    }
    if tool_id == "polaris.web.search" {
        return "search".into();
    }
    if tool_id == "polaris.execution.python" {
        return if arguments.get("network").and_then(Value::as_bool) == Some(true) { "sandbox:network".into() } else { "sandbox:offline".into() };
    }
    if let Some(url) = arguments.get("url").and_then(Value::as_str) {
        if let Some(host) = host_of(url) {
            return format!("host:{host}");
        }
    }
    if let Some(path) = arguments.get("path").and_then(Value::as_str) {
        let normal = path.replace('\\', "/");
        if !normal.split('/').any(|part| part == "..") {
            let dir = match normal.rsplit_once('/') {
                Some((dir, _)) if !dir.is_empty() => format!("{dir}/"),
                _ => "/".into(),
            };
            return format!("dir:{dir}");
        }
    }
    format!("args:{}", arguments_digest.chars().take(24).collect::<String>())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MissionGrant {
    pub grant_id: String,
    /// المهمّة في نتيجة القائمة أصلًا، فلا تُكرَّر في كل منحة (العقد يرفضها).
    #[serde(skip)]
    pub mission_id: String,
    pub tool_id: String,
    pub resource: String,
    pub effects: Vec<ToolEffect>,
    pub created_at: String,
    pub expires_at: String,
    #[serde(skip)]
    pub expires_at_ms: u64,
}

/// المنح القائمة. لا يُضاف إليها إلا من قرار مستخدم في `respond_approval_scoped`.
#[derive(Debug, Default)]
pub struct MissionGrants {
    grants: Vec<MissionGrant>,
}

impl MissionGrants {
    pub fn add(&mut self, grant: MissionGrant) {
        // منحة بالمفتاح نفسه تحلّ محلّ السابقة (يتجدّد وقتها)، فلا تتكدّس.
        self.grants.retain(|g| !(g.mission_id == grant.mission_id && g.tool_id == grant.tool_id && g.resource == grant.resource && g.effects == grant.effects));
        self.grants.push(grant);
    }

    /// المنحة التي تغطّي هذا النداء، إن وُجدت: المهمّة والأداة والمورد نفسها، وآثار النداء كلها ضمن آثار المنحة، ولم تنتهِ.
    pub fn matching(&self, mission_id: &str, tool_id: &str, effects: &[ToolEffect], resource: &str, now_ms: u64) -> Option<&MissionGrant> {
        let wanted = effect::normalise(effects);
        self.grants
            .iter()
            .find(|g| g.mission_id == mission_id && g.tool_id == tool_id && g.resource == resource && now_ms < g.expires_at_ms && wanted.iter().all(|e| g.effects.contains(e)))
    }

    pub fn active(&self, mission_id: &str, now_ms: u64) -> Vec<MissionGrant> {
        self.grants.iter().filter(|g| g.mission_id == mission_id && now_ms < g.expires_at_ms).cloned().collect()
    }

    /// يسحب منحة واحدة أو كل منح المهمّة. يعيد عدد ما سُحب.
    pub fn revoke(&mut self, mission_id: &str, grant_id: Option<&str>) -> usize {
        let before = self.grants.len();
        self.grants.retain(|g| !(g.mission_id == mission_id && grant_id.is_none_or(|id| id == g.grant_id)));
        before - self.grants.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn grant(mission: &str, tool: &str, resource: &str, effects: Vec<ToolEffect>, expires_at_ms: u64) -> MissionGrant {
        MissionGrant {
            grant_id: format!("g-{mission}-{tool}"),
            mission_id: mission.into(),
            tool_id: tool.into(),
            resource: resource.into(),
            effects: effect::normalise(&effects),
            created_at: "t".into(),
            expires_at: "t".into(),
            expires_at_ms,
        }
    }

    fn sandbox(action: &str, risks: &str) -> ApprovalContext {
        ApprovalContext {
            agent_id: "a".into(),
            action: action.into(),
            target: "the mission workspace (sandboxed)".into(),
            expected_effect: risks.into(),
            risk: RiskClass::High,
            arguments_summary: String::new(),
        }
    }

    #[test]
    fn irreversible_or_outside_effects_never_take_a_mission_grant() {
        assert!(eligible(&[ToolEffect::WorkspaceWrite], None));
        assert!(eligible(&[ToolEffect::NetworkEgress], None));
        assert!(eligible(&[ToolEffect::SandboxedExecution, ToolEffect::WorkspaceWrite], None));
        for bad in [ToolEffect::ExternalSideEffect, ToolEffect::SecretAccess, ToolEffect::DesktopInput, ToolEffect::ProcessExecution, ToolEffect::WriteLocal, ToolEffect::DatabaseWrite] {
            assert!(!eligible(&[ToolEffect::WorkspaceWrite, bad], None), "{bad:?} took a mission grant");
        }
        assert!(!eligible(&[], None));
    }

    #[test]
    fn a_sandboxed_command_takes_a_grant_only_for_network_or_package_risk() {
        let external = [ToolEffect::SandboxedExecution, ToolEffect::ExternalSideEffect, ToolEffect::NetworkEgress];
        assert!(eligible(&external, Some(&sandbox("EXECUTION_COMMAND", "NETWORK"))));
        assert!(eligible(&external, Some(&sandbox("EXECUTION_PYTHON", "NETWORK, PACKAGE_INSTALL"))));
        for risky in ["SYSTEM_CONFIGURATION", "NETWORK, PRIVILEGE_ELEVATION", "DOWNLOADED_EXECUTABLE", ""] {
            assert!(!eligible(&external, Some(&sandbox("EXECUTION_COMMAND", risky))), "{risky} took a mission grant");
        }
        assert!(!eligible(&external, Some(&sandbox("WEB_UPLOAD", "NETWORK"))), "a browser upload took a mission grant");
        let mut critical = sandbox("EXECUTION_COMMAND", "NETWORK");
        critical.risk = RiskClass::Critical;
        assert!(!eligible(&external, Some(&critical)));
        assert_eq!(
            resource_of("polaris.execution.command", &json!({ "command": "pip install x" }), "d", Some(&sandbox("EXECUTION_COMMAND", "PACKAGE_INSTALL, NETWORK"))),
            "ctx:EXECUTION_COMMAND:NETWORK+PACKAGE_INSTALL"
        );
    }

    #[test]
    fn the_resource_is_the_folder_the_host_or_the_exact_arguments() {
        assert_eq!(resource_of("polaris.workspace.write", &json!({ "path": "outputs/site/index.html" }), "d", None), "dir:outputs/site/");
        assert_eq!(resource_of("polaris.workspace.write", &json!({ "path": "notes.md" }), "d", None), "dir:/");
        assert_eq!(resource_of("polaris.workspace.write", &json!({ "path": "outputs/../x" }), "abc", None), "args:abc", "a traversal must not widen to a folder");
        assert_eq!(resource_of("polaris.browser.open", &json!({ "url": "https://User@Docs.Example.com:443/a?b" }), "d", None), "host:docs.example.com");
        assert_eq!(resource_of("polaris.browser.open", &json!({ "url": "file:///C:/x" }), "abc", None), "args:abc");
        assert_eq!(resource_of("polaris.web.search", &json!({ "query": "x" }), "d", None), "search");
        assert_eq!(resource_of("polaris.execution.python", &json!({ "code": "1", "network": true }), "d", None), "sandbox:network");
        assert_eq!(resource_of("polaris.execution.python", &json!({ "code": "1" }), "d", None), "sandbox:offline");
    }

    #[test]
    fn a_grant_covers_only_its_mission_tool_resource_effects_and_time() {
        let mut grants = MissionGrants::default();
        grants.add(grant("m1", "polaris.workspace.write", "dir:outputs/", vec![ToolEffect::WorkspaceWrite], 1_000));
        let w = [ToolEffect::WorkspaceWrite];
        assert!(grants.matching("m1", "polaris.workspace.write", &w, "dir:outputs/", 10).is_some());
        assert!(grants.matching("m2", "polaris.workspace.write", &w, "dir:outputs/", 10).is_none(), "another mission");
        assert!(grants.matching("m1", "polaris.workspace.export", &w, "dir:outputs/", 10).is_none(), "another tool");
        assert!(grants.matching("m1", "polaris.workspace.write", &w, "dir:inputs/", 10).is_none(), "another resource");
        assert!(grants.matching("m1", "polaris.workspace.write", &[ToolEffect::WorkspaceWrite, ToolEffect::NetworkEgress], "dir:outputs/", 10).is_none(), "wider effects");
        assert!(grants.matching("m1", "polaris.workspace.write", &w, "dir:outputs/", 1_000).is_none(), "expired");
        assert_eq!(grants.revoke("m1", None), 1);
        assert!(grants.matching("m1", "polaris.workspace.write", &w, "dir:outputs/", 10).is_none(), "revoked");
    }
}
