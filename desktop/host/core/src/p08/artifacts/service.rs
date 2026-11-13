// خدمة المخرجات: تكتب الملف في مساحة المهمّة، تعيد فتحه وتتحقّق منه، ثم تسجّل واصفه.
//
// الترتيب ثابت ولا يُختصر: كتابة ← قراءة من القرص ← تحقق ← تسجيل. التحقق على البايتات
// المقروءة من القرص لا على ما في الذاكرة، فما يُعلن مخرجًا هو ما بقي فعلًا في الملف.

use std::path::PathBuf;
use std::sync::OnceLock;

use serde_json::{json, Value};

use super::super::workspace::{Access, ExecutionWorkspace, WorkspaceRoot, OUTPUTS};
use super::pdf::{write_pdf, TrueTypeFont};
use super::spec::{DeckSpec, DocumentSpec, WorkbookSpec};
use super::store::{preview_of, ArtifactDescriptor, ArtifactStore, ArtifactType, NewArtifact};
use super::verify::{verify_file, Verification};
use super::web::check_site;

/// ما يلزم لإنهاء مخرَج مكتوب: مساره ونوعه وما يُتوقَّع فيه ومن أنتجه.
struct Finish<'a> {
    rel: &'a str,
    kind: ArtifactType,
    title: &'a str,
    expected: &'a [String],
    glyphs: Option<usize>,
    task: Option<&'a str>,
    agent: Option<&'a str>,
    producer: &'static str,
}

pub struct ArtifactService {
    pub store: ArtifactStore,
    workspaces: WorkspaceRoot,
    font_path: Option<PathBuf>,
    font: OnceLock<Option<TrueTypeFont>>,
    clock: crate::p03::clock::RuntimeClock,
}

/// ما يُعاد للأداة بعد إنتاج مخرَج.
pub struct Produced {
    pub descriptor: ArtifactDescriptor,
    pub verification: Verification,
}

/// اسم ملف آمن من عنوان: حروف وأرقام وشرطات، عربية أو لاتينية.
pub fn slug(title: &str) -> String {
    let s: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let s: String = s.chars().take(60).collect();
    if s.is_empty() {
        "artifact".into()
    } else {
        s
    }
}

impl ArtifactService {
    pub fn new(store: ArtifactStore, workspaces: WorkspaceRoot, font_path: Option<PathBuf>, clock: crate::p03::clock::RuntimeClock) -> Self {
        Self { store, workspaces, font_path, font: OnceLock::new(), clock }
    }

    pub fn workspaces(&self) -> &WorkspaceRoot {
        &self.workspaces
    }

    /// الخط المضمَّن في PDF: يُقرأ مرة واحدة. غيابه يعني الخطوط القياسية (لاتينية فقط).
    pub fn font(&self) -> Option<&TrueTypeFont> {
        self.font
            .get_or_init(|| self.font_path.as_ref().and_then(|p| std::fs::read(p).ok()).and_then(|b| TrueTypeFont::parse(b).ok()))
            .as_ref()
    }

    fn target(&self, workspace: &ExecutionWorkspace, requested: Option<&str>, title: &str, extension: &str) -> Result<(String, PathBuf), String> {
        let rel = match requested {
            Some(r) => r.to_string(),
            None => format!("{OUTPUTS}/{}.{extension}", slug(title)),
        };
        if !rel.to_ascii_lowercase().ends_with(&format!(".{extension}")) {
            return Err(format!("the path must end with .{extension}"));
        }
        let path = workspace.resolve(&rel, Access::Write).map_err(|e| e.to_string())?;
        Ok((workspace.relative(&path).unwrap_or(rel), path))
    }

    fn finish(&self, workspace: &ExecutionWorkspace, f: Finish<'_>) -> Result<Produced, String> {
        let Finish { rel, kind, title, expected, glyphs, task, agent, producer } = f;
        let bytes = workspace.read(rel, super::super::workspace::MAX_FILE_BYTES).map_err(|e| e.to_string())?;
        let verification = verify_file(rel, &bytes, expected, glyphs);
        let preview = preview_of(rel, &bytes, &verification);
        let descriptor = self
            .store
            .register(NewArtifact {
                mission_id: &workspace.mission_id,
                task_id: task,
                artifact_type: kind,
                title,
                file_ref: rel,
                bytes_for_digest: &bytes,
                size: bytes.len() as u64,
                verification: &verification,
                preview,
                producer,
                agent_id: agent,
            })
            .map_err(|e| e.to_string())?;
        Ok(Produced { descriptor, verification })
    }

