// خدمة التنفيذ: تحوّل طلب أداة مُوافَقًا عليه إلى تشغيل واحد داخل الصندوق، وتسجّل ما قِيس.
//
// لا تقرّر هذه الخدمة شيئًا أمنيًّا: البوابة قرّرت (المخطط، والقدرة، والسياسة، والموافقة)
// قبل أن تصل إليها. ما تملكه هو ما لا يصحّ أن يملكه الوكيل: اختيار البرنامج (من قائمة
// زمن التشغيل، لا من اسم يقترحه النموذج)، وبناء البيئة، وكتابة السكربت في منطقة زمن
// التشغيل، وسقف الحدود، ثم سجلّ التشغيل في القاعدة والتدقيق.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use polaris_host_providers::net::CancelToken;
use rusqlite::params;
use serde::Serialize;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::storage::Database;

use super::super::workspace::{ExecutionWorkspace, WorkspaceRoot, RUNTIME};
use super::port::{ExecutionLimits, SandboxEnd, SandboxError, SandboxPort, SandboxRequest};
use super::runtime::RuntimeCatalog;
use super::sanitize::sanitize;

/// أقصى ما يُعاد للنموذج من المخرجات، بالمحارف. الباقي في سجلّ التشغيل.
pub const OBSERVATION_CHARS: usize = 12_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Runtime {
    Powershell,
    Python,
}

impl Runtime {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Powershell => "POWERSHELL",
            Self::Python => "PYTHON",
        }
    }
}

/// ما يُعاد من تشغيل واحد. النصوص منقّاة ومحدودة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExecutionResult {
    pub run_id: String,
    pub runtime: Runtime,
    /// SUCCEEDED | FAILED | TIMED_OUT | LIMIT_EXCEEDED | CANCELLED | SANDBOX_UNAVAILABLE
    pub status: &'static str,
    pub exit_code: Option<i64>,
    pub duration_ms: u64,
    pub stdout: String,
    pub stderr: String,
    pub output_truncated: bool,
    pub network: bool,
    pub processes_total: u32,
    pub survivors: u32,
    pub isolation: String,
    pub limit: Option<String>,
}

impl ExecutionResult {
    pub fn succeeded(&self) -> bool {
        self.status == "SUCCEEDED"
    }
}

/// طلب تشغيل كما تفهمه الخدمة.
pub struct RunSpec<'a> {
    pub mission_id: &'a str,
    pub task_id: &'a str,
    pub tool_id: &'a str,
    pub runtime: Runtime,
    /// نصّ السكربت (PowerShell أو Python). يُكتب في منطقة زمن التشغيل، لا يمرّ سطرَ أوامر.
    pub source: &'a str,
    /// ملف Python داخل المساحة بدل النصّ، إن طُلب.
    pub script_path: Option<PathBuf>,
    pub arguments: Vec<String>,
    /// مجلد العمل نسبيًّا للمساحة (الافتراض: `work`).
    pub working_directory: Option<PathBuf>,
    pub limits: ExecutionLimits,
    pub network: bool,
    pub cancel: &'a CancelToken,
}

/// خطة الإطلاق: البرنامج، ووسائطه، ومجلدات القراءة، ومتغيّرات البيئة الخاصّة بالبيئة.
type LaunchPlan = (PathBuf, Vec<String>, Vec<PathBuf>, Vec<(String, String)>);

pub struct ExecutionService {
    sandbox: Arc<dyn SandboxPort>,
    workspaces: WorkspaceRoot,
    catalog: RuntimeCatalog,
    db: Arc<Database>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
}

fn utf8_bom(text: &str) -> Vec<u8> {
    // Windows PowerShell 5.1 يقرأ سكربتًا بلا BOM بترميز ANSI فيفسد العربية.
    let mut out = vec![0xEF, 0xBB, 0xBF];
    out.extend_from_slice(text.as_bytes());
    out
}

impl ExecutionService {
    pub fn new(sandbox: Arc<dyn SandboxPort>, workspaces: WorkspaceRoot, catalog: RuntimeCatalog, db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock) -> Self {
        Self { sandbox, workspaces, catalog, db, audit, clock }
    }

    pub fn workspaces(&self) -> &WorkspaceRoot {
        &self.workspaces
    }

    pub fn catalog(&self) -> &RuntimeCatalog {
        &self.catalog
    }

