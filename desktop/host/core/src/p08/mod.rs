// Phase-08: إكمال المنتج — بيئة التنفيذ، والمخرجات، والمتصفّح الحقيقي، والمجدول،
// والتكاملات. كل ما هنا يدخل الطبقات السابقة من منافذها وحدها: الأدوات تُسجَّل في سجل
// Phase-04 وتمرّ ببوابته، والمهامّ تبقى مهامّ Phase-03، والإعدادات إعدادات Phase-06.

pub mod artifacts;
pub mod attachments;
pub mod browser;
pub mod contract_probe;
pub mod conversation;
pub mod execution;
pub mod intake;
pub mod integrations;
pub mod ipc;
pub mod missions;
pub mod notify;
pub mod oauth;
pub mod package_tool;
pub mod purge;
pub mod scheduler;
pub mod search_settings;
pub mod semantic_memory;
pub mod service;
pub mod threads;
pub mod tool_schemas;
pub mod web_search;
pub mod workspace;
pub mod workspace_edit;
pub mod workspace_tools;

pub use service::{Phase08, Phase08Config, Phase08Platform, SKILL_AGENTIC_WORK};