    /// مستند بصيغة من docx/pdf/html/markdown.
    pub fn document(&self, mission_id: &str, format: &str, path: Option<&str>, spec: &DocumentSpec, task: Option<&str>, agent: Option<&str>) -> Result<Produced, String> {
        spec.validate().map_err(|e| e.0)?;
        let workspace = self.workspaces.for_mission(mission_id).map_err(|e| e.to_string())?;
        let now = self.clock.now();
        let expected = vec![spec.title.clone()];
        let (kind, extension, bytes, glyphs) = match format {
            "docx" => (ArtifactType::Docx, "docx", super::docx::write_docx(spec, &now)?, None),
            "pdf" => {
                let out = write_pdf(spec, self.font(), &now)?;
                (ArtifactType::Pdf, "pdf", out.bytes, Some(out.unsupported_glyphs))
            }
            "html" => (ArtifactType::Html, "html", super::web::document_html(spec)?.into_bytes(), None),
            "markdown" | "md" => (ArtifactType::Markdown, "md", super::text::document_markdown(spec)?.into_bytes(), None),
            other => return Err(format!("{other} is not a document format (docx, pdf, html, markdown)")),
        };
        let (rel, _) = self.target(&workspace, path, &spec.title, extension)?;
        workspace.write(&rel, &bytes).map_err(|e| e.to_string())?;
        self.finish(&workspace, Finish { rel: &rel, kind, title: &spec.title, expected: &expected, glyphs, task, agent, producer: "polaris.artifact.document" })
    }

    pub fn presentation(&self, mission_id: &str, path: Option<&str>, deck: &DeckSpec, task: Option<&str>, agent: Option<&str>) -> Result<Produced, String> {
        let workspace = self.workspaces.for_mission(mission_id).map_err(|e| e.to_string())?;
        let bytes = super::pptx::write_pptx(deck, &self.clock.now())?;
        let (rel, _) = self.target(&workspace, path, &deck.title, "pptx")?;
        workspace.write(&rel, &bytes).map_err(|e| e.to_string())?;
        let expected: Vec<String> = std::iter::once(deck.title.clone()).chain(deck.slides.iter().map(|s| s.title.clone())).collect();
        self.finish(&workspace, Finish { rel: &rel, kind: ArtifactType::Pptx, title: &deck.title, expected: &expected, glyphs: None, task, agent, producer: "polaris.artifact.presentation" })
    }

    pub fn spreadsheet(&self, mission_id: &str, path: Option<&str>, book: &WorkbookSpec, task: Option<&str>, agent: Option<&str>) -> Result<Produced, String> {
        let workspace = self.workspaces.for_mission(mission_id).map_err(|e| e.to_string())?;
        let bytes = super::xlsx::write_xlsx(book, &self.clock.now())?;
        let (rel, _) = self.target(&workspace, path, &book.title, "xlsx")?;
        workspace.write(&rel, &bytes).map_err(|e| e.to_string())?;
        let expected: Vec<String> = book.sheets.iter().flat_map(|s| s.header.iter().take(3).cloned()).collect();
        self.finish(&workspace, Finish { rel: &rel, kind: ArtifactType::Xlsx, title: &book.title, expected: &expected, glyphs: None, task, agent, producer: "polaris.artifact.spreadsheet" })
    }

