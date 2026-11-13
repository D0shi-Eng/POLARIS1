// MCP: تسجيل خادم، واكتشاف أدواته، وتنفيذها — كلها عبر بوابة الأدوات وحدها.
//
// ما لا يستطيعه خادم MCP في هذا البناء، مذكورًا صراحةً لأن غيابه هو الخاصيّة:
//   - لا يضيف أداة إلى السجل بنفسه؛ الاكتشاف يُطهِّر ويتحقّق ثم يقرّر السجل.
//   - لا يمنح نفسه أثرًا؛ السقف من المستخدم، ومِنحة زمن التشغيل فوقه.
//   - لا يصير وصفه تعليمة نظام؛ يبقى بيانات موسومة `MCP_UNTRUSTED`.
//   - لا يوافق على شيء؛ الموافقة من المستخدم عبر عملية مُسمّاة.
//   - لا يرى سرًّا؛ لا سرّ يسافر إلى خادم أدوات أصلًا.
//   - لا يبلغ وجهة خارج الحلقة المحلية.

pub mod adapter;
pub mod client;
pub mod discovery;
pub mod model;
pub mod sanitize;

pub use client::{McpClient, McpError};
pub use discovery::{discover, Discovery, RejectedTool};
pub use model::{McpServer, McpServerState, McpTransport};
