// منفذ الصندوق على ويندوز: AppContainer (هوية بلا أذونات) + كائن مهمّة (حدود وقتل الشجرة).
//
// هذا تطبيق ADR-001 (المرشّح A، المعتمد بأدلّة W1): الملفّ التعريفي لكل مهمّة
// `POLARIS.Exec.<mission>` يُنشأ بلا قدرات، فلا شبكة ولا وصول إلى ملفات المستخدم. ما
// تحتاجه العملية يُمنح صراحةً وبأضيق شكل: تعديل على مساحة المهمّة وحدها، وقراءة وتنفيذ
// على نسخة بيئة التشغيل التي يملكها POLARIS (تُمنح لكل الحاويات مرة واحدة، لأنها
// لا تحمل شيئًا خاصًّا). الشبكة قدرة `internetClient` لا تُضاف إلا حين يُوافَق عليها،
// وهي فئة لا وجهة: هذا حدّ معروف ومُعلن (ADR-001، الشبكة بالوجهة غير مُعبَّر عنها هنا).
//
// ما لا يغلقه هذا الصندوق، ويُعلن ولا يُخفى: قراءة ملفات النظام التي يمنحها ويندوز لكل
// الحاويات (ALL APPLICATION PACKAGES)، والقنوات غير الملفّية وغير الشبكية (ALPC، الأنابيب
// المسمّاة العامة). انظر PHASE-08-SECURITY.

use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use polaris_host_core::p08::execution::{SandboxEnd, SandboxError, SandboxOutcome, SandboxPort, SandboxRequest};
use windows_sys::Win32::Foundation::{LocalFree, ERROR_SUCCESS};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, GRANT_ACCESS, NO_MULTIPLE_TRUSTEE, REVOKE_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID,
    TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::Isolation::{CreateAppContainerProfile, DeleteAppContainerProfile, DeriveAppContainerSidFromAppContainerName};
use windows_sys::Win32::Security::{CreateWellKnownSid, FreeSid, WinCapabilityInternetClientSid, ACL, DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_CAPABILITIES, SECURITY_MAX_SID_SIZE, SID_AND_ATTRIBUTES, SUB_CONTAINERS_AND_OBJECTS_INHERIT};
use windows_sys::Win32::Storage::FileSystem::{DELETE, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE};

use crate::process::{create_job, exit_code, job_peak_memory, job_process_counts, read_pipe, spawn_in_job, terminate_job, wait_slice, wide, JobLimits, Launch};

/// HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS).
const HRESULT_ALREADY_EXISTS: i32 = 0x8007_00B7_u32 as i32;
/// معرّف «كل حزم التطبيقات» (ALL APPLICATION PACKAGES).
const ALL_APPLICATION_PACKAGES: &str = "S-1-15-2-1";
const SE_GROUP_ENABLED: u32 = 0x0000_0004;

/// معرّف أمان يملكه هذا الملف، يُحرَّر بالطريقة التي أُنشئ بها.
struct Sid {
    ptr: PSID,
    local_free: bool,
}

impl Drop for Sid {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            unsafe {
                if self.local_free {
                    LocalFree(self.ptr as _);
                } else {
                    FreeSid(self.ptr);
                }
            }
        }
    }
}

fn profile_name(mission_id: &str) -> String {
    // 13 + 32 = 45 محرفًا، ضمن حدّ 64 لاسم الحاوية.
    format!("POLARIS.Exec.{}", mission_id.replace('-', ""))
}

/// ينشئ ملفّ الحاوية أو يشتقّ معرّفه إن كان قائمًا (الاسم مملوك لـPOLARIS ومحدَّد بالمهمّة).
fn container_sid(name: &str) -> Result<Sid, SandboxError> {
    let wide_name = wide(name);
    let display = wide("POLARIS mission sandbox");
    let mut sid: PSID = std::ptr::null_mut();
    let hr = unsafe { CreateAppContainerProfile(wide_name.as_ptr(), display.as_ptr(), display.as_ptr(), std::ptr::null(), 0, &mut sid) };
    if hr >= 0 && !sid.is_null() {
        return Ok(Sid { ptr: sid, local_free: false });
    }
    if hr == HRESULT_ALREADY_EXISTS {
        let hr = unsafe { DeriveAppContainerSidFromAppContainerName(wide_name.as_ptr(), &mut sid) };
        if hr >= 0 && !sid.is_null() {
            return Ok(Sid { ptr: sid, local_free: false });
        }
        return Err(SandboxError::Unavailable(format!("DeriveAppContainerSidFromAppContainerName returned 0x{hr:08x}")));
    }
    Err(SandboxError::Unavailable(format!("CreateAppContainerProfile returned 0x{hr:08x}")))
}

