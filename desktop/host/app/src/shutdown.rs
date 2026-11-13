// إنهاء العمليات الفرعية عند الخروج على Windows.
//
// WebView2 يُنشئ عمليات فرعية (المتصفح، الرسوميات، معالج الأعطال...) لا يملك
// هذا الثنائي عليها مقبضًا مباشرًا، وبعضها قد يتأخر عن الانتهاء بضع مئات من
// المللي ثانية بعد إغلاق النافذة الرئيسية — خصوصًا في أول إقلاع بارد حين تُنشئ
// عمليات إضافية لا تتكرر في الإقلاعات اللاحقة. المنتج هو من يملك دورة حياة ما
// أنشأه، لا نافذة زمنية في أداة قياس خارجية، فهذا الملف يعدّ ذرية عمليتنا كلها
// (Phase-08: لا الأبناء المباشرين وحدهم)، يمهلها مهلة قصيرة لتُنهي نفسها، ثم يُنهيها قسرًا إن بقيت حية.

use std::mem::size_of;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_TIMEOUT};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
};

/// المهلة الكلية المسموح بها لخروج طبيعي قبل الإنهاء القسري.
const GRACE_PERIOD: Duration = Duration::from_millis(3000);
/// خطوة الفحص أثناء المهلة.
const POLL_STEP: Duration = Duration::from_millis(100);

/// كل ذرية عمليتنا وقت الاستدعاء، الأعمق أولًا. لا الأبناء المباشرون وحدهم: قِيس في Phase-08 أن
/// عمليات WebView2 المساعدة (أحفاد عملية المتصفح) بقيت حيّة بعد خروج المضيف حين أُنهي الابن المباشر
/// قسرًا، فعدّها القياس الخارجي يتيمة. الذرية تُجمع من لقطة واحدة بعلاقة الأب، بعمق محدود.
fn descendants(root_id: u32) -> Vec<u32> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == -1isize as HANDLE {
        return Vec::new();
    }
    let mut pairs: Vec<(u32, u32)> = Vec::new();
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while has_entry {
        pairs.push((entry.th32ProcessID, entry.th32ParentProcessID));
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    let mut ordered: Vec<u32> = Vec::new();
    let mut frontier = vec![root_id];
    for _ in 0..MAX_DEPTH {
        let next: Vec<u32> = pairs
            .iter()
            .filter(|(pid, parent)| frontier.contains(parent) && *pid != root_id && !ordered.contains(pid))
            .map(|(pid, _)| *pid)
            .collect();
        if next.is_empty() {
            break;
        }
        ordered.extend(next.iter().copied());
        frontier = next;
    }
    // الأعمق أولًا: حفيد يُنهى قبل أبيه فلا يُترك بلا أب لحظة.
    ordered.reverse();
    ordered
}

/// أقصى عمق تُتبع إليه الذرية.
const MAX_DEPTH: usize = 6;

/// مقبض عملية مفتوح طوال المهلة: المقبض يمنع إعادة استعمال المعرّف، فلا يُنهى أبدًا غير ما جُمع.
struct Owned(HANDLE);

impl Owned {
    fn open(process_id: u32) -> Option<Self> {
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, 0, process_id) };
        if handle.is_null() { None } else { Some(Self(handle)) }
    }

    fn alive(&self) -> bool {
        let state = unsafe { WaitForSingleObject(self.0, 0) };
        state == WAIT_TIMEOUT
    }

    fn terminate(&self) {
        unsafe { TerminateProcess(self.0, 1) };
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

/// يُستدعى من `RunEvent::Exit`، أي بعد أن قرر Tauri نفسه الخروج. لا يمنع
/// الخروج ولا يؤخره فوق المهلة، ولا يفعل شيئًا إن لم يبق ابن حي.
pub fn reap_children() {
    let parent_id = unsafe { GetCurrentProcessId() };
    let mut remaining: Vec<Owned> = descendants(parent_id).into_iter().filter_map(Owned::open).collect();
    if remaining.is_empty() {
        return;
    }

    let deadline = Instant::now() + GRACE_PERIOD;
    while Instant::now() < deadline {
        remaining.retain(Owned::alive);
        if remaining.is_empty() {
            return;
        }
        std::thread::sleep(POLL_STEP);
    }

    // ما بقي بعد المهلة يُنهى قسرًا (الأعمق أولًا)، ثم يُعاد الجمع مرّة: عملية وُلدت أثناء المهلة لا تنجو.
    for process in &remaining {
        process.terminate();
    }
    for process in descendants(parent_id).into_iter().filter_map(Owned::open) {
        process.terminate();
    }
}
