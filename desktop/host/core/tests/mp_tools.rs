// MP-TOOLS — أداة لا تعمل الآن لا تُعرض على النموذج (تكليف مكافأة Manus، 2026-10-19).
//
// قِيس في النسخة التنفيذية المعزولة (791FF242…) مع Bonsai 2: طلب «status.docx وbudget.xlsx» على تثبيت جديد عرض على النموذج
// `polaris.execution.python` وبيئة Python لم تُجهَّز بعد، فنادى الأداة أربع مرات وكلها FAILED «the Python runtime has not been prepared»
// بينما أداة الجداول الأصلية متاحة. السبب الجذري: أداتا التشغيل لا تنفّذان `offered()` (ADR-042) فتُعرضان دائمًا.

mod p08_support;

use std::sync::Arc;

use p08_support::{build, build_with_platform, UnconfinedTestSandbox};
use polaris_host_core::p08::execution::runtime::RuntimeCatalog;
use polaris_host_core::p08::service::SKILL_AGENTIC_WORK;

fn offered(h: &p08_support::Harness) -> Vec<String> {
    h.host().phase04().expect("phase-04").tools_for_skill(SKILL_AGENTIC_WORK)
}

#[test]
fn mp_tools_an_unprepared_runtime_is_not_offered_to_the_model() {
    let empty = RuntimeCatalog { powershell: None, python_source: None, runtimes_root: None };
    let h = build_with_platform(None, Arc::new(UnconfinedTestSandbox::new()), empty);
    let tools = offered(&h);
    assert!(!tools.iter().any(|t| t == "polaris.execution.python"), "Python is offered without a prepared runtime: {tools:?}");
    assert!(!tools.iter().any(|t| t == "polaris.execution.command"), "PowerShell is offered without PowerShell: {tools:?}");
    assert!(tools.iter().any(|t| t == "polaris.artifact.spreadsheet"), "the native spreadsheet tool must stay offered: {tools:?}");
}

#[test]
fn mp_tools_a_prepared_runtime_is_offered() {
    // المضيف الاختباري يجهّز بيئة Python وهمية في مجلد بياناته.
    let h = build(None);
    assert!(offered(&h).iter().any(|t| t == "polaris.execution.python"), "a prepared Python runtime is not offered");
}
