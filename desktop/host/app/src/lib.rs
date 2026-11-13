// ربط Tauri. رقيق عمدًا: كل قرار أمني يقع في `polaris-host-core`، وهذا الملف
// يفتح نافذة ويسلّم الرسائل إلى البوابة دون أن يفسّر أيًّا منها.
//
// ما يبرّر وجوده أصلًا هو ما لا تستطيع النواة فعله: سؤال نظام التشغيل عن اللغة
// والمظهر، وإنشاء النافذة، وقياس زمن الإقلاع. وما عدا ذلك يمرّ كما هو.

use std::sync::{Arc, OnceLock};
use std::time::Instant;

use polaris_host_core::ipc::gateway::Gateway;
use polaris_host_core::ipc::identity::TransportIdentity;
use polaris_host_core::services::host::DesktopHost;
use polaris_host_core::services::platform_info::PlatformInfoService;
use serde_json::{json, Value};
use tauri::Manager;

#[cfg(windows)]
mod credentials;
#[cfg(windows)]
mod desktop_win32;
#[cfg(feature = "e2e")]
mod e2e_config;
mod ids;
mod notify_win32;
#[cfg(feature = "e2e")]
mod p03_native;
#[cfg(feature = "e2e")]
mod p04_native;
#[cfg(feature = "e2e")]
mod p05_native;
#[cfg(feature = "e2e")]
mod p06_native;
mod p08_platform;
mod platform;
#[cfg(windows)]
mod shutdown;
mod single_instance;
mod startup;
mod window;

use startup::StartupReport;

/// لحظة بدء العملية. تُثبَّت في أول سطر من `main` قبل أي عمل آخر.
static PROCESS_START: OnceLock<Instant> = OnceLock::new();

pub fn mark_process_start() {
    let _ = PROCESS_START.set(Instant::now());
}

fn elapsed_ms() -> u128 {
    PROCESS_START.get().map(|start| start.elapsed().as_millis()).unwrap_or(0)
}

/// حالة التطبيق: بوابة واحدة، وتقرير إقلاع اختياري.
pub struct AppState {
    gateway: Arc<Gateway>,
    startup: Arc<StartupReport>,
    /// قفل المثيل الواحد، محمول طوال عمر التطبيق ويُحرَّر بخروجه ولو بانهيار.
    _instance: Option<polaris_host_core::storage::lock::InstanceLock>,
}

/// الأمر الوحيد الذي يستطيع العارض استدعاءه.
///
/// لا يأخذ اسم عملية كوسيط منفصل ولا يفرّع على شيء: يأخذ ظرفًا واحدًا ويسلّمه
/// للبوابة. لو أخذ اسم دالة أو مسارًا لصار المُرسِل العامّ الذي تمنعه المعمارية.
///
/// ADR-019 D8: غير متزامن، والبوابة تعمل على خيط حجز منفصل. استدعاء نموذج قد
/// يستغرق ثواني، ويجب ألّا يحجز خيط الواجهة ولا يمنع وصول طلب الإلغاء أثناءه.
#[tauri::command]
async fn polaris_ipc(state: tauri::State<'_, AppState>, envelope: Value) -> Result<Value, ()> {
    let gateway = state.gateway.clone();
    let startup = state.startup.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let outcome = gateway.handle(&envelope);
        // القياس لا يُجمع أصلًا ما لم يُطلب: المنتج لا يدفع كلفة أداة قياس لا أحد يقرؤها.
        if startup.enabled() {
            if let Some(operation) = envelope.get("operation").and_then(Value::as_str) {
                startup.observe(operation, elapsed_ms(), started.elapsed().as_millis());
            }
        }
        outcome.response
    })
    .await
    // فشل الخيط نفسه يُرفض كفشل نقل، لا كردّ مصطنع.
    .map_err(|_| ())
}

/// أداة قياس E2E. تُترجَم فقط مع الميزة `e2e`، فلا وجود لها في ثنائي المنتج:
/// ليست محجوبة وقت التشغيل، بل غير مُترجَمة أصلًا.
#[cfg(feature = "e2e")]
#[tauri::command]
fn polaris_e2e_report(state: tauri::State<'_, AppState>, report: Value) -> bool {
    state.startup.write_e2e(&report)
}

/// المسار الأصلي الموثوق لطبقة القياس: تسجيل مسبار، وقراءة أثر التوجيه.
///
/// يأخذ اسم فعل من قائمة مغلقة، ولا يقبل نتيجة ولا محتوى دليل ولا بصمة. القياس
/// يقع في الطبقة الأصلية، والقرار قرارها. غير مُترجَم في ثنائي المنتج.
#[cfg(feature = "e2e")]
#[tauri::command]
fn polaris_e2e_native(state: tauri::State<'_, AppState>, action: String, mission_id: String) -> Value {
    p03_native::handle(state.gateway.host(), &action, &mission_id)
}

