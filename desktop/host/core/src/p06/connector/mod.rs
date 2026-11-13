// الموصلات (Phase-06): إطار عام نظيف، لا تكاملات مبعثرة داخل شيفرة الوكيل.
//
// واصف ومثيل وقدرة وحالة اعتماد وصحّة واستدعاء ونتيجة، ومحوّل مستقلّ لكل نوع (REST
// عامّ، ومساحة عمل المشروع)، وبوابة مركزية واحدة لا يتجاوزها محوّل.

pub mod gateway;
pub mod idempotency;
pub mod model;
pub mod openapi;
pub mod preset_table;
pub mod presets;
pub mod ratelimit;
pub mod rest;
pub mod secrets;
pub mod service;
pub mod store;
pub mod tool;
pub mod workspace;

pub use gateway::{ConnectorCall, ConnectorFailure, ConnectorGateway, GatewayDeps};
pub use service::ConnectorService;
