// تشغيل عملية محصورة في كائن مهمّة (Job Object) على ويندوز، مع أنابيب مخرجات محدودة.
//
// هذا الملف أحد مواضع `unsafe` المسمّاة في المنتج (مع credentials.rs وdesktop_win32.rs
// وshutdown.rs وsandbox_win32.rs). ما يفعله فقط: إنشاء كائن مهمّة بحدوده، وإطلاق
// عملية معلّقة، وإسنادها إلى الكائن قبل أن تنفّذ تعليمة واحدة، ثم استئنافها، وقراءة
// مخرجاتها بسقف، وإنهاء الشجرة كلها عند المهلة أو الإلغاء أو تجاوز الحدّ. المقابض
// الموروثة قائمة صريحة (PROC_THREAD_ATTRIBUTE_HANDLE_LIST): لا يرث الابن مقبضًا غير
// أنابيبه الثلاثة، وهو ما أثبت W1 أنه مسؤوليتنا لا مسؤولية نظام التشغيل.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
use windows_sys::Win32::Security::{SECURITY_ATTRIBUTES, SECURITY_CAPABILITIES};
use windows_sys::Win32::Storage::FileSystem::{CreateFileW, ReadFile, FILE_GENERIC_READ, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation, JobObjectBasicUIRestrictions, JobObjectCpuRateControlInformation, JobObjectExtendedLimitInformation,
    QueryInformationJobObject, SetInformationJobObject, TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_BASIC_UI_RESTRICTIONS, JOBOBJECT_CPU_RATE_CONTROL_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_CPU_RATE_CONTROL_ENABLE, JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP, JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
    JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_UILIMIT_DESKTOP, JOB_OBJECT_UILIMIT_DISPLAYSETTINGS, JOB_OBJECT_UILIMIT_EXITWINDOWS, JOB_OBJECT_UILIMIT_GLOBALATOMS,
    JOB_OBJECT_UILIMIT_HANDLES, JOB_OBJECT_UILIMIT_READCLIPBOARD, JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS, JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess, InitializeProcThreadAttributeList, ResumeThread, TerminateProcess, UpdateProcThreadAttribute, WaitForSingleObject,
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
    STARTF_USESTDHANDLES, STARTUPINFOEXW,
};

