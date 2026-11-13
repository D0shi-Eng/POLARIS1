// استعمال المتصفّح: سياسة تنقّل، ومحرّك جلب، وقارئ HTML، وتصنيف أثر النقر،
// وملاحظة محدودة، وجلسات مربوطة بمهامّها، ومحوّلات أدوات تمرّ ببوابة Phase-04.
//
// محتوى كل صفحة WEB_UNTRUSTED، مهما كانت الصفحة. ولا مسار إلى هذا المتصفّح إلا
// اقتراح أداة يقرّره زمن التشغيل وتنفّذه البوابة.

pub mod classify;
pub mod engine;
pub mod html;
pub mod observation;
pub mod runtime;
pub mod store;
pub mod tools;
pub mod url_policy;