/// المسار الأصلي الموثوق لطبقة قياس Phase-04: قراءة ما لا مسار له من الواجهة.
///
/// يأخذ اسم فعل من قائمة مغلقة ووسيطًا واحدًا، ولا يقبل نتيجة أداة ولا دليلًا ولا
/// موافقة. غير مُترجَم في ثنائي المنتج.
#[cfg(feature = "e2e")]
#[tauri::command]
fn polaris_e2e_p04(state: tauri::State<'_, AppState>, action: String, argument: String) -> Value {
    p04_native::handle(state.gateway.host(), &action, &argument)
}

/// المسار الأصلي الموثوق لطبقة قياس Phase-05: أزمنة، وبقايا ذاكرة محذوفة، وحالة السجل.
///
/// فعل من قائمة مغلقة ووسيط واحد، ولا يقبل فعل متصفّح ولا فعل حاسوب ولا ذاكرة ولا
/// موافقة. غير مُترجَم في ثنائي المنتج.
#[cfg(feature = "e2e")]
#[tauri::command]
fn polaris_e2e_p05(state: tauri::State<'_, AppState>, action: String, argument: String) -> Value {
    p05_native::handle(state.gateway.host(), &action, &argument)
}

/// المسار الأصلي الموثوق لطبقة قياس Phase-06: أزمنة البوابة، وقياس داخل العملية، وعدّ
/// ظهور مفتاح الاختبار في المخزن والتشخيص، والنداءات الجارية.
///
/// فعل من قائمة مغلقة ووسيط واحد، ولا يقبل نداء موصل ولا إعدادًا ولا موافقة ولا مفتاحًا.
/// غير مُترجَم في ثنائي المنتج.
#[cfg(feature = "e2e")]
#[tauri::command]
fn polaris_e2e_p06(state: tauri::State<'_, AppState>, action: String, argument: String) -> Value {
    p06_native::handle(state.gateway.host(), &action, &argument)
}

/// نافذة إدخال المفتاح تُعرض مشروطة بالنافذة الرئيسية.
#[cfg(windows)]
fn remember_credential_parent(main: &tauri::WebviewWindow) {
    if let Ok(handle) = main.hwnd() {
        credentials::set_parent_window(handle.0);
    }
}

/// يربط إشعار النظام بالنافذة الرئيسة (ADR-042). القرار في النواة، والعرض هنا.
#[cfg(windows)]
fn bind_notifications(app: &tauri::App, main: &tauri::WebviewWindow) {
    let (Some(state), Ok(handle)) = (app.try_state::<AppState>(), main.hwnd()) else { return };
    if let Some(p08) = state.gateway.host().phase08() {
        p08.notifications.bind(std::sync::Arc::new(notify_win32::Win32Notifier { hwnd: handle.0 as isize }));
    }
}

#[cfg(not(windows))]
fn bind_notifications(_: &tauri::App, _: &tauri::WebviewWindow) {}

#[cfg(not(windows))]
fn remember_credential_parent(_: &tauri::WebviewWindow) {}

/// عند الخروج: إنهاء ما تبقّى حيًّا من عمليات WebView2 الفرعية. لا وجود لها
/// خارج Windows، فلا شيء يُفعل.
#[cfg(windows)]
fn reap_children_on_exit() {
    shutdown::reap_children();
}

#[cfg(not(windows))]
fn reap_children_on_exit() {}

/// منافذ Phase-05 على هذه المنصّة: منفذ Win32 الحقيقي على Windows، و«غير متاح»
/// خارجه. سياسة التنقّل هي سياسة المنتج بلا تجهيزة، إلا في بناء القياس حيث يُسمّى
/// أصل تجهيزة الويب على الحلقة المحلية صراحةً — ولا يُسمّى غيره.
fn phase05_platform() -> polaris_host_core::services::host::Phase05Platform {
    use polaris_host_core::p05::browser::url_policy::NavigationPolicy;
    #[cfg(windows)]
    let desktop: Arc<dyn polaris_host_core::p05::computer::port::DesktopPort> = Arc::new(desktop_win32::Win32Desktop);
    #[cfg(not(windows))]
    let desktop: Arc<dyn polaris_host_core::p05::computer::port::DesktopPort> =
        Arc::new(polaris_host_core::p05::computer::port::UnavailableDesktop("desktop control is implemented on Windows only"));
    #[cfg(feature = "e2e")]
    let navigation = match e2e_config::web_fixture_port() {
        Some(port) => NavigationPolicy::with_fixture_origins(&[(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), port)]),
        None => NavigationPolicy::product(),
    };
    #[cfg(not(feature = "e2e"))]
    let navigation = NavigationPolicy::product();
    polaris_host_core::services::host::Phase05Platform { desktop, navigation }
}