/// نصّ UTF-16 منتهٍ بصفر.
pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// يقتبس وسيطًا بقواعد مكتبة C في ويندوز: الشرطات المائلة قبل علامة اقتباس تُضاعف.
pub fn quote_argument(arg: &str) -> String {
    if !arg.is_empty() && !arg.chars().any(|c| matches!(c, ' ' | '\t' | '\n' | '\u{0b}' | '"')) {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            c => {
                out.push_str(&"\\".repeat(backslashes));
                backslashes = 0;
                out.push(c);
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

/// كتلة بيئة Unicode: `NAME=value\0...\0\0`، مرتّبة بلا حساسية للحالة كما يتوقّع ويندوز.
pub fn environment_block(vars: &[(String, String)]) -> Vec<u16> {
    let mut sorted: Vec<&(String, String)> = vars.iter().filter(|(k, _)| !k.is_empty() && !k.contains('=')).collect();
    sorted.sort_by_key(|(k, _)| k.to_uppercase());
    sorted.dedup_by(|a, b| a.0.eq_ignore_ascii_case(&b.0));
    let mut block = Vec::new();
    for (k, v) in sorted {
        block.extend(format!("{k}={v}").encode_utf16());
        block.push(0);
    }
    block.push(0);
    block
}

/// مقبض يُغلق عند الإسقاط.
pub struct OwnedHandle(pub HANDLE);

// مقبض نواة ويندوز صالح للاستعمال من أي خيط؛ الملكية وحدها تنتقل.
unsafe impl Send for OwnedHandle {}
unsafe impl Sync for OwnedHandle {}

impl OwnedHandle {
    pub fn valid(&self) -> bool {
        !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if self.valid() {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

fn last_error(what: &str) -> String {
    format!("{what} failed with Win32 error {}", unsafe { GetLastError() })
}

/// حدود كائن المهمّة.
#[derive(Debug, Clone, Copy)]
pub struct JobLimits {
    pub memory_bytes: u64,
    pub max_processes: u32,
    pub cpu_percent: u32,
    /// قيود الواجهة (الحافظة، سطح المكتب، الذرّات العامة…). تُطبَّق على عمليات الصندوق،
    /// ولا تُطبَّق على المتصفّح الذي يحتاج نوافذه.
    pub ui_restricted: bool,
}

/// ينشئ كائن مهمّة بحدوده. الإغلاق يقتل كل ما فيه (KILL_ON_JOB_CLOSE).
pub fn create_job(limits: JobLimits) -> Result<OwnedHandle, String> {
    unsafe {
        let job = OwnedHandle(CreateJobObjectW(std::ptr::null(), std::ptr::null()));
        if !job.valid() {
            return Err(last_error("CreateJobObjectW"));
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        info.BasicLimitInformation.ActiveProcessLimit = limits.max_processes;
        info.JobMemoryLimit = limits.memory_bytes as usize;
        if SetInformationJobObject(job.0, JobObjectExtendedLimitInformation, &info as *const _ as *const c_void, std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) == 0 {
            return Err(last_error("SetInformationJobObject(limits)"));
        }
        if limits.cpu_percent < 100 {
            let mut cpu: JOBOBJECT_CPU_RATE_CONTROL_INFORMATION = std::mem::zeroed();
            cpu.ControlFlags = JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
            cpu.Anonymous.CpuRate = limits.cpu_percent.clamp(1, 100) * 100;
            if SetInformationJobObject(job.0, JobObjectCpuRateControlInformation, &cpu as *const _ as *const c_void, std::mem::size_of::<JOBOBJECT_CPU_RATE_CONTROL_INFORMATION>() as u32) == 0 {
                return Err(last_error("SetInformationJobObject(cpu)"));
            }
        }
        if limits.ui_restricted {
            let ui = JOBOBJECT_BASIC_UI_RESTRICTIONS {
                UIRestrictionsClass: JOB_OBJECT_UILIMIT_DESKTOP
                    | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS
                    | JOB_OBJECT_UILIMIT_EXITWINDOWS
                    | JOB_OBJECT_UILIMIT_GLOBALATOMS
                    | JOB_OBJECT_UILIMIT_HANDLES
                    | JOB_OBJECT_UILIMIT_READCLIPBOARD
                    | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS
                    | JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
            };
            if SetInformationJobObject(job.0, JobObjectBasicUIRestrictions, &ui as *const _ as *const c_void, std::mem::size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32) == 0 {
                return Err(last_error("SetInformationJobObject(ui)"));
            }
        }
        Ok(job)
    }
}

/// عدّ العمليات في كائن المهمّة: الكلّي منذ الإنشاء، والحيّ الآن.
pub fn job_process_counts(job: &OwnedHandle) -> (u32, u32) {
    unsafe {
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = std::mem::zeroed();
        let ok = QueryInformationJobObject(job.0, JobObjectBasicAccountingInformation, &mut info as *mut _ as *mut c_void, std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32, std::ptr::null_mut());
        if ok == 0 {
            return (0, u32::MAX);
        }
        (info.TotalProcesses, info.ActiveProcesses)
    }
}

/// أعلى ذاكرة استعملتها المهمّة.
pub fn job_peak_memory(job: &OwnedHandle) -> u64 {
    unsafe {
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        let ok = QueryInformationJobObject(job.0, JobObjectExtendedLimitInformation, &mut info as *mut _ as *mut c_void, std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32, std::ptr::null_mut());
        if ok == 0 {
            0
        } else {
            info.PeakJobMemoryUsed as u64
        }
    }
}

/// ينهي كل عمليات المهمّة وينتظر حتى لا يبقى حيّ (أو تنقضي المهلة). يعيد الباقين.
pub fn terminate_job(job: &OwnedHandle, wait: Duration) -> u32 {
    unsafe {
        TerminateJobObject(job.0, 1);
    }
    let started = Instant::now();
    loop {
        let (_, active) = job_process_counts(job);
        if active == 0 || started.elapsed() >= wait {
            return active;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// ما يُطلب إطلاقه.
pub struct Launch<'a> {
    pub program: &'a str,
    pub arguments: &'a [String],
    pub working_directory: &'a str,
    pub environment: &'a [(String, String)],
    /// إن وُجدت: الهوية المعزولة (AppContainer) وقدراتها.
    pub security_capabilities: Option<&'a SECURITY_CAPABILITIES>,
}

/// عملية مُطلَقة داخل كائن مهمّة، وأنبوبا مخرجاتها.
pub struct Spawned {
    pub process: OwnedHandle,
    pub stdout: OwnedHandle,
    pub stderr: OwnedHandle,
}

fn pipe(sa: &SECURITY_ATTRIBUTES) -> Result<(OwnedHandle, OwnedHandle), String> {
    unsafe {
        let mut read: HANDLE = std::ptr::null_mut();
        let mut write: HANDLE = std::ptr::null_mut();
        if CreatePipe(&mut read, &mut write, sa, 64 * 1024) == 0 {
            return Err(last_error("CreatePipe"));
        }
        let read = OwnedHandle(read);
        let write = OwnedHandle(write);
        // طرف القراءة لا يُورَّث أبدًا.
        SetHandleInformation(read.0, HANDLE_FLAG_INHERIT, 0);
        Ok((read, write))
    }
}

/// يطلق العملية معلّقة، ويسندها إلى المهمّة، ثم يستأنفها. أي فشل بعد الإنشاء يقتلها.
pub fn spawn_in_job(job: &OwnedHandle, launch: &Launch<'_>) -> Result<Spawned, String> {
    unsafe {
        let sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: std::ptr::null_mut(), bInheritHandle: 1 };
        let (out_read, out_write) = pipe(&sa)?;
        let (err_read, err_write) = pipe(&sa)?;
        let nul = wide("NUL");
        let stdin = OwnedHandle(CreateFileW(nul.as_ptr(), FILE_GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, std::ptr::null_mut()));
        if !stdin.valid() {
            return Err(last_error("CreateFileW(NUL)"));
        }

        let attribute_count = if launch.security_capabilities.is_some() { 2 } else { 1 };
        let mut size: usize = 0;
        InitializeProcThreadAttributeList(std::ptr::null_mut(), attribute_count, 0, &mut size);
        let mut attribute_buffer = vec![0u8; size.max(64)];
        let attributes = attribute_buffer.as_mut_ptr() as *mut c_void;
        if InitializeProcThreadAttributeList(attributes, attribute_count, 0, &mut size) == 0 {
            return Err(last_error("InitializeProcThreadAttributeList"));
        }
        // القائمة الصريحة للمقابض الموروثة: الأنابيب الثلاثة لا غير.
        let inherited: [HANDLE; 3] = [stdin.0, out_write.0, err_write.0];
        let cleanup = |attrs: *mut c_void| DeleteProcThreadAttributeList(attrs);
        if UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize, inherited.as_ptr() as *const c_void, std::mem::size_of_val(&inherited), std::ptr::null_mut(), std::ptr::null()) == 0 {
            cleanup(attributes);
            return Err(last_error("UpdateProcThreadAttribute(handles)"));
        }
        if let Some(caps) = launch.security_capabilities {
            if UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize, caps as *const _ as *const c_void, std::mem::size_of::<SECURITY_CAPABILITIES>(), std::ptr::null_mut(), std::ptr::null()) == 0 {
                cleanup(attributes);
                return Err(last_error("UpdateProcThreadAttribute(security capabilities)"));
            }
        }

        let mut startup: STARTUPINFOEXW = std::mem::zeroed();
        startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = stdin.0;
        startup.StartupInfo.hStdOutput = out_write.0;
        startup.StartupInfo.hStdError = err_write.0;
        startup.lpAttributeList = attributes;

        let mut command_line = quote_argument(launch.program);
        for a in launch.arguments {
            command_line.push(' ');
            command_line.push_str(&quote_argument(a));
        }
        let mut command_line = wide(&command_line);
        let program = wide(launch.program);
        let cwd = wide(launch.working_directory);
        let environment = environment_block(launch.environment);
        let mut info: PROCESS_INFORMATION = std::mem::zeroed();
        let created = CreateProcessW(
            program.as_ptr(),
            command_line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
            environment.as_ptr() as *const c_void,
            cwd.as_ptr(),
            &startup.StartupInfo,
            &mut info,
        );
        cleanup(attributes);
        if created == 0 {
            return Err(last_error("CreateProcessW"));
        }
        let process = OwnedHandle(info.hProcess);
        let thread = OwnedHandle(info.hThread);
        // الإسناد قبل أي تعليمة: عملية تبدأ خارج المهمّة قد تنشئ ابنًا خارجها.
        if AssignProcessToJobObject(job.0, process.0) == 0 {
            let error = last_error("AssignProcessToJobObject");
            TerminateProcess(process.0, 1);
            return Err(error);
        }
        if ResumeThread(thread.0) == u32::MAX {
            let error = last_error("ResumeThread");
            TerminateProcess(process.0, 1);
            return Err(error);
        }
        drop(thread);
        // أطراف الكتابة في الأب تُغلق الآن، وإلا لا تصل نهاية الأنبوب أبدًا.
        drop(out_write);
        drop(err_write);
        drop(stdin);
        Ok(Spawned { process, stdout: out_read, stderr: err_read })
    }
}

/// قارئ أنبوب بسقف مشترك. ما زاد على السقف يُقرأ ويُهمل (فلا يتوقّف الابن)، ويُرفع العلم.
pub fn read_pipe(handle: OwnedHandle, budget: Arc<AtomicU64>, exceeded: Arc<AtomicBool>) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        // المقبض ينتقل كاملًا إلى الخيط (لا حقله الخام وحده) فيُغلق عند انتهائه.
        let handle = handle;
        let mut out = Vec::new();
        let mut buffer = [0u8; 16 * 1024];
        loop {
            let mut read: u32 = 0;
            let ok = unsafe { ReadFile(handle.0, buffer.as_mut_ptr(), buffer.len() as u32, &mut read, std::ptr::null_mut()) };
            if ok == 0 || read == 0 {
                break;
            }
            let n = read as u64;
            let mut granted = 0u64;
            // `fetch_update` أُعيدت تسميته `try_update` في 1.95؛ الحدّ الأدنى المعلن 1.89 فيبقى الاسم القديم.
            #[allow(deprecated)]
            let _ = budget.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                granted = left.min(n);
                Some(left - granted)
            });
            let keep = granted as usize;
            out.extend_from_slice(&buffer[..keep]);
            if keep < read as usize {
                exceeded.store(true, Ordering::SeqCst);
            }
        }
        out
    })
}

/// ينتظر العملية الرئيسية شريحةً شريحة. يعيد `true` إن انتهت.
pub fn wait_slice(process: &OwnedHandle, slice: Duration) -> bool {
    unsafe { WaitForSingleObject(process.0, slice.as_millis() as u32) == WAIT_OBJECT_0 }
}

pub fn exit_code(process: &OwnedHandle) -> Option<i64> {
    let mut code: u32 = 0;
    let ok = unsafe { GetExitCodeProcess(process.0, &mut code) };
    (ok != 0).then_some(code as i32 as i64)
}

/// يفتح عنوان https في المتصفّح الافتراضي للمستخدم (عنوان تفويض OAuth). لا مخطّط آخر، ولا ملف، ولا أمر.
pub fn open_https_url(url: &str) -> bool {
    if !url.starts_with("https://") || url.chars().any(|c| c.is_control() || c == '"') {
        return false;
    }
    let verb = wide("open");
    let target = wide(url);
    // SAFETY: السلاسل منتهية بصفر وتعيش حتى عودة الاستدعاء.
    let result = unsafe {
        windows_sys::Win32::UI::Shell::ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL)
    };
    (result as isize) > 32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_are_quoted_by_the_msvcrt_rules() {
        assert_eq!(quote_argument("plain"), "plain");
        assert_eq!(quote_argument("with space"), "\"with space\"");
        assert_eq!(quote_argument("a\"b"), "\"a\\\"b\"");
        assert_eq!(quote_argument("C:\\dir with\\"), "\"C:\\dir with\\\\\"");
        assert_eq!(quote_argument(""), "\"\"");
    }

    #[test]
    fn the_environment_block_is_sorted_deduplicated_and_double_terminated() {
        let block = environment_block(&[("b".into(), "2".into()), ("A".into(), "1".into()), ("a".into(), "dup".into()), ("bad=name".into(), "x".into())]);
        let text = String::from_utf16_lossy(&block);
        assert_eq!(text, "A=1\0b=2\0\0");
    }
}
