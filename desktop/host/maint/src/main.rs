// أداة الصيانة: فحص القاعدة، والنسخ الاحتياطي والاستعادة، والترقية، والاحتفاظ،
// وفحص السياسة المُدارة، والتحقق من بيان تحديث موقَّع.
//
// ملف تنفيذي رقيق: المنطق كله في `polaris_host_core::p07::maintenance` ويُختبر هناك.
// يطبع مستند JSON واحدًا على المخرج القياسي، ورمز الخروج 0 نجاح، 1 رفض، 2 استعمال خاطئ.

#![forbid(unsafe_code)]

fn main() {
    let arguments: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    if arguments.is_empty() {
        eprintln!("{}", polaris_host_core::p07::maintenance::USAGE);
        std::process::exit(2);
    }
    let (document, code) = polaris_host_core::p07::maintenance::execute(arguments);
    println!("{}", serde_json::to_string_pretty(&document).unwrap_or_else(|_| "{}".into()));
    std::process::exit(code);
}
