// مساحة عمل المهمّة: مجلد يملكه POLARIS لكل مهمّة، وهو الحدّ الوحيد الذي يكتب فيه
// الوكيل ويُنفِّذ.
//
// `<data>/workspaces/<mission_id>/` بأربع مناطق: `inputs` (نسخ المرفقات، لا يكتب فيها
// الوكيل)، و`work` (مسوّدات الوكيل وشيفرته)، و`outputs` (المخرجات المسجَّلة)، و`downloads`
// (عزل تنزيلات المتصفّح). كل مسار من الوكيل نسبيّ، ويُحلّ هنا بقواعد ويندوز كاملة قبل
// أي فتح: لا `..`، ولا جذر مطلق، ولا حرف قرص، ولا دفق بيانات بديل (`:`)، ولا اسم جهاز
// محجوز، ولا نقطة أو مسافة في آخر المقطع، ولا عنصر في الطريق رابطٌ رمزي أو نقطة وصل.
// الرفض لا يُصحِّح: مسار يُرفض يعود للوكيل مرفوضًا، ولا يُعاد تفسيره إلى شيء «قريب».

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const INPUTS: &str = "inputs";
pub const WORK: &str = "work";
pub const OUTPUTS: &str = "outputs";
pub const DOWNLOADS: &str = "downloads";
/// ما يملكه زمن التشغيل داخل المساحة (ملفات مؤقتة للعمليات، سكربتات مُولَّدة). لا يُعرض كمخرَج.
pub const RUNTIME: &str = ".polaris";

pub const MAX_RELATIVE_LEN: usize = 260;
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_LIST_ENTRIES: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceError {
    InvalidMission,
    PathRejected(String),
    Reparse(String),
    NotFound(String),
    TooLarge(u64),
    ReadOnlyArea(String),
    Io(String),
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidMission => write!(f, "the mission identifier is not one this host issues"),
            Self::PathRejected(why) => write!(f, "the path was rejected: {why}"),
            Self::Reparse(at) => write!(f, "a link or junction lies on the path at {at}"),
            Self::NotFound(p) => write!(f, "{p} does not exist in the workspace"),
            Self::TooLarge(n) => write!(f, "{n} bytes exceed the file limit"),
            Self::ReadOnlyArea(p) => write!(f, "{p} is in an area the agent cannot write"),
            Self::Io(e) => write!(f, "workspace I/O failed: {e}"),
        }
    }
}

fn io(e: std::io::Error) -> WorkspaceError {
    WorkspaceError::Io(e.kind().to_string())
}

const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// يفحص مسارًا نسبيًّا ويعيد مقاطعه المطبّعة بفاصل أمامي. لا يلمس القرص.
pub fn normalise_relative(path: &str) -> Result<Vec<String>, WorkspaceError> {
    let reject = |why: &str| Err(WorkspaceError::PathRejected(why.to_string()));
    if path.trim().is_empty() {
        return reject("the path is empty");
    }
    if path.len() > MAX_RELATIVE_LEN {
        return reject("the path is too long");
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return reject("absolute paths are not accepted");
    }
    if path.contains(':') {
        return reject("drive letters and alternate data streams are not accepted");
    }
    if path.chars().any(|c| c.is_control() || matches!(c, '<' | '>' | '"' | '|' | '?' | '*')) {
        return reject("the path holds a character Windows forbids in names");
    }
    let mut out = Vec::new();
    for segment in path.split(['/', '\\']) {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return reject("parent traversal is not accepted");
        }
        if segment.ends_with('.') || segment.ends_with(' ') {
            return reject("a name ending in a dot or a space is not accepted");
        }
        let stem = segment.split('.').next().unwrap_or("").to_ascii_lowercase();
        if RESERVED.contains(&stem.as_str()) {
            return reject("a reserved device name is not accepted");
        }
        out.push(segment.to_string());
    }
    if out.is_empty() {
        return reject("the path names nothing");
    }
    Ok(out)
}

/// الجذر الذي تُنشأ تحته مساحات المهامّ.
#[derive(Debug, Clone)]
pub struct WorkspaceRoot {
    base: PathBuf,
    /// مهامّ المتابعة في محادثة واحدة تعمل في مساحة المهمّة الأولى نفسها (Phase-08): ملفات الدور
    /// السابق تبقى أمام الوكيل كما في محادثة مستمرة. المفتاح مهمّة المتابعة، والقيمة مهمّة المحادثة الأولى.
    aliases: std::sync::Arc<std::sync::RwLock<std::collections::HashMap<String, String>>>,
}

impl WorkspaceRoot {
    pub fn new(base: PathBuf) -> Self {
        Self { base, aliases: Default::default() }
    }

    pub fn base(&self) -> &Path {
        &self.base
    }

