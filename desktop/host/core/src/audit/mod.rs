// سجل تدقيق المضيف لـPhase-02.
//
// سلسلة تجزئة داخل القاعدة نفسها، بالصنف الذي صرّح به Phase-00: HASH_CHAIN_ONLY.
// تكشف تعديل سجل أو حذفه أو إعادة ترتيبه، ولا تدّعي أكثر من ذلك: من يملك الملف
// يستطيع إعادة كتابة السلسلة كلها. لا سرّ ولا نصّ طلب كامل يدخل التفصيل.

pub mod events;
pub mod ledger;

pub use events::{AuditEventType, AuditOutcome, AuditRecord};
pub use ledger::{AuditLedger, ChainVerification};
