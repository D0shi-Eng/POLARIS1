// نظام المخرجات (Artifacts): كُتّاب الملفات وقرّاؤها والتحقق منها.
//
// كل كاتب هنا دالّة نقية من نموذج محتوى إلى بايتات: لا يكتب على القرص ولا يعرف
// مسارًا. الكتابة إلى مساحة المهمّة وتسجيل الواصف يقعان في طبقة المخرجات (store)،
// خلف بوابة الأدوات، فلا يستطيع كاتبٌ أن يختار أين يكتب.

pub mod chart;
pub mod docx;
pub mod extract;
pub mod pdf;
pub mod pptx;
mod pptx_parts;
pub mod service;
pub mod spec;
pub mod store;
pub mod text;
pub mod tools;
pub mod verify;
pub mod web;
pub mod xlsx;
pub mod xml;
pub mod zip;
#[cfg(test)]
mod output_tests;