    /// يجعل مساحة `mission_id` هي مساحة `shared_with`. كلاهما UUID أصدره المضيف.
    pub fn share(&self, mission_id: &str, shared_with: &str) -> Result<(), WorkspaceError> {
        if !crate::ids::is_uuid_v4(mission_id) || !crate::ids::is_uuid_v4(shared_with) {
            return Err(WorkspaceError::InvalidMission);
        }
        if mission_id != shared_with {
            if let Ok(mut map) = self.aliases.write() {
                map.insert(mission_id.to_string(), shared_with.to_string());
            }
        }
        Ok(())
    }

    /// مجلد المهمّة على القرص، بعد اتّباع المشاركة (مستوى واحد: الجذر لا يُشارك غيره).
    pub fn dir_of(&self, mission_id: &str) -> PathBuf {
        let target = self.aliases.read().ok().and_then(|m| m.get(mission_id).cloned()).unwrap_or_else(|| mission_id.to_string());
        self.base.join(target)
    }

    /// مساحة مهمّة، تُنشأ إن لم تكن. المعرّف يجب أن يكون UUID أصدره المضيف.
    pub fn for_mission(&self, mission_id: &str) -> Result<ExecutionWorkspace, WorkspaceError> {
        if !crate::ids::is_uuid_v4(mission_id) {
            return Err(WorkspaceError::InvalidMission);
        }
        let root = self.dir_of(mission_id);
        for area in [INPUTS, WORK, OUTPUTS, DOWNLOADS, RUNTIME] {
            fs::create_dir_all(root.join(area)).map_err(io)?;
        }
        fs::create_dir_all(root.join(RUNTIME).join("tmp")).map_err(io)?;
        // ملف طُعم (خطة 2026-10-07، ADR-041 §3.4): يشبه الاعتمادات ولا سرّ فيه. قراءته بلا طلب حدث أمن، وقيمته في وسائط فعلٍ
        // خارجي تُرفض. يُكتب مرة واحدة لكل مساحة.
        let decoy = root.join(crate::p03::security::HONEYTOKEN_PATH);
        if !decoy.exists() {
            let canary = format!("{}{}", crate::p03::security::CANARY_PREFIX, &crate::digest::sha256_hex(mission_id.as_bytes())[..16]);
            let _ = fs::write(&decoy, format!("POLARIS decoy credentials file. It holds no real secret; POLARIS watches who reads it.
api_key={canary}
"));
        }
        let workspace = ExecutionWorkspace { mission_id: mission_id.to_string(), root };
        workspace.assert_no_link(&workspace.root)?;
        Ok(workspace)
    }

    /// هل للمهمّة مساحة على القرص؟ لا يُنشئ شيئًا.
    pub fn exists(&self, mission_id: &str) -> bool {
        crate::ids::is_uuid_v4(mission_id) && self.dir_of(mission_id).is_dir()
    }
}

/// مساحة مهمّة واحدة.
#[derive(Debug, Clone)]
pub struct ExecutionWorkspace {
    pub mission_id: String,
    root: PathBuf,
}

/// لماذا يُحلّ المسار: القراءة مسموحة في كل المناطق، والكتابة ليست مسموحة في `inputs`
/// ولا في منطقة زمن التشغيل.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Read,
    Write,
}

/// مدخل في قائمة مجلد.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Entry {
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
}

impl ExecutionWorkspace {
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn area(&self, area: &str) -> PathBuf {
        self.root.join(area)
    }

    pub fn temp_dir(&self) -> PathBuf {
        self.root.join(RUNTIME).join("tmp")
    }

    /// أي عنصر موجود على الطريق من الجذر إلى الهدف رابط رمزي أو نقطة وصل؟
    /// (مكتبة Rust القياسية على ويندوز تعدّ نقطة الوصل رابطًا رمزيًّا في `is_symlink`.)
    fn assert_no_link(&self, path: &Path) -> Result<(), WorkspaceError> {
        let mut current = PathBuf::new();
        for component in path.components() {
            current.push(component);
            if !current.starts_with(&self.root) && current != self.root {
                continue;
            }
            match fs::symlink_metadata(&current) {
                Ok(meta) if meta.file_type().is_symlink() => return Err(WorkspaceError::Reparse(self.relative_label(&current))),
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
                Err(e) => return Err(io(e)),
            }
        }
        Ok(())
    }

    fn relative_label(&self, path: &Path) -> String {
        path.strip_prefix(&self.root).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_else(|_| "<outside>".into())
    }