    /// يسجّل ما في `outputs/` حين تكتمل المهمّة، فتظهر في المكتبة. قيس 2026-10-01: الوكيل كتب
    /// `outputs/water.md` بأداة الكتابة، والمكتبة قالت «لا مخرجات بعد» لأنها تعرض المسجَّل وحده.
    /// كل ملف يمرّ بالتحقق نفسه الذي يمرّ به التسجيل اليدوي؛ ما لا يُسجَّل نوعه يُترك. مجلد فيه
    /// `index.html` موقع واحد لا ملفات متفرقة. يعيد عدد ما سُجّل.
    pub fn register_outputs(&self, mission_id: &str, task: Option<&str>) -> usize {
        let Ok(workspace) = self.workspaces.for_mission(mission_id) else { return 0 };
        let Ok(entries) = workspace.list(Some(super::super::workspace::OUTPUTS), 6) else { return 0 };
        let sites: Vec<String> = entries
            .iter()
            .filter(|e| !e.is_dir && e.path.to_ascii_lowercase().ends_with("/index.html"))
            .filter_map(|e| e.path.rsplit_once('/').map(|(dir, _)| dir.to_string()))
            .filter(|dir| dir.contains('/'))
            .collect();
        let mut registered = 0;
        let mut targets: Vec<(String, bool)> = sites.iter().map(|d| (d.clone(), true)).collect();
        for entry in entries.iter().filter(|e| !e.is_dir) {
            if sites.iter().any(|site| entry.path.starts_with(&format!("{site}/"))) {
                continue;
            }
            if ArtifactType::from_name(&entry.path).is_some() {
                targets.push((entry.path.clone(), false));
            }
        }
        for (rel, is_dir) in targets.into_iter().take(40) {
            let fingerprint = if is_dir { directory_digest_input(&workspace, &rel).map(|input| crate::digest::sha256_hex(&input)) } else { workspace.read(&rel, super::super::workspace::MAX_FILE_BYTES).ok().map(|bytes| crate::digest::sha256_hex(&bytes)) };
            let Some(sha) = fingerprint else { continue };
            if self.store.has_same(&rel, &sha).unwrap_or(true) {
                continue;
            }
            let title = rel.rsplit('/').next().unwrap_or(&rel).to_string();
            if self.register_existing(mission_id, &rel, &title, task, None).is_ok() {
                registered += 1;
            }
        }
        registered
    }

    /// يسجّل ملفًا أو مجلدًا موجودًا في المساحة (كتبته Python أو الوكيل) بعد التحقق منه.
    pub fn register_existing(&self, mission_id: &str, rel: &str, title: &str, task: Option<&str>, agent: Option<&str>) -> Result<Produced, String> {
        let workspace = self.workspaces.for_mission(mission_id).map_err(|e| e.to_string())?;
        let path = workspace.resolve(rel, Access::Read).map_err(|e| e.to_string())?;
        let rel = workspace.relative(&path).unwrap_or_else(|| rel.to_string());
        if path.is_dir() {
            return self.register_directory(&workspace, &rel, title, task, agent);
        }
        let kind = ArtifactType::from_name(&rel).ok_or_else(|| format!("{rel} is not a file type this build registers as an artifact"))?;
        if kind == ArtifactType::Image {
            let bytes = workspace.read(&rel, super::super::workspace::MAX_FILE_BYTES).map_err(|e| e.to_string())?;
            let png = bytes.starts_with(b"\x89PNG\r\n\x1a\n");
            let jpeg = bytes.starts_with(&[0xFF, 0xD8, 0xFF]);
            let verification = Verification::from_checks(vec![("image_signature", png || jpeg, if png { "PNG" } else if jpeg { "JPEG" } else { "unknown signature" }.to_string())], vec![("bytes".into(), bytes.len() as u64)]);
            let descriptor = self
                .store
                .register(NewArtifact {
                    mission_id,
                    task_id: task,
                    artifact_type: kind,
                    title,
                    file_ref: &rel,
                    bytes_for_digest: &bytes,
                    size: bytes.len() as u64,
                    verification: &verification,
                    preview: json!({ "excerpt": "", "facts": { "bytes": bytes.len() } }),
                    producer: "polaris.artifact.register",
                    agent_id: agent,
                })
                .map_err(|e| e.to_string())?;
            return Ok(Produced { descriptor, verification });
        }
        // ملف كتبه غير الكاتب الموثوق: لا نصّ متوقَّع نعرفه سلفًا، فالتحقق بنيوي وحده.
        self.finish(&workspace, Finish { rel: &rel, kind, title, expected: &[], glyphs: None, task, agent, producer: "polaris.artifact.register" })
    }