fn string_sid(text: &str) -> Result<Sid, SandboxError> {
    let w = wide(text);
    let mut sid: PSID = std::ptr::null_mut();
    if unsafe { ConvertStringSidToSidW(w.as_ptr(), &mut sid) } == 0 {
        return Err(SandboxError::Unavailable(format!("the SID {text} could not be built")));
    }
    Ok(Sid { ptr: sid, local_free: true })
}

/// يضيف (أو يسحب) حقّ معرّف على مجلد، بوراثة إلى كل ما تحته.
fn set_access(path: &Path, sid: &Sid, mask: u32, grant: bool) -> Result<(), SandboxError> {
    let object = wide(&path.to_string_lossy());
    unsafe {
        let mut old_dacl: *mut ACL = std::ptr::null_mut();
        let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        let status = GetNamedSecurityInfoW(object.as_ptr(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, std::ptr::null_mut(), std::ptr::null_mut(), &mut old_dacl, std::ptr::null_mut(), &mut descriptor);
        if status != ERROR_SUCCESS {
            return Err(SandboxError::Unavailable(format!("GetNamedSecurityInfoW failed with {status}")));
        }
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: mask,
            grfAccessMode: if grant { GRANT_ACCESS } else { REVOKE_ACCESS },
            grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
            Trustee: TRUSTEE_W { pMultipleTrustee: std::ptr::null_mut(), MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE, TrusteeForm: TRUSTEE_IS_SID, TrusteeType: TRUSTEE_IS_UNKNOWN, ptstrName: sid.ptr as *mut u16 },
        };
        let mut new_dacl: *mut ACL = std::ptr::null_mut();
        let status = SetEntriesInAclW(1, &entry, old_dacl, &mut new_dacl);
        if status != ERROR_SUCCESS {
            LocalFree(descriptor as _);
            return Err(SandboxError::Unavailable(format!("SetEntriesInAclW failed with {status}")));
        }
        let status = SetNamedSecurityInfoW(object.as_ptr() as *mut u16, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, std::ptr::null_mut(), std::ptr::null_mut(), new_dacl, std::ptr::null());
        LocalFree(new_dacl as _);
        LocalFree(descriptor as _);
        if status != ERROR_SUCCESS {
            return Err(SandboxError::Unavailable(format!("SetNamedSecurityInfoW failed with {status}")));
        }
    }
    Ok(())
}

const READ_EXECUTE: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
const MODIFY: u32 = FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE;

/// منفذ ويندوز الحقيقي.
pub struct Win32Sandbox {
    /// مساحات منحت هويتها تعديلًا عليها في هذا التشغيل (المنح عملية مكلفة تُنشر على الشجرة).
    prepared: Mutex<HashSet<String>>,
    /// جذور بيئات تشغيل منحت قراءة لكل الحاويات.
    runtimes: Mutex<HashSet<String>>,
    system_root: String,
}

impl Win32Sandbox {
    pub fn new() -> Self {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        Self { prepared: Mutex::new(HashSet::new()), runtimes: Mutex::new(HashSet::new()), system_root }
    }

