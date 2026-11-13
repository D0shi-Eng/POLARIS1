// نقطة الدخول. أول سطر يثبّت لحظة بدء العملية، فقياس الإقلاع البارد يبدأ من هنا
// لا من لحظة جاهزية النافذة.

// يمنع فتح نافذة طرفية خلف التطبيق على Windows في بناء الإصدار.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    polaris_host_lib::mark_process_start();
    polaris_host_lib::run();
}
