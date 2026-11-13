// Phase-04: المهارات، وسجل الأدوات، وبوابة الأدوات، وأساس MCP، وأدلّة الأدوات.
//
// يُبنى فوق Phase-02 (المزوّد/المشروع/السياق) وPhase-03 (المهمّة/الوكيل/الدليل)
// ولا يعيد تصميم أيّ منهما. القاعدة الحاكمة: الوكيل يقترح، والبوابة تقرّر، والأثر
// لا يقع إلا بعد أن يمرّ بالصلاحية والميزانية والسياسة والموافقة.
//
// كل وحدة هنا ذات مسؤولية واحدة، ولا مُنسِّق ضخم في ملف واحد (البند 37).

pub mod activity;
pub mod adapter;
pub mod approval;
pub mod broker;
pub mod budget;
pub mod builtin;
pub mod effect;
pub mod evidence;
pub mod gateway;
pub mod guidance;
pub mod instruction_skill;
pub mod ipc;
pub mod mcp;
pub mod mission_grant;
pub mod proposal;
pub mod repository;
pub mod service;
pub mod skill;
pub mod tool;
pub mod view;

pub use broker::{MissionToolBroker, Phase04BrokerFactory};
pub use gateway::{DenialReason, MissionToolSession, ToolGateway, ToolInvocationRequest};
pub use service::{Phase04, Phase04Config};