    pub fn isolation(&self) -> &'static str {
        self.sandbox.isolation()
    }

    /// هل يستطيع هذا المضيف تشغيل بيئة بعينها الآن؟ جواب صادق لا وعد.
    pub fn available(&self, runtime: Runtime) -> Result<(), String> {
        if self.sandbox.isolation() == "NONE" {
            return Err("no execution sandbox is bound on this host".into());
        }
        match runtime {
            Runtime::Powershell => self.catalog.powershell.as_ref().filter(|p| p.is_file()).map(|_| ()).ok_or_else(|| "Windows PowerShell was not found".into()),
            Runtime::Python => self.catalog.python().map(|_| ()).ok_or_else(|| "the Python runtime has not been prepared".into()),
        }
    }

    /// هل تُعرض أداة Python؟ صندوق قائم، وPython جاهزة أو موجودة على الجهاز فتُعدّ عند أول استعمال (DEF-35).
    pub fn python_offerable(&self) -> bool {
        self.sandbox.isolation() != "NONE" && self.catalog.python_preparable()
    }

    /// Python جاهزة للتشغيل الآن، مُعدّة عند الحاجة. يعيد هل أُعدّت في هذا النداء.
    pub fn ensure_python(&self) -> Result<bool, String> {
        if self.sandbox.isolation() == "NONE" {
            return Err("no execution sandbox is bound on this host".into());
        }
        self.catalog.ensure_python().map(|(_, prepared_now)| prepared_now)
    }

    fn program_and_arguments(&self, workspace: &ExecutionWorkspace, spec: &RunSpec<'_>, run_id: &str, working_directory: &std::path::Path) -> Result<LaunchPlan, String> {
        let runs = format!("runs/{run_id}");
        match spec.runtime {
            Runtime::Powershell => {
                let exe = self.catalog.powershell.clone().ok_or("Windows PowerShell was not found")?;
                // داخل AppContainer لا يستطيع PowerShell 5.1 ضبط موقعه على مسار لا يُسمح بسرد آبائه (قِيس على
                // ويندوز 11: Set-Location يرفض، والمسار النسبي يُحلّ إلى C:\). الحلّ: محرّك PS جذره مجلد العمل،
                // فتُحلّ المسارات النسبية تحته دون سرد الآباء. `$W` يحمل المسار المطلق لمن يفضّله.
                let location = working_directory.to_string_lossy().replace('\'', "''");
                let preamble = format!(
                    "$ErrorActionPreference = 'Continue'\n$ProgressPreference = 'SilentlyContinue'\n[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$OutputEncoding = [System.Text.Encoding]::UTF8\n$W = '{location}'\n[System.IO.Directory]::SetCurrentDirectory($W)\ntry {{ $null = New-PSDrive -Name POLARIS -PSProvider FileSystem -Root $W -Scope Global -ErrorAction Stop; Set-Location -LiteralPath 'POLARIS:\\' -ErrorAction Stop }} catch {{ try {{ Set-Location -LiteralPath $W -ErrorAction Stop }} catch {{ }} }}\n"
                );
                // Phase-08 (قِيس في MISSION-E): `python` لم يكن معروفًا داخل الصندوق، وكان خطأ «الأمر غير
                // معروف» يخرج برمز 0 فيُقرأ نجاحًا. الآن: نسخة Python التي يملكها POLARIS على PATH (قراءة
                // فقط)، وخاتمة تعيد رمز آخر برنامج أصلي أو 1 إن فشلت آخر عبارة، فلا يتنكّر فشل في نجاح.
                let python = self.catalog.python();
                let mut read_only = Vec::new();
                let mut env = Vec::new();
                let mut path_prefix = String::new();
                if let Some(py) = &python {
                    read_only.push(py.home.clone());
                    let site = workspace.root().join(RUNTIME).join("site-packages");
                    let _ = std::fs::create_dir_all(&site);
                    env.push(("PYTHONPATH".to_string(), site.to_string_lossy().into_owned()));
                    env.push(("PYTHONIOENCODING".to_string(), "utf-8".to_string()));
                    env.push(("PYTHONDONTWRITEBYTECODE".to_string(), "1".to_string()));
                    let home = py.home.to_string_lossy().replace('\'', "''");
                    path_prefix = format!("$env:PATH = '{home};{home}\\Scripts;' + $env:PATH\nSet-Alias -Name python3 -Value python -Scope Global\n");
                }
                let postamble = "\n$__polarisOk = $?\nif ($null -ne $global:LASTEXITCODE -and $global:LASTEXITCODE -ne 0) { exit $global:LASTEXITCODE }\nif (-not $__polarisOk) { exit 1 }\nexit 0\n";
                let script = workspace.write_runtime(RUNTIME, &format!("{runs}.ps1"), &utf8_bom(&format!("{preamble}{path_prefix}{}\n{postamble}", spec.source))).map_err(|e| e.to_string())?;
                let mut args = vec!["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"].into_iter().map(String::from).collect::<Vec<_>>();
                args.push(script.to_string_lossy().into_owned());
                args.extend(spec.arguments.iter().cloned());
                Ok((exe, args, read_only, env))
            }
            Runtime::Python => {
                let py = self.catalog.python().ok_or("the Python runtime has not been prepared")?;
                let target = match &spec.script_path {
                    Some(p) => p.clone(),
                    None => workspace.write_runtime(RUNTIME, &format!("{runs}.py"), spec.source.as_bytes()).map_err(|e| e.to_string())?,
                };
                let site = workspace.root().join(RUNTIME).join("site-packages");
                std::fs::create_dir_all(&site).map_err(|e| e.to_string())?;
                // المُقلِع يضيف حزم المهمّة إلى المسار ثم يشغّل الهدف كبرنامج رئيسي. -E يمنع أي
                // متغيّر PYTHON* من البيئة، و-s يمنع مجلد المستخدم: لا شيء خارج المساحة يُحمَّل.
                let boot = format!(
                    "import sys, runpy\nsys.path.insert(0, {site:?})\nsys.argv = [{target:?}] + sys.argv[1:]\nsys.path.insert(0, {dir:?})\nrunpy.run_path({target:?}, run_name='__main__')\n",
                    site = site.to_string_lossy(),
                    target = target.to_string_lossy(),
                    dir = target.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
                );
                let boot_path = workspace.write_runtime(RUNTIME, &format!("{runs}.boot.py"), boot.as_bytes()).map_err(|e| e.to_string())?;
                let mut args = vec!["-E".to_string(), "-s".into(), "-B".into(), "-X".into(), "utf8".into(), boot_path.to_string_lossy().into_owned()];
                args.extend(spec.arguments.iter().cloned());
                let env = vec![("PYTHONIOENCODING".to_string(), "utf-8".to_string()), ("PYTHONDONTWRITEBYTECODE".into(), "1".into())];
                Ok((py.executable.clone(), args, vec![py.home.clone()], env))
            }
        }
    }

    /// يشغّل ويسجّل. كل فشل قبل التشغيل يعود نتيجة مسجَّلة، لا ذعرًا.
    pub fn run(&self, spec: RunSpec<'_>) -> Result<ExecutionResult, String> {
        let workspace = self.workspaces.for_mission(spec.mission_id).map_err(|e| e.to_string())?;
        let run_id = self.clock.id();
        let started_at = self.clock.now();
        let started = Instant::now();
        let limits = spec.limits.clamped();
        // الافتراض جذر المساحة: كل مسار يراه الوكيل (inputs/، work/، outputs/) نسبيّ إليه،
        // كما في أدوات المساحة نفسها، فلا يختلف معنى المسار بين أداة وأخرى.
        let working_directory = match &spec.working_directory {
            Some(rel) => workspace.root().join(rel),
            None => workspace.root().to_path_buf(),
        };
        let (program, arguments, read_only_roots, extra_env) = self.program_and_arguments(&workspace, &spec, &run_id, &working_directory)?;
        let mut environment = vec![("POLARIS_EXECUTION".to_string(), "1".to_string()), ("POLARIS_WORKSPACE".to_string(), workspace.root().to_string_lossy().into_owned())];
        environment.extend(extra_env);
        let request = SandboxRequest {
            mission_id: spec.mission_id.to_string(),
            program,
            arguments,
            working_directory,
            writable_root: workspace.root().to_path_buf(),
            read_only_roots,
            environment,
            temp_directory: workspace.temp_dir(),
            limits,
            network: spec.network,
            cancel: spec.cancel.clone(),
        };
        let outcome = self.sandbox.run(&request);
        let duration_ms = started.elapsed().as_millis() as u64;
        let result = match outcome {
            Ok(o) => {
                let half = OBSERVATION_CHARS / 2;
                let (stdout, cut_out) = sanitize(&o.stdout, half);
                let (stderr, cut_err) = sanitize(&o.stderr, half);
                let status = match o.end {
                    SandboxEnd::Exited if o.exit_code == Some(0) => "SUCCEEDED",
                    SandboxEnd::Exited => "FAILED",
                    SandboxEnd::TimedOut => "TIMED_OUT",
                    SandboxEnd::LimitExceeded => "LIMIT_EXCEEDED",
                    SandboxEnd::Cancelled => "CANCELLED",
                };
                ExecutionResult {
                    run_id: run_id.clone(),
                    runtime: spec.runtime,
                    status,
                    exit_code: o.exit_code,
                    duration_ms: o.duration_ms.max(1),
                    stdout,
                    stderr,
                    output_truncated: o.output_truncated || cut_out || cut_err,
                    network: spec.network,
                    processes_total: o.processes_total,
                    survivors: o.survivors,
                    isolation: o.isolation,
                    limit: o.limit,
                }
            }
            Err(e) => ExecutionResult {
                run_id: run_id.clone(),
                runtime: spec.runtime,
                status: if matches!(e, SandboxError::Unavailable(_)) { "SANDBOX_UNAVAILABLE" } else { "FAILED" },
                exit_code: None,
                duration_ms,
                stdout: String::new(),
                stderr: e.to_string(),
                output_truncated: false,
                network: spec.network,
                processes_total: 0,
                survivors: 0,
                isolation: self.sandbox.isolation().to_string(),
                limit: None,
            },
        };
        self.record(&spec, &result, &started_at);
        Ok(result)
    }

    fn record(&self, spec: &RunSpec<'_>, result: &ExecutionResult, started_at: &str) {
        let preview: String = spec.source.chars().take(2_000).collect();
        let excerpt: String = format!("{}\n{}", result.stdout, result.stderr).chars().take(8_000).collect();
        let finished_at = self.clock.now();
        let _ = self.db.with(|conn| {
            conn.execute(
                "INSERT INTO p08_execution_runs (run_id, mission_id, task_id, tool_id, runtime, command_preview, command_sha256, status, exit_code, duration_ms, stdout_bytes, stderr_bytes, output_truncated, network, processes_total, survivors, output_excerpt, started_at, finished_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                params![
                    result.run_id,
                    spec.mission_id,
                    spec.task_id.chars().take(64).collect::<String>(),
                    spec.tool_id,
                    result.runtime.as_str(),
                    preview,
                    crate::digest::sha256_hex(spec.source.as_bytes()),
                    result.status,
                    result.exit_code,
                    result.duration_ms as i64,
                    result.stdout.len() as i64,
                    result.stderr.len() as i64,
                    result.output_truncated as i64,
                    result.network as i64,
                    result.processes_total as i64,
                    result.survivors as i64,
                    excerpt,
                    started_at,
                    finished_at
                ],
            )?;
            Ok(())
        });
        let outcome = if result.succeeded() { AuditOutcome::Success } else { AuditOutcome::Failure };
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::ExecutionRunCompleted,
            "execution_run",
            &result.run_id,
            outcome,
            serde_json::json!({
                "mission_id": spec.mission_id,
                "runtime": result.runtime.as_str(),
                "status": result.status,
                "exit_code": result.exit_code,
                "duration_ms": result.duration_ms,
                "network": result.network,
                "processes_total": result.processes_total,
                "survivors": result.survivors,
                "isolation": result.isolation,
                "command_sha256": crate::digest::sha256_hex(spec.source.as_bytes()),
            }),
        ));
    }

    /// يحرّر هوية العزل لمهمّة انتهت. ملفات المساحة تبقى للمستخدم.
    pub fn release(&self, mission_id: &str) {
        if !self.workspaces.exists(mission_id) {
            return;
        }
        let root = self.workspaces.dir_of(mission_id);
        let result = self.sandbox.release(mission_id, &root);
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::ExecutionSandboxReleased,
            "mission",
            mission_id,
            if result.is_ok() { AuditOutcome::Success } else { AuditOutcome::Failure },
            serde_json::json!({ "isolation": self.sandbox.isolation() }),
        ));
    }

    /// سجلّ تشغيلات مهمّة، الأحدث أولًا.
    pub fn runs(&self, mission_id: &str, limit: usize) -> Vec<serde_json::Value> {
        self.db
            .with(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT run_id, task_id, tool_id, runtime, command_preview, status, exit_code, duration_ms, output_truncated, network, processes_total, survivors, output_excerpt, started_at, finished_at FROM p08_execution_runs WHERE mission_id = ?1 ORDER BY started_at DESC LIMIT ?2",
                )?;
                let rows = stmt
                    .query_map(params![mission_id, limit as i64], |r| {
                        Ok(serde_json::json!({
                            "run_id": r.get::<_, String>(0)?,
                            "task_id": r.get::<_, String>(1)?,
                            "tool_id": r.get::<_, String>(2)?,
                            "runtime": r.get::<_, String>(3)?,
                            "command_preview": r.get::<_, String>(4)?,
                            "status": r.get::<_, String>(5)?,
                            "exit_code": r.get::<_, Option<i64>>(6)?,
                            "duration_ms": r.get::<_, i64>(7)?,
                            "output_truncated": r.get::<_, i64>(8)? == 1,
                            "network": r.get::<_, i64>(9)? == 1,
                            "processes_total": r.get::<_, i64>(10)?,
                            "survivors": r.get::<_, i64>(11)?,
                            "output_excerpt": r.get::<_, String>(12)?,
                            "started_at": r.get::<_, String>(13)?,
                            "finished_at": r.get::<_, String>(14)?,
                        }))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .unwrap_or_default()
    }
}