    /// مجلد: موقع ويب إن احتوى `index.html`، وإلا مشروع شيفرة. التحقق بنيوي، بلا تشغيل.
    fn register_directory(&self, workspace: &ExecutionWorkspace, rel: &str, title: &str, task: Option<&str>, agent: Option<&str>) -> Result<Produced, String> {
        let entries = workspace.list(Some(rel), 8).map_err(|e| e.to_string())?;
        let files: Vec<&super::super::workspace::Entry> = entries.iter().filter(|e| !e.is_dir).collect();
        if files.is_empty() {
            return Err(format!("{rel} holds no file"));
        }
        let prefix = format!("{rel}/");
        let is_site = files.iter().any(|e| e.path.eq_ignore_ascii_case(&format!("{prefix}index.html")));
        let digest_input = directory_digest_input(workspace, rel).ok_or_else(|| format!("{rel} could not be read"))?;
        let mut size = 0u64;
        let mut site_files = Vec::new();
        for f in &files {
            let bytes = workspace.read(&f.path, super::super::workspace::MAX_FILE_BYTES).map_err(|e| e.to_string())?;
            size += bytes.len() as u64;
            if is_site {
                site_files.push((f.path.trim_start_matches(&prefix).to_string(), bytes));
            }
        }
        let tree: Vec<Value> = files.iter().take(300).map(|e| json!({ "path": e.path.trim_start_matches(&prefix), "size": e.size_bytes })).collect();
        let (kind, verification) = if is_site {
            let site = check_site(&site_files);
            let v = Verification::from_checks(
                vec![
                    ("index_page_present", true, "index.html".to_string()),
                    ("doctype_and_title", site.has_doctype && site.has_title, format!("{} pages", site.pages)),
                    ("local_references_resolve", site.missing_local_refs.is_empty(), site.missing_local_refs.join(", ")),
                    ("no_javascript_urls", site.javascript_urls == 0, site.javascript_urls.to_string()),
                ],
                vec![("pages".into(), site.pages as u64), ("files".into(), files.len() as u64), ("remote_references".into(), site.remote_refs.len() as u64)],
            );
            (ArtifactType::WebSite, v)
        } else {
            (ArtifactType::CodeProject, Verification::from_checks(vec![("files_present", true, format!("{} files", files.len()))], vec![("files".into(), files.len() as u64)]))
        };
        let descriptor = self
            .store
            .register(NewArtifact {
                mission_id: &workspace.mission_id,
                task_id: task,
                artifact_type: kind,
                title,
                file_ref: rel,
                bytes_for_digest: &digest_input,
                size,
                verification: &verification,
                preview: json!({ "excerpt": "", "facts": verification.facts.iter().map(|(k, v)| (k.clone(), json!(v))).collect::<serde_json::Map<_, _>>(), "tree": tree }),
                producer: "polaris.artifact.register",
                agent_id: agent,
            })
            .map_err(|e| e.to_string())?;
        Ok(Produced { descriptor, verification })
    }
}

/// لماذا رُفض نقل أو حذف في `outputs/`: خارج النطاق (منطقة أخرى، رابط)، أو معطيات خاطئة (غير موجود، الهدف قائم)، أو عطل.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputChangeError {
    OutOfScope(String),
    Invalid(String),
    Io(String),
}

/// ما تغيّر في `outputs/`: المسارات المطبّعة وعدد البطاقات التي تبعته.
pub struct OutputChange {
    pub from: String,
    pub to: Option<String>,
    pub cards: usize,
}

impl ArtifactService {
    /// يحلّ مسارًا داخل `outputs/` وحدها (لا جذرها نفسه) ويعيد صيغته المطبّعة. `inputs/` ومنطقة زمن التشغيل و`work/` خارج النطاق:
    /// الأداتان لمخرجات الوكيل، لا لملفات المستخدم ولا لمسوّداته.
    fn output_path(&self, workspace: &ExecutionWorkspace, rel: &str) -> Result<(String, PathBuf), OutputChangeError> {
        use super::super::workspace::{normalise_relative, WorkspaceError};
        let segments = normalise_relative(rel).map_err(|e| OutputChangeError::OutOfScope(e.to_string()))?;
        if !segments[0].eq_ignore_ascii_case(OUTPUTS) {
            return Err(OutputChangeError::OutOfScope(format!("{rel} is not inside {OUTPUTS}/; only files under {OUTPUTS}/ can be moved or deleted")));
        }
        if segments.len() < 2 {
            return Err(OutputChangeError::OutOfScope(format!("{OUTPUTS}/ itself cannot be moved or deleted")));
        }
        let normal = std::iter::once(OUTPUTS.to_string()).chain(segments[1..].iter().cloned()).collect::<Vec<_>>().join("/");
        let path = workspace.resolve(&normal, Access::Write).map_err(|e| match e {
            WorkspaceError::Io(m) => OutputChangeError::Io(m),
            other => OutputChangeError::OutOfScope(other.to_string()),
        })?;
        Ok((normal, path))
    }