    fn environment(&self, request: &SandboxRequest) -> Vec<(String, String)> {
        let temp = request.temp_directory.to_string_lossy().into_owned();
        let system32 = format!("{}\\System32", self.system_root);
        let mut path = vec![system32.clone(), self.system_root.clone(), format!("{system32}\\WindowsPowerShell\\v1.0")];
        for root in &request.read_only_roots {
            path.push(root.to_string_lossy().into_owned());
            path.push(root.join("Scripts").to_string_lossy().into_owned());
        }
        // بيئة مبنية صراحةً: لا اسم يرثه الابن من POLARIS، وكل مجلد شخصي أو مؤقت يشير إلى المساحة.
        let mut env: Vec<(String, String)> = vec![
            ("SystemRoot".into(), self.system_root.clone()),
            ("windir".into(), self.system_root.clone()),
            ("SystemDrive".into(), self.system_root.chars().take(2).collect()),
            ("ComSpec".into(), format!("{system32}\\cmd.exe")),
            ("PATHEXT".into(), ".COM;.EXE;.BAT;.CMD;.PS1;.PY".into()),
            ("PATH".into(), path.join(";")),
            ("TEMP".into(), temp.clone()),
            ("TMP".into(), temp.clone()),
            ("USERPROFILE".into(), temp.clone()),
            ("HOME".into(), temp.clone()),
            ("APPDATA".into(), temp.clone()),
            ("LOCALAPPDATA".into(), temp.clone()),
            ("USERNAME".into(), "polaris-sandbox".into()),
            ("USERDOMAIN".into(), "POLARIS".into()),
            ("NUMBER_OF_PROCESSORS".into(), std::env::var("NUMBER_OF_PROCESSORS").unwrap_or_else(|_| "1".into())),
            ("PROCESSOR_ARCHITECTURE".into(), std::env::var("PROCESSOR_ARCHITECTURE").unwrap_or_else(|_| "AMD64".into())),
            ("PSModulePath".into(), format!("{system32}\\WindowsPowerShell\\v1.0\\Modules")),
        ];
        env.extend(request.environment.iter().cloned());
        env
    }

    fn prepare(&self, request: &SandboxRequest, sid: &Sid) -> Result<(), SandboxError> {
        let key = format!("{}|{}", request.mission_id, request.writable_root.to_string_lossy());
        let fresh = self.prepared.lock().map(|mut s| s.insert(key.clone())).unwrap_or(true);
        if fresh {
            if let Err(e) = set_access(&request.writable_root, sid, MODIFY, true) {
                if let Ok(mut s) = self.prepared.lock() {
                    s.remove(&key);
                }
                return Err(e);
            }
        }
        for root in &request.read_only_roots {
            let key = root.to_string_lossy().into_owned();
            let fresh = self.runtimes.lock().map(|mut s| s.insert(key.clone())).unwrap_or(true);
            if fresh {
                let all = string_sid(ALL_APPLICATION_PACKAGES)?;
                if let Err(e) = set_access(root, &all, READ_EXECUTE, true) {
                    if let Ok(mut s) = self.runtimes.lock() {
                        s.remove(&key);
                    }
                    return Err(e);
                }
            }
        }
        Ok(())
    }
}

impl Default for Win32Sandbox {
    fn default() -> Self {
        Self::new()
    }
}

