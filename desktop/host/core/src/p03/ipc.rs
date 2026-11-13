// طبقة IPC لـPhase-03: حمولة مُتحقَّق منها إلى نداء خدمة، ونتيجة إلى JSON.
//
// لا قاعدة عمل هنا. البوابة تحقّقت من الحمولة مقابل مخططها المُسمّى في السجل قبل
// الوصول إلى هنا؛ القراءة دفاعية فقط. المطابقة شاملة: لا فرع «أي شيء آخر» بمنطق
// عام، ولا اسم فعل يأتي من الحمولة (البند 77).

use serde_json::Value;

use crate::ipc::errors::HostError;

use super::mission::{ExecutionMode, MissionBudget, MissionPriority, MissionRequirement};
use super::service::{CreateMissionInput, Phase03};

/// العمليات التي يملكها Phase-03، بالاسم الكامل. مغلقة ومطابقة للسجل.
pub const OPERATIONS: [&str; 10] = [
    "mission.list",
    "mission.get",
    "mission.create",
    "mission.start",
    "mission.cancel",
    "mission.resume",
    "task.list",
    "agent.list",
    "claim.list",
    "evidence.list",
];

/// ينفّذ عملية Phase-03 مسمّاة.
pub fn handle(p03: &Phase03, operation: &str, payload: &Value, session: &str) -> Result<Value, HostError> {
    match operation {
        "mission.list" => to_value(&p03.list()?),
        "mission.get" => to_value(&p03.get(&mission_id(payload)?)?),
        "mission.create" => to_value(&p03.create(create_input(payload)?)?),
        "mission.start" => to_value(&p03.start(&mission_id(payload)?, session)?),
        "mission.cancel" => to_value(&p03.cancel(&mission_id(payload)?)?),
        "mission.resume" => to_value(&p03.resume(&mission_id(payload)?)?),
        "task.list" => to_value(&p03.tasks(&mission_id(payload)?)?),
        "agent.list" => to_value(&p03.agents(optional_str(payload, "mission_id"))?),
        "claim.list" => to_value(&p03.claims(&mission_id(payload)?)?),
        "evidence.list" => to_value(&p03.evidence(&mission_id(payload)?)?),
        other => Err(HostError::internal(format!("routed operation {other} has no Phase-03 owner"))),
    }
}

fn mission_id(payload: &Value) -> Result<String, HostError> {
    payload
        .get("mission_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| HostError::validation("mission_id is absent").at("/mission_id"))
}

fn optional_str<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str)
}

/// يبني مدخلات الإنشاء. الميزانية: صريحة إن وُردت، وإلا الإعداد المُسمّى، وإلا المحافظ.
/// لا «اختر شيئًا معقولًا» صامتًا.
fn create_input(payload: &Value) -> Result<CreateMissionInput, HostError> {
    let title = payload
        .get("title")
        .and_then(Value::as_str)
        .ok_or_else(|| HostError::validation("title is absent").at("/title"))?
        .to_string();
    let objective = payload
        .get("objective")
        .and_then(Value::as_str)
        .ok_or_else(|| HostError::validation("objective is absent").at("/objective"))?
        .to_string();

    let budget = match payload.get("budget") {
        Some(explicit) => serde_json::from_value::<MissionBudget>(explicit.clone())
            .map_err(|e| HostError::validation(format!("budget is not a complete budget: {e}")).at("/budget"))?,
        None => match optional_str(payload, "budget_preset") {
            Some("BALANCED") => MissionBudget::balanced(),
            Some("EXTENDED") => MissionBudget::extended(),
            // CUSTOM بلا ميزانية صريحة ليس إعدادًا: يُرفض بدل أن يُخمَّن.
            Some("CUSTOM") => {
                return Err(HostError::validation("budget_preset CUSTOM requires an explicit budget").at("/budget"))
            }
            _ => MissionBudget::conservative(),
        },
    };

    let execution_mode = match optional_str(payload, "execution_mode") {
        Some("COORDINATED_MULTI_AGENT") => ExecutionMode::CoordinatedMultiAgent,
        _ => ExecutionMode::SingleAgent,
    };
    let priority = match optional_str(payload, "priority") {
        Some("LOW") => MissionPriority::Low,
        Some("HIGH") => MissionPriority::High,
        _ => MissionPriority::Normal,
    };

    let mut requirements = Vec::new();
    for item in payload.get("requirements").and_then(Value::as_array).into_iter().flatten() {
        let id = item
            .get("requirement_id")
            .and_then(Value::as_str)
            .ok_or_else(|| HostError::validation("requirement_id is absent").at("/requirements"))?;
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| HostError::validation("requirement text is absent").at("/requirements"))?;
        let mandatory = item.get("mandatory").and_then(Value::as_bool).unwrap_or(false);
        let rule = item.get("verification_rule_id").and_then(Value::as_str).unwrap_or("p03.rule.fact");
        requirements.push(MissionRequirement::new(id, text, rule, mandatory));
    }

    Ok(CreateMissionInput {
        title,
        objective,
        project_id: optional_str(payload, "project_id").map(str::to_string),
        execution_mode,
        priority,
        budget,
        requirements,
    })
}

/// يسلسل نتيجة خدمة. الفشل هنا عيب داخلي.
fn to_value<T: serde::Serialize>(value: &T) -> Result<Value, HostError> {
    serde_json::to_value(value).map_err(|e| HostError::internal(format!("result serialisation failed: {e}")))
}