    fn same_workspace(&self, mission_id: &str) -> impl Fn(&str) -> bool + '_ {
        let dir = self.workspaces.dir_of(mission_id);
        move |other: &str| self.workspaces.dir_of(other) == dir
    }

    /// D-MP-12: ينقل ملفًا أو مجلدًا داخل `outputs/` أو يعيد تسميته، في المضيف (الصندوق لا يملك حذف ما كتبه المضيف). لا يستبدل هدفًا
    /// قائمًا؛ تغيير حالة الأحرف وحده إعادة تسمية للملف نفسه لا تعارض. البطاقات تتبع الملف.
    pub fn move_output(&self, mission_id: &str, from: &str, to: &str) -> Result<OutputChange, OutputChangeError> {
        let workspace = self.workspaces.for_mission(mission_id).map_err(|e| OutputChangeError::Io(e.to_string()))?;
        let (from_rel, from_path) = self.output_path(&workspace, from)?;
        let (to_rel, to_path) = self.output_path(&workspace, to)?;
        let meta = std::fs::symlink_metadata(&from_path).map_err(|_| OutputChangeError::Invalid(format!("{from_rel} does not exist in the workspace")))?;
        if meta.file_type().is_symlink() {
            return Err(OutputChangeError::OutOfScope(format!("{from_rel} is a link")));
        }
        let same_file = from_rel.eq_ignore_ascii_case(&to_rel);
        if same_file && from_rel == to_rel {
            return Err(OutputChangeError::Invalid("the source and the destination are the same path".into()));
        }
        if to_rel.to_ascii_lowercase().starts_with(&format!("{}/", from_rel.to_ascii_lowercase())) {
            return Err(OutputChangeError::Invalid(format!("{from_rel} cannot be moved into itself")));
        }
        if !same_file && std::fs::symlink_metadata(&to_path).is_ok() {
            return Err(OutputChangeError::Invalid(format!("{to_rel} already exists; choose another name or delete it first")));
        }
        if let Some(parent) = to_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| OutputChangeError::Io(e.kind().to_string()))?;
        }
        // بعد إنشاء المجلد الأب: لا رابط ولا نقطة وصل على طريق الهدف.
        self.output_path(&workspace, &to_rel)?;
        std::fs::rename(&from_path, &to_path).map_err(|e| OutputChangeError::Io(e.kind().to_string()))?;
        let cards = self.store.follow_move(&from_rel, &to_rel, &self.same_workspace(mission_id)).map_err(|e| OutputChangeError::Io(e.to_string()))?;
        self.store.audit_output_change(mission_id, json!({ "operation": "MOVE", "from": from_rel, "to": to_rel, "cards": cards }));
        Ok(OutputChange { from: from_rel, to: Some(to_rel), cards })
    }

    /// D-MP-12: يحذف ملفًا أو مجلدًا داخل `outputs/` وحدها، ويحذف بطاقاته. حذف المجلد لا يتبع رابطًا داخله.
    pub fn delete_output(&self, mission_id: &str, rel: &str) -> Result<OutputChange, OutputChangeError> {
        let workspace = self.workspaces.for_mission(mission_id).map_err(|e| OutputChangeError::Io(e.to_string()))?;
        let (rel, path) = self.output_path(&workspace, rel)?;
        let meta = std::fs::symlink_metadata(&path).map_err(|_| OutputChangeError::Invalid(format!("{rel} does not exist in the workspace")))?;
        if meta.file_type().is_symlink() {
            return Err(OutputChangeError::OutOfScope(format!("{rel} is a link")));
        }
        if meta.is_dir() { std::fs::remove_dir_all(&path) } else { std::fs::remove_file(&path) }.map_err(|e| OutputChangeError::Io(e.kind().to_string()))?;
        let cards = self.store.forget_removed(&rel, &self.same_workspace(mission_id)).map_err(|e| OutputChangeError::Io(e.to_string()))?.len();
        self.store.audit_output_change(mission_id, json!({ "operation": "DELETE", "path": rel, "cards": cards }));
        Ok(OutputChange { from: rel, to: None, cards })
    }
}

/// بصمة مجلد: مسار كل ملف وبصمة محتواه بترتيب السرد. مدخل واحد للتسجيل ولكشف التكرار، فلا يختلفان.
fn directory_digest_input(workspace: &ExecutionWorkspace, rel: &str) -> Option<Vec<u8>> {
    let entries = workspace.list(Some(rel), 8).ok()?;
    let mut input = Vec::new();
    for f in entries.iter().filter(|e| !e.is_dir) {
        let bytes = workspace.read(&f.path, super::super::workspace::MAX_FILE_BYTES).ok()?;
        input.extend(f.path.as_bytes());
        input.extend(crate::digest::sha256_hex(&bytes).as_bytes());
    }
    Some(input)
}