/// يبني المضيف وبوابته. مجلد البيانات يأتي من الإطار، ويُستبدل للاختبار الأصلي.
fn build_state(app_local_data: Option<std::path::PathBuf>, instance: Option<polaris_host_core::storage::lock::InstanceLock>) -> AppState {
    let platform = PlatformInfoService::new(window::system_locale_tag(), window::system_appearance());
    let data_dir = platform::data_dir(app_local_data);
    let diagnostics_file = data_dir.as_ref().map(|dir| dir.join("logs").join("host-diagnostics.log"));
    let config = platform::phase02_config(data_dir);
    let host = DesktopHost::with_platforms(platform, config, phase05_platform(), p08_platform::phase08_platform());
    // Phase-07: السياسة المُدارة تُقرأ مرة عند الإقلاع وتصير حدودًا في طبقة الأمان.
    let policy = polaris_host_core::p07::policy::load_policy(platform::managed_policy_path().as_deref());
    host.apply_managed_policy(&policy);
    let identity = TransportIdentity {
        principal_id: ids::new_uuid_v4(),
        session_id: ids::new_uuid_v4(),
    };
    let gateway = Gateway::new(host, identity, Box::new(ids::new_uuid_v4));
    let gateway = Arc::new(match diagnostics_file {
        Some(path) => gateway.with_diagnostics_file(path),
        None => gateway,
    });
    start_scheduler(&gateway);
    AppState { gateway, startup: Arc::new(StartupReport::from_environment()), _instance: instance }
}

/// نبضة المجدول: كل ثلاثين ثانية يُطلق ما حان من المهامّ المجدولة. المهمّة المُطلقة مهمّة
/// عادية تمرّ بالبوابة نفسها؛ النبضة لا تمنح إذنًا ولا تتجاوز موافقة.
fn start_scheduler(gateway: &Arc<Gateway>) {
    let Some(scheduler) = gateway.host().phase08().map(|p| p.scheduler.clone()) else { return };
    let _ = std::thread::Builder::new().name("polaris-scheduler".into()).spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        let _ = scheduler.tick();
    });
}

pub fn run() {
    // قبل أي WebView2: مجلد بيانات مستبدَل يأخذ ملف متصفّحه معه (D-1).
    platform::isolate_webview_profile();
    let builder = tauri::Builder::default()
        .setup(|app| {
            let app_local_data = app.path().app_local_data_dir().ok();
            // نسخة ثانية على المجلد نفسه تُظهر الأولى وتخرج قبل أن تفتح القاعدة.
            let instance = match single_instance::claim(platform::data_dir(app_local_data.clone()).as_deref()) {
                single_instance::Claim::Held(lock) => Some(lock),
                single_instance::Claim::Unguarded => None,
                single_instance::Claim::Busy => {
                    single_instance::focus_existing(&app.config().product_name.clone().unwrap_or_else(|| "POLARIS".into()));
                    std::process::exit(0);
                }
            };
            app.manage(build_state(app_local_data, instance));
            if let Some(main) = app.get_webview_window("main") {
                window::apply_startup_rules(&main);
                remember_credential_parent(&main);
                bind_notifications(app, &main);
            }
            Ok(())
        })
        // الحد الأدنى للنافذة يُفرض بعد كل تغيير حجم، لا عند السحب وحده.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Resized(size) = event {
                window::enforce_min_size(window, *size);
            }
        })
        // أصل الصفحة المحمَّلة يُسجَّل فقط حين يُطلب التقرير. هذا ما يميّز واجهة
        // محزومة (http://tauri.localhost) من خادم تطوير (http://localhost:5173)
        // دون الاعتماد على لقطة شاشة.
        .on_page_load(|webview, payload| {
            if let Some(state) = webview.try_state::<AppState>() {
                if state.startup.enabled() {
                    state.startup.observe_navigation(startup::page_origin(payload.url()));
                }
            }
        });

    #[cfg(feature = "e2e")]
    let builder =
        builder.invoke_handler(tauri::generate_handler![
            polaris_ipc,
            polaris_e2e_report,
            polaris_e2e_native,
            polaris_e2e_p04,
            polaris_e2e_p05,
            polaris_e2e_p06
        ]);
    #[cfg(not(feature = "e2e"))]
    let builder = builder.invoke_handler(tauri::generate_handler![polaris_ipc]);

    #[cfg(feature = "e2e")]
    let builder = builder.append_invoke_initialization_script(e2e_config::init_script());

    // ليس `.run(context)` المختصر: هذا يُسقط `RunEvent::Exit`، واللحظة الوحيدة
    // الصحيحة لإنهاء عمليات WebView2 المتبقية هي بعد أن يقرر tauri نفسه الخروج.
    let app = builder.build(tauri::generate_context!()).expect("the POLARIS desktop host failed to start");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // قبل أن ينهي الإطار العملية: يُدمج سجل الكتابة في الملف (D-6). الفشل لا يمنع الخروج؛ السجل يبقى ويُعاد عند الفتح.
            if let Some(state) = app_handle.try_state::<AppState>() {
                if let Some(phase02) = state.gateway.host().phase02() {
                    let _ = phase02.db.checkpoint();
                }
            }
            reap_children_on_exit();
        }
    });
}

/// حقائق تُستعمل في اختبار الربط نفسه.
pub fn binding_facts() -> Value {
    json!({
        "command_count": if cfg!(feature = "e2e") { 6 } else { 1 },
        "e2e_instrumentation": cfg!(feature = "e2e"),
    })
}