impl SandboxPort for Win32Sandbox {
    fn isolation(&self) -> &'static str {
        "APPCONTAINER+JOB"
    }

    fn run(&self, request: &SandboxRequest) -> Result<SandboxOutcome, SandboxError> {
        if request.cancel.is_cancelled() {
            return Ok(SandboxOutcome { end: SandboxEnd::Cancelled, exit_code: None, stdout: Vec::new(), stderr: Vec::new(), output_truncated: false, duration_ms: 0, processes_total: 0, survivors: 0, limit: None, isolation: self.isolation().into() });
        }
        if !request.program.is_file() {
            return Err(SandboxError::Launch("the program does not exist".into()));
        }
        let sid = container_sid(&profile_name(&request.mission_id))?;
        self.prepare(request, &sid)?;

        // قدرة الشبكة وحدها، وحين طُلبت ووُوفق عليها فقط.
        let mut capability_buffer = [0u8; SECURITY_MAX_SID_SIZE as usize];
        let mut capability = SID_AND_ATTRIBUTES { Sid: capability_buffer.as_mut_ptr() as PSID, Attributes: SE_GROUP_ENABLED };
        let mut capability_count = 0u32;
        if request.network {
            let mut size = SECURITY_MAX_SID_SIZE;
            if unsafe { CreateWellKnownSid(WinCapabilityInternetClientSid, std::ptr::null_mut(), capability_buffer.as_mut_ptr() as PSID, &mut size) } == 0 {
                return Err(SandboxError::Unavailable("the internetClient capability SID could not be built".into()));
            }
            capability.Sid = capability_buffer.as_mut_ptr() as PSID;
            capability_count = 1;
        }
        let capabilities = SECURITY_CAPABILITIES {
            AppContainerSid: sid.ptr,
            Capabilities: if capability_count == 1 { &mut capability } else { std::ptr::null_mut() },
            CapabilityCount: capability_count,
            Reserved: 0,
        };

        let job = create_job(JobLimits { memory_bytes: request.limits.memory_bytes, max_processes: request.limits.max_processes, cpu_percent: request.limits.cpu_percent, ui_restricted: true }).map_err(SandboxError::Unavailable)?;
        let environment = self.environment(request);
        let started = Instant::now();
        let spawned = spawn_in_job(
            &job,
            &Launch {
                program: &request.program.to_string_lossy(),
                arguments: &request.arguments,
                working_directory: &request.working_directory.to_string_lossy(),
                environment: &environment,
                security_capabilities: Some(&capabilities),
            },
        )
        .map_err(SandboxError::Launch)?;

        let budget = Arc::new(AtomicU64::new(request.limits.max_output_bytes));
        let exceeded = Arc::new(AtomicBool::new(false));
        let out_reader = read_pipe(spawned.stdout, budget.clone(), exceeded.clone());
        let err_reader = read_pipe(spawned.stderr, budget, exceeded.clone());

        let wall = Duration::from_millis(request.limits.wall_time_ms);
        let mut end = SandboxEnd::Exited;
        let mut limit = None;
        loop {
            if wait_slice(&spawned.process, Duration::from_millis(50)) {
                break;
            }
            if request.cancel.is_cancelled() {
                end = SandboxEnd::Cancelled;
                break;
            }
            if started.elapsed() >= wall {
                end = SandboxEnd::TimedOut;
                limit = Some("WALL_TIME".to_string());
                break;
            }
            if exceeded.load(Ordering::SeqCst) {
                end = SandboxEnd::LimitExceeded;
                limit = Some("OUTPUT_BYTES".to_string());
                break;
            }
        }
        let code = if end == SandboxEnd::Exited { exit_code(&spawned.process) } else { None };
        let peak = job_peak_memory(&job);
        let (total, _) = job_process_counts(&job);
        // الشجرة كلها تُنهى دائمًا: ابن تركه أمر في الخلفية لا يبقى بعد نتيجته.
        let survivors = terminate_job(&job, Duration::from_secs(5));
        drop(job);
        let stdout = out_reader.join().unwrap_or_default();
        let stderr = err_reader.join().unwrap_or_default();
        if end == SandboxEnd::Exited && peak >= request.limits.memory_bytes.saturating_sub(request.limits.memory_bytes / 50) {
            limit = Some("MEMORY".to_string());
        }
        Ok(SandboxOutcome {
            end,
            exit_code: code,
            stdout,
            stderr,
            output_truncated: exceeded.load(Ordering::SeqCst),
            duration_ms: started.elapsed().as_millis() as u64,
            processes_total: total,
            survivors,
            limit,
            isolation: if request.network { "APPCONTAINER+JOB+INTERNET_CLIENT".into() } else { self.isolation().into() },
        })
    }

    fn release(&self, mission_id: &str, writable_root: &Path) -> Result<(), SandboxError> {
        let name = profile_name(mission_id);
        let sid = container_sid(&name)?;
        let revoke = set_access(writable_root, &sid, MODIFY, false);
        drop(sid);
        let hr = unsafe { DeleteAppContainerProfile(wide(&name).as_ptr()) };
        if let Ok(mut s) = self.prepared.lock() {
            s.retain(|k| !k.starts_with(mission_id));
        }
        revoke?;
        if hr < 0 {
            return Err(SandboxError::Unavailable(format!("DeleteAppContainerProfile returned 0x{hr:08x}")));
        }
        Ok(())
    }
}