    /// يحلّ مسارًا نسبيًّا إلى مسار داخل المساحة، بعد كل الفحوص.
    pub fn resolve(&self, relative: &str, access: Access) -> Result<PathBuf, WorkspaceError> {
        let segments = normalise_relative(relative)?;
        let first = segments[0].to_ascii_lowercase();
        if access == Access::Write && (first == INPUTS || first == RUNTIME) {
            return Err(WorkspaceError::ReadOnlyArea(segments.join("/")));
        }
        let mut path = self.root.clone();
        for s in &segments {
            path.push(s);
        }
        self.assert_no_link(&path)?;
        Ok(path)
    }

    /// المسار النسبي المطبّع لمسار داخل المساحة، بفواصل أمامية.
    pub fn relative(&self, path: &Path) -> Option<String> {
        path.strip_prefix(&self.root).ok().map(|p| p.to_string_lossy().replace('\\', "/"))
    }

    pub fn read(&self, relative: &str, max_bytes: u64) -> Result<Vec<u8>, WorkspaceError> {
        let path = self.resolve(relative, Access::Read)?;
        let meta = fs::metadata(&path).map_err(|_| WorkspaceError::NotFound(relative.to_string()))?;
        if !meta.is_file() {
            return Err(WorkspaceError::NotFound(relative.to_string()));
        }
        if meta.len() > max_bytes {
            return Err(WorkspaceError::TooLarge(meta.len()));
        }
        fs::read(&path).map_err(io)
    }

