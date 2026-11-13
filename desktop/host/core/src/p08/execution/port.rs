// منفذ الصندوق المعزول: الحدّ الذي يعبره كل تشغيل عملية يطلبه وكيل.
//
// النواة لا تعرف AppContainer ولا Job Objects: تعرف أن هناك منفذًا يشغّل برنامجًا
// معروفًا في مجلد معروف بحدود معروفة، ويعيد ما قاسه. التنفيذ الحقيقي في طبقة المنصّة
// (app/src/sandbox_win32.rs على ويندوز). حيث لا منفذ، يُرفض كل تشغيل بـ
// `SANDBOX_UNAVAILABLE` صراحةً — لا تشغيل على المضيف مباشرةً أبدًا بديلًا عنه.

use std::path::PathBuf;

use polaris_host_providers::net::CancelToken;
use serde::Serialize;

/// حدود تشغيل واحد، كما تفرضها المنصّة على شجرة العمليات كاملة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ExecutionLimits {
    pub wall_time_ms: u64,
    pub memory_bytes: u64,
    pub max_processes: u32,
    /// نسبة المعالج القصوى (1..100) لشجرة العمليات كلها.
    pub cpu_percent: u32,
    /// أقصى ما يُحفظ من stdout وstderr معًا. ما زاد يُقطع ويُعلن مقطوعًا.
    pub max_output_bytes: u64,
}

impl ExecutionLimits {
    /// الحدود الافتراضية المحافظة.
    pub const DEFAULT: Self = Self { wall_time_ms: 120_000, memory_bytes: 1024 * 1024 * 1024, max_processes: 16, cpu_percent: 80, max_output_bytes: 1024 * 1024 };
    /// السقف الذي لا يرفعه طلب ولا إعداد.
    pub const CEILING: Self = Self { wall_time_ms: 900_000, memory_bytes: 4 * 1024 * 1024 * 1024, max_processes: 64, cpu_percent: 100, max_output_bytes: 8 * 1024 * 1024 };

    /// يقصّ حدودًا مطلوبة إلى السقف، ويرفض الصفر.
    pub fn clamped(self) -> Self {
        let c = Self::CEILING;
        Self {
            wall_time_ms: self.wall_time_ms.clamp(1_000, c.wall_time_ms),
            memory_bytes: self.memory_bytes.clamp(64 * 1024 * 1024, c.memory_bytes),
            max_processes: self.max_processes.clamp(1, c.max_processes),
            cpu_percent: self.cpu_percent.clamp(5, c.cpu_percent),
            max_output_bytes: self.max_output_bytes.clamp(4 * 1024, c.max_output_bytes),
        }
    }
}

/// طلب تشغيل. كل مسار فيه مطلق حلّه زمن التشغيل الموثوق، لا الوكيل.
#[derive(Debug, Clone)]
pub struct SandboxRequest {
    /// هوية العزل: مساحة المهمّة الواحدة تشغّل عملياتها بهوية واحدة لا تشاركها مهمّة أخرى.
    pub mission_id: String,
    pub program: PathBuf,
    pub arguments: Vec<String>,
    pub working_directory: PathBuf,
    /// المجلد الوحيد الذي يُمنح للكتابة (مساحة المهمّة).
    pub writable_root: PathBuf,
    /// مجلدات للقراءة والتنفيذ فقط (نسخة بيئة التشغيل التي يملكها POLARIS).
    pub read_only_roots: Vec<PathBuf>,
    /// بيئة مبنية صراحةً. لا يرث الابن شيئًا من بيئة POLARIS.
    pub environment: Vec<(String, String)>,
    /// مجلد مؤقت داخل المساحة. المنصّة توجّه إليه كل متغيّرات المجلدات المؤقتة والشخصية.
    pub temp_directory: PathBuf,
    pub limits: ExecutionLimits,
    /// شبكة للعملية: لا تُفتح إلا بموافقة، وهي فئة (إنترنت) لا وجهة بعينها.
    pub network: bool,
    pub cancel: CancelToken,
}

/// كيف انتهى التشغيل.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SandboxEnd {
    Exited,
    TimedOut,
    /// تجاوز حدّ الذاكرة أو العمليات أو المخرجات، فأُنهيت الشجرة.
    LimitExceeded,
    Cancelled,
}

/// ما قاسته المنصّة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SandboxOutcome {
    pub end: SandboxEnd,
    pub exit_code: Option<i64>,
    #[serde(skip)]
    pub stdout: Vec<u8>,
    #[serde(skip)]
    pub stderr: Vec<u8>,
    pub output_truncated: bool,
    pub duration_ms: u64,
    /// كل العمليات التي نشأت في الشجرة، كما عدّها كائن المهمّة (Job).
    pub processes_total: u32,
    /// العمليات الحيّة بعد الإنهاء. يجب أن تكون صفرًا؛ غير ذلك عيب يُبلَّغ.
    pub survivors: u32,
    /// أي حدّ أنهى الشجرة، إن كان.
    pub limit: Option<String>,
    /// وصف العزل المطبّق فعلًا (مثل `APPCONTAINER+JOB`)، لا المطلوب.
    pub isolation: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SandboxError {
    /// لا صندوق على هذه المنصّة، أو تعذّر إنشاؤه. لا يُشغَّل شيء.
    Unavailable(String),
    /// البرنامج أو المجلد غير صالح للتشغيل.
    Launch(String),
}

impl std::fmt::Display for SandboxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable(why) => write!(f, "the execution sandbox is unavailable: {why}"),
            Self::Launch(why) => write!(f, "the sandboxed process could not start: {why}"),
        }
    }
}

/// المنفذ.
pub trait SandboxPort: Send + Sync {
    /// وصف قصير لما يطبّقه هذا المنفذ، للعرض والدليل.
    fn isolation(&self) -> &'static str;
    fn run(&self, request: &SandboxRequest) -> Result<SandboxOutcome, SandboxError>;
    /// يحرّر هوية العزل لمهمّة انتهت (منح المجلد وملف الحاوية). لا يحذف ملفات المساحة.
    fn release(&self, _mission_id: &str, _writable_root: &std::path::Path) -> Result<(), SandboxError> {
        Ok(())
    }
}

/// منفذ غائب: يرفض كل تشغيل برمز صريح.
pub struct UnavailableSandbox(pub &'static str);

impl SandboxPort for UnavailableSandbox {
    fn isolation(&self) -> &'static str {
        "NONE"
    }

    fn run(&self, _request: &SandboxRequest) -> Result<SandboxOutcome, SandboxError> {
        Err(SandboxError::Unavailable(self.0.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requested_limits_cannot_exceed_the_ceiling_or_be_zero() {
        let asked = ExecutionLimits { wall_time_ms: u64::MAX, memory_bytes: 0, max_processes: 10_000, cpu_percent: 0, max_output_bytes: u64::MAX };
        let c = asked.clamped();
        assert_eq!(c.wall_time_ms, ExecutionLimits::CEILING.wall_time_ms);
        assert!(c.memory_bytes >= 64 * 1024 * 1024);
        assert_eq!(c.max_processes, ExecutionLimits::CEILING.max_processes);
        assert!(c.cpu_percent >= 5);
        assert_eq!(c.max_output_bytes, ExecutionLimits::CEILING.max_output_bytes);
    }
}
