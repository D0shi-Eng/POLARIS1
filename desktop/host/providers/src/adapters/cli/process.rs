// تشغيل أداة سطر أوامر بوصفها نقل المزوّد.
//
// لا صدفة: الملف التنفيذي يُشغَّل مباشرة بوسائطه، والمُوجِّه يدخل على الإدخال المعياري لا في سطر الأمر (حدّ طول سطر
// الأمر في Windows نحو 32 ألف محرف). المهلة والإلغاء يقتلان العملية. المخرجات محدودة الحجم.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// أكبر مخرجات معيارية تُقبل من الأداة.
pub const MAX_STDOUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const POLL: Duration = Duration::from_millis(40);

#[derive(Debug)]
pub struct ProcessOutput {
    pub status: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ProcessFailure {
    /// الملف التنفيذي غير موجود.
    NotFound,
    Spawn(String),
    TimedOut,
    Cancelled,
    OutputTooLarge,
}

/// يقرأ حتى نهاية المجرى، ويحتفظ بأول `cap` بايت؛ الزائد يُقرأ ويُهمل كي لا تتوقف الأداة على أنبوب ممتلئ.
fn drain(mut source: impl Read, cap: usize) -> (Vec<u8>, bool) {
    let mut kept = Vec::new();
    let mut overflow = false;
    let mut chunk = [0u8; 16 * 1024];
    loop {
        match source.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let room = cap.saturating_sub(kept.len());
                if n > room {
                    overflow = true;
                }
                kept.extend_from_slice(&chunk[..n.min(room)]);
            }
        }
    }
    (kept, overflow)
}

/// يقتل العملية وكل ما تفرّع عنها. قتل الأم وحدها يترك ابنًا ممسكًا بالأنابيب (قِيس: 19 ثانية تأخير بعد المهلة).
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill").args(["/PID", &child.id().to_string(), "/T", "/F"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(0x0800_0000).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// يشغّل الأداة حتى تنتهي، أو حتى المهلة أو الإلغاء.
pub fn run(exe: &Path, args: &[String], cwd: &Path, input: &[u8], deadline: Instant, cancelled: &dyn Fn() -> bool) -> Result<ProcessOutput, ProcessFailure> {
    let mut command = Command::new(exe);
    command.args(args).current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: لا نافذة طرفية تومض فوق التطبيق.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { ProcessFailure::NotFound } else { ProcessFailure::Spawn(e.to_string()) })?;

    let stdin = child.stdin.take();
    let payload = input.to_vec();
    let writer = std::thread::spawn(move || {
        if let Some(mut pipe) = stdin {
            let _ = pipe.write_all(&payload);
        }
    });
    let stdout = child.stdout.take();
    let out_reader = std::thread::spawn(move || stdout.map(|s| drain(s, MAX_STDOUT_BYTES)).unwrap_or_default());
    let stderr = child.stderr.take();
    let err_reader = std::thread::spawn(move || stderr.map(|s| drain(s, MAX_STDERR_BYTES)).unwrap_or_default());

    let mut failure = None;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {}
            Err(e) => {
                failure = Some(ProcessFailure::Spawn(e.to_string()));
                break None;
            }
        }
        if cancelled() {
            failure = Some(ProcessFailure::Cancelled);
        } else if Instant::now() >= deadline {
            failure = Some(ProcessFailure::TimedOut);
        }
        if failure.is_some() {
            break None;
        }
        std::thread::sleep(POLL);
    };
    if let Some(failure) = failure {
        // لا انتظار لخيوط القراءة: تنتهي حين تُغلق الأنابيب بموت الشجرة، والمستدعي لا ينتظرها.
        kill_tree(&mut child);
        return Err(failure);
    }
    let _ = writer.join();
    let (stdout, overflow) = out_reader.join().unwrap_or_default();
    let (stderr, _) = err_reader.join().unwrap_or_default();
    if overflow {
        return Err(ProcessFailure::OutputTooLarge);
    }
    Ok(ProcessOutput { status, stdout, stderr })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[cfg(windows)]
    fn echo_stdin() -> (PathBuf, Vec<String>) {
        (PathBuf::from("cmd.exe"), vec!["/c".into(), "findstr".into(), "x*".into()])
    }
    #[cfg(not(windows))]
    fn echo_stdin() -> (PathBuf, Vec<String>) {
        (PathBuf::from("cat"), Vec::new())
    }
    #[cfg(windows)]
    fn sleeper() -> (PathBuf, Vec<String>) {
        (PathBuf::from("cmd.exe"), vec!["/c".into(), "ping".into(), "-n".into(), "20".into(), "127.0.0.1".into()])
    }
    #[cfg(not(windows))]
    fn sleeper() -> (PathBuf, Vec<String>) {
        (PathBuf::from("sleep"), vec!["20".into()])
    }

    #[test]
    fn the_prompt_goes_in_on_stdin_and_the_reply_comes_back() {
        let (exe, args) = echo_stdin();
        let out = run(&exe, &args, &std::env::temp_dir(), b"hello from stdin\n", Instant::now() + Duration::from_secs(20), &|| false).unwrap();
        assert_eq!(out.status, Some(0));
        assert!(String::from_utf8_lossy(&out.stdout).contains("hello from stdin"), "{:?}", out.stdout);
    }

    #[test]
    fn a_missing_executable_is_not_found() {
        let err = run(Path::new("polaris-no-such-cli-tool"), &[], &std::env::temp_dir(), b"", Instant::now() + Duration::from_secs(5), &|| false).unwrap_err();
        assert_eq!(err, ProcessFailure::NotFound);
    }

    #[test]
    fn the_deadline_kills_the_process() {
        let (exe, args) = sleeper();
        let began = Instant::now();
        let err = run(&exe, &args, &std::env::temp_dir(), b"", Instant::now() + Duration::from_millis(300), &|| false).unwrap_err();
        assert_eq!(err, ProcessFailure::TimedOut);
        assert!(began.elapsed() < Duration::from_secs(10), "{:?}", began.elapsed());
    }

    #[test]
    fn a_cancel_kills_the_process() {
        let (exe, args) = sleeper();
        let began = Instant::now();
        let err = run(&exe, &args, &std::env::temp_dir(), b"", Instant::now() + Duration::from_secs(60), &|| began.elapsed() > Duration::from_millis(200)).unwrap_err();
        assert_eq!(err, ProcessFailure::Cancelled);
        assert!(began.elapsed() < Duration::from_secs(10), "{:?}", began.elapsed());
    }
}