    /// كتابة ذرّية: ملف مؤقت بجانب الهدف ثم إعادة تسمية. قارئ متزامن لا يرى نصف ملف.
    pub fn write(&self, relative: &str, bytes: &[u8]) -> Result<PathBuf, WorkspaceError> {
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err(WorkspaceError::TooLarge(bytes.len() as u64));
        }
        let path = self.resolve(relative, Access::Write)?;
        self.write_resolved(&path, bytes)?;
        Ok(path)
    }

    /// كتابة زمن التشغيل في منطقته المحجوزة (سكربتات مولّدة، مرفقات). لا يصل إليها الوكيل.
    pub fn write_runtime(&self, area: &str, name: &str, bytes: &[u8]) -> Result<PathBuf, WorkspaceError> {
        let segments = normalise_relative(name)?;
        let mut path = self.root.join(area);
        for s in &segments {
            path.push(s);
        }
        self.assert_no_link(&path)?;
        self.write_resolved(&path, bytes)?;
        Ok(path)
    }

    fn write_resolved(&self, path: &Path, bytes: &[u8]) -> Result<(), WorkspaceError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io)?;
            self.assert_no_link(parent)?;
        }
        if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink() || m.is_dir()) {
            return Err(WorkspaceError::PathRejected("the target is a directory or a link".into()));
        }
        let tmp = path.with_file_name(format!(".{}.{}.tmp", path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), crate::ids::new_uuid_v4()));
        {
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(io)?;
            file.write_all(bytes).map_err(io)?;
            file.sync_all().map_err(io)?;
        }
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            io(e)
        })
    }

    /// قائمة محدودة بالعمق والعدد، تتخطّى منطقة زمن التشغيل والروابط.
    pub fn list(&self, relative: Option<&str>, depth: usize) -> Result<Vec<Entry>, WorkspaceError> {
        let start = match relative {
            Some(r) => self.resolve(r, Access::Read)?,
            None => self.root.clone(),
        };
        let mut out = Vec::new();
        let mut stack = vec![(start, 0usize)];
        while let Some((dir, level)) = stack.pop() {
            let Ok(entries) = fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                if out.len() >= MAX_LIST_ENTRIES {
                    return Ok(out);
                }
                let path = entry.path();
                let Ok(meta) = fs::symlink_metadata(&path) else { continue };
                if meta.file_type().is_symlink() {
                    continue;
                }
                let Some(rel) = self.relative(&path) else { continue };
                if rel == RUNTIME || rel.starts_with(".polaris/") || path.file_name().is_some_and(|n| n.to_string_lossy().ends_with(".tmp")) {
                    continue;
                }
                out.push(Entry { path: rel, is_dir: meta.is_dir(), size_bytes: if meta.is_dir() { 0 } else { meta.len() } });
                if meta.is_dir() && level < depth {
                    stack.push((path, level + 1));
                }
            }
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    /// مجموع حجم الملفات (بلا روابط)، لحصّة المساحة.
    pub fn used_bytes(&self) -> u64 {
        let mut total = 0;
        let mut stack = vec![self.root.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let Ok(meta) = fs::symlink_metadata(entry.path()) else { continue };
                if meta.is_dir() {
                    stack.push(entry.path());
                } else if meta.is_file() {
                    total += meta.len();
                }
            }
        }
        total
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostile_relative_paths_are_rejected_before_the_disk_is_touched() {
        for bad in [
            "../secret.txt",
            "work/../../x",
            "C:/Windows/win.ini",
            "C:\\Windows",
            "/etc/passwd",
            "\\\\server\\share\\x",
            "work/file.txt:stream",
            "work/CON",
            "work/nul.txt",
            "work/trailing. ",
            "work/dot.",
            "work/a?b",
            "",
            "./.",
        ] {
            assert!(normalise_relative(bad).is_err(), "{bad:?} was accepted");
        }
        assert_eq!(normalise_relative("work\\sub/./a.txt").unwrap(), vec!["work", "sub", "a.txt"]);
        assert_eq!(normalise_relative("outputs/تقرير.docx").unwrap(), vec!["outputs", "تقرير.docx"]);
    }

    fn workspace() -> (tempdir::Dir, ExecutionWorkspace) {
        let dir = tempdir::Dir::new();
        let root = WorkspaceRoot::new(dir.path().to_path_buf());
        let ws = root.for_mission(&crate::ids::new_uuid_v4()).unwrap();
        (dir, ws)
    }

    #[test]
    fn writes_land_inside_and_inputs_are_read_only_to_the_agent() {
        let (_d, ws) = workspace();
        let p = ws.write("work/notes/a.txt", b"hello").unwrap();
        assert!(p.starts_with(ws.root()));
        assert_eq!(ws.read("work/notes/a.txt", 100).unwrap(), b"hello");
        assert!(matches!(ws.write("inputs/x.txt", b"x"), Err(WorkspaceError::ReadOnlyArea(_))));
        assert!(matches!(ws.write(".polaris/x", b"x"), Err(WorkspaceError::ReadOnlyArea(_))));
        assert!(matches!(ws.read("work/notes/a.txt", 2), Err(WorkspaceError::TooLarge(5))));
        let listed = ws.list(None, 4).unwrap();
        assert!(listed.iter().any(|e| e.path == "work/notes/a.txt" && e.size_bytes == 5));
        assert!(!listed.iter().any(|e| e.path.starts_with(".polaris")));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_the_workspace_is_refused_on_the_path() {
        let (_d, ws) = workspace();
        std::os::unix::fs::symlink("/etc", ws.area(WORK).join("escape")).unwrap();
        assert!(matches!(ws.read("work/escape/passwd", 1_000_000), Err(WorkspaceError::Reparse(_))));
        assert!(matches!(ws.write("work/escape/x", b"x"), Err(WorkspaceError::Reparse(_))));
        assert!(!ws.list(None, 4).unwrap().iter().any(|e| e.path.contains("escape")));
    }

    /// النظير على Windows (QA 2026-10-15): نقطة وصل داخل المساحة إلى مجلد خارجها فيه ملف حارس. لا قراءة
    /// ولا كتابة ولا سرد عبرها، والحارس لا يُمسّ. الوصلة تُزال قبل الحذف كي لا يمرّ الحذف إلى الهدف.
    #[cfg(windows)]
    #[test]
    fn a_junction_inside_the_workspace_is_refused_on_the_path() {
        let (_d, ws) = workspace();
        let outside = tempdir::Dir::new();
        std::fs::write(outside.path().join("canary.txt"), b"outside").unwrap();
        let link = ws.area(WORK).join("escape");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "the junction could not be created");
        let read = ws.read("work/escape/canary.txt", 1_000);
        let write = ws.write("work/escape/planted.txt", b"x");
        let listed = ws.list(None, 4).unwrap();
        std::fs::remove_dir(&link).unwrap();
        assert!(matches!(read, Err(WorkspaceError::Reparse(_))), "{read:?}");
        assert!(matches!(write, Err(WorkspaceError::Reparse(_))), "{write:?}");
        assert!(!listed.iter().any(|e| e.path.contains("escape/")), "listing followed the junction");
        assert!(!outside.path().join("planted.txt").exists());
        assert_eq!(std::fs::read(outside.path().join("canary.txt")).unwrap(), b"outside");
    }

    #[test]
    fn a_mission_identifier_that_is_not_a_uuid_cannot_name_a_workspace() {
        let dir = tempdir::Dir::new();
        let root = WorkspaceRoot::new(dir.path().to_path_buf());
        assert_eq!(root.for_mission("../../x").unwrap_err(), WorkspaceError::InvalidMission);
    }

    /// مجلد مؤقت يُحذف عند الإسقاط، بلا تبعية خارجية.
    pub(crate) mod tempdir {
        pub struct Dir(std::path::PathBuf);
        impl Dir {
            pub fn new() -> Self {
                let p = crate::test_scratch::root().join(format!("p08-{}", crate::ids::new_uuid_v4()));
                std::fs::create_dir_all(&p).unwrap();
                Self(p)
            }
            pub fn path(&self) -> &std::path::Path {
                &self.0
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }
}
