// Phase-03: زمن تشغيل الوكلاء، والتنسيق متعدّد الوكلاء، وطبقة الثقة/الحقيقة/الأدلّة.
//
// يُبنى فوق ركيزة Phase-02 (المزوّد/النموذج/المشروع/السياق) ولا يعيد تصميمها.
// كل وحدة هنا ذات مسؤولية واحدة؛ لا مُنسِّق ضخم في ملف واحد (البند 37). القواعد
// الأمنية الموروثة تبقى: العارض غير موثوق، ومخرجات النموذج بلا سلطة، والإجماع
// ليس مرساة ثقة.

pub mod agent;
pub mod agents;
pub mod agent_loop;
pub mod budget;
pub mod cancel;
pub mod claim;
pub mod clock;
pub mod contract;
pub mod completion;
pub mod conflict;
pub mod delegation;
pub mod denial_policy;
pub mod evidence;
pub mod fulfilment;
pub mod graph;
pub mod handoff;
pub mod ipc;
pub mod loopguard;
pub mod message;
pub mod mission;
pub mod model_adapter;
pub mod output_facts;
pub mod model_fixture;
pub mod port;
pub mod probe_runner;
pub mod prompt;
pub mod recovery;
pub mod repository;
pub mod security;
pub mod skill_use;
pub mod retry;
pub mod runtime;
pub mod runtime_state;
pub mod service;
pub mod specialist;
pub mod task;
pub mod thread;
pub mod tool_selection;
pub mod trust;
pub mod trusted_test_evidence;
pub mod truth;
pub mod verification;
pub mod view;
pub mod watch;
