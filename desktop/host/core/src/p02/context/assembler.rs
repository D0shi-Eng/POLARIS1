// المجمِّع الحتمي.
//
// المدخلات نفسها تعطي الحزمة نفسها بايتًا ببايت: الترتيب ثابت (تعليمات المستخدم،
// ثم الملاحظات، ثم الملفات بمرجعها)، والميزانيات صلبة، وكل عنصر يحمل مصدره وصنف
// ثقته وبصمته وتقدير رموزه، وكل ما أُسقط يُذكر بسببه. لا مصدر يدخل خفية.

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;

use super::classify::{is_sensitive, is_skipped_directory};
use super::model::{ContentClass, ContextSource, SourceType, TrustClass};
use super::paths::{relative_display, resolve};
use super::reader::{snapshot, truncate_utf8, ReadFailure};
use super::sources::SourceService;
use crate::digest::sha256_hex;
use crate::p02::errors::P02Error;
use crate::p02::projects::workspace::is_reparse_point;
use crate::p02::projects::{Project, ProjectStatus};

/// الحدود الصلبة. الطلب يستطيع خفضها لا رفعها.
pub const MAX_SOURCES: usize = 32;
pub const MAX_FILES: usize = 64;
pub const MAX_TOTAL_BYTES: usize = 512 * 1024;
pub const MAX_SINGLE_SOURCE_BYTES: usize = 128 * 1024;
/// ميزانية الرموز حين لا تُعرف نافذة السياق: محافظة عمدًا.
pub const UNKNOWN_WINDOW_TOKENS: u64 = 8192;
pub const MAX_KNOWN_WINDOW_TOKENS: u64 = 200_000;
/// عمق توسيع المجلد.
const MAX_DEPTH: usize = 2;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InclusionReason {
    UserSelected,
    FolderMember,
    WorkspaceMember,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OmissionReason {
    BudgetExceeded,
    MaxFilesExceeded,
    NotText,
    InvalidEncoding,
    SensitiveFileExcluded,
    OutOfScope,
    Missing,
    NotReadable,
    ReparsePoint,
    SourceRemoved,
    UnknownSource,
    TooLargeToRead,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TokenEstimate {
    pub value: u64,
    pub provenance: &'static str,
    pub method: &'static str,
}

/// تقدير الرموز: بايتات UTF-8 مقسومة على أربعة، مقرّبة للأعلى. تقدير، ويُوسم كذلك.
pub fn estimate_tokens(bytes: usize) -> TokenEstimate {
    TokenEstimate { value: (bytes as u64).div_ceil(4), provenance: "ESTIMATED", method: "UTF8_BYTES_DIV_4" }
}

#[derive(Debug, Clone, Serialize)]
pub struct ItemView {
    pub source_id: String,
    pub item_reference: String,
    pub trust_class: TrustClass,
    pub content_class: ContentClass,
    pub inclusion_reason: InclusionReason,
    pub digest: String,
    pub byte_count: u64,
    pub included_bytes: u64,
    pub estimated_tokens: TokenEstimate,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct OmittedView {
    pub source_id: String,
    pub item_reference: String,
    pub reason: OmissionReason,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetView {
    pub max_sources: u64,
    pub max_files: u64,
    pub max_total_bytes: u64,
    pub max_single_source_bytes: u64,
    pub max_tokens: u64,
    pub context_window_known: bool,
    pub reserved_output_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BundleView {
    pub project_id: String,
    pub bundle_digest: String,
    pub items: Vec<ItemView>,
    pub omitted: Vec<OmittedView>,
    pub instruction_trust_class: &'static str,
    pub total_bytes: u64,
    pub estimated_tokens: TokenEstimate,
    pub budget: BudgetView,
    pub truncated: bool,
}

/// عنصر مُدرج بمحتواه. المحتوى يبقى في المضيف.
#[derive(Debug, Clone)]
pub struct IncludedItem {
    pub view: ItemView,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct Bundle {
    pub view: BundleView,
    pub items: Vec<IncludedItem>,
}

pub struct BundleRequest<'a> {
    pub project: &'a Project,
    pub source_ids: &'a [String],
    pub instruction: &'a str,
    pub context_window: Option<u64>,
    pub reserved_output_tokens: u64,
    pub max_tokens: Option<u64>,
    pub max_files: Option<usize>,
}

struct Candidate {
    source_id: String,
    reference: String,
    trust: TrustClass,
    reason: InclusionReason,
    kind: CandidateKind,
}

enum CandidateKind {
    Text(String, ContentClass),
    File(std::path::PathBuf),
}

pub struct Assembler {
    sources: Arc<SourceService>,
}

fn rank(source: &ContextSource) -> u8 {
    match source.source_type {
        SourceType::UserInstruction => 0,
        SourceType::TextNote => 1,
        SourceType::File => 2,
        SourceType::Folder => 3,
        SourceType::WorkspaceRoot => 4,
        SourceType::SystemContext => 5,
    }
}

/// ملفات مجلد بترتيب ثابت وعمق محدود، بلا نقاط إعادة توجيه ولا مجلدات مستبعدة.
fn walk_folder(root: &Path, dir: &Path, depth: usize, out: &mut Vec<std::path::PathBuf>, limit: usize, skipped: &mut Vec<(String, OmissionReason)>) {
    if out.len() >= limit {
        return;
    }
    let Ok(read) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = read.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        let Ok(meta) = std::fs::symlink_metadata(&path) else { continue };
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let rel = relative_display(root, &path).unwrap_or_else(|| name.clone());
        if is_reparse_point(&meta) {
            skipped.push((rel, OmissionReason::ReparsePoint));
            continue;
        }
        if meta.is_dir() {
            if depth + 1 < MAX_DEPTH + 1 && !is_skipped_directory(&name) {
                walk_folder(root, &path, depth + 1, out, limit, skipped);
            }
            continue;
        }
        if is_sensitive(&name) {
            skipped.push((rel, OmissionReason::SensitiveFileExcluded));
            continue;
        }
        if out.len() >= limit {
            skipped.push((rel, OmissionReason::MaxFilesExceeded));
            continue;
        }
        out.push(path);
    }
}

impl Assembler {
    pub fn new(sources: Arc<SourceService>) -> Self {
        Self { sources }
    }

    pub fn assemble(&self, request: &BundleRequest<'_>) -> Result<Bundle, P02Error> {
        let project = request.project;
        if project.status != ProjectStatus::Active {
            return Err(P02Error::Conflict("the project is archived".into()));
        }
        if request.source_ids.len() > MAX_SOURCES {
            return Err(P02Error::invalid("/source_ids", "too many sources"));
        }
        let max_files = request.max_files.unwrap_or(MAX_FILES).clamp(1, MAX_FILES);
        let window_known = request.context_window.is_some();
        let ceiling = match request.context_window {
            Some(window) => window.saturating_sub(request.reserved_output_tokens).min(MAX_KNOWN_WINDOW_TOKENS),
            None => UNKNOWN_WINDOW_TOKENS,
        };
        let max_tokens = request.max_tokens.map(|t| t.min(ceiling)).unwrap_or(ceiling).max(1);
        let max_total_bytes = MAX_TOTAL_BYTES.min((max_tokens as usize).saturating_mul(4));

        let mut omitted: Vec<OmittedView> = Vec::new();
        let mut selected: Vec<ContextSource> = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for id in request.source_ids {
            if !seen.insert(id.clone()) {
                continue;
            }
            match self.sources.get(&project.project_id, id)? {
                None => omitted.push(OmittedView { source_id: id.clone(), item_reference: id.clone(), reason: OmissionReason::UnknownSource }),
                Some((source, false)) => omitted.push(OmittedView { source_id: id.clone(), item_reference: source.reference, reason: OmissionReason::SourceRemoved }),
                Some((source, true)) => selected.push(source),
            }
        }
        selected.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.reference.cmp(&b.reference)).then_with(|| a.source_id.cmp(&b.source_id)));

        // ١ — المرشّحون بترتيب ثابت.
        let mut candidates: Vec<Candidate> = Vec::new();
        let mut file_count = 0usize;
        for source in &selected {
            match source.source_type {
                SourceType::UserInstruction | SourceType::TextNote => candidates.push(Candidate {
                    source_id: source.source_id.clone(),
                    reference: source.display_name.clone(),
                    trust: if source.source_type == SourceType::UserInstruction { TrustClass::DirectUserInstruction } else { TrustClass::UntrustedContent },
                    reason: InclusionReason::UserSelected,
                    kind: CandidateKind::Text(source.text_body.clone().unwrap_or_default(), ContentClass::Documentation),
                }),
                SourceType::File | SourceType::Folder | SourceType::WorkspaceRoot => {
                    let Some(root) = &project.workspace_root else {
                        omitted.push(OmittedView { source_id: source.source_id.clone(), item_reference: source.reference.clone(), reason: OmissionReason::OutOfScope });
                        continue;
                    };
                    let path = match resolve(root, &source.reference) {
                        Ok(p) => p,
                        Err(denial) => {
                            let reason = match denial {
                                super::paths::PathDenial::Missing => OmissionReason::Missing,
                                super::paths::PathDenial::ReparsePoint => OmissionReason::ReparsePoint,
                                super::paths::PathDenial::NotReadable => OmissionReason::NotReadable,
                                _ => OmissionReason::OutOfScope,
                            };
                            omitted.push(OmittedView { source_id: source.source_id.clone(), item_reference: source.reference.clone(), reason });
                            continue;
                        }
                    };
                    if source.source_type == SourceType::File {
                        if file_count >= max_files {
                            omitted.push(OmittedView { source_id: source.source_id.clone(), item_reference: source.reference.clone(), reason: OmissionReason::MaxFilesExceeded });
                            continue;
                        }
                        file_count += 1;
                        candidates.push(Candidate {
                            source_id: source.source_id.clone(),
                            reference: source.reference.clone(),
                            trust: TrustClass::UntrustedContent,
                            reason: InclusionReason::UserSelected,
                            kind: CandidateKind::File(path),
                        });
                    } else {
                        let mut files = Vec::new();
                        let mut skipped = Vec::new();
                        walk_folder(Path::new(root), &path, 0, &mut files, max_files.saturating_sub(file_count), &mut skipped);
                        for (reference, reason) in skipped {
                            omitted.push(OmittedView { source_id: source.source_id.clone(), item_reference: reference, reason });
                        }
                        let reason = if source.source_type == SourceType::Folder { InclusionReason::FolderMember } else { InclusionReason::WorkspaceMember };
                        for file in files {
                            file_count += 1;
                            let reference = relative_display(Path::new(root), &file).unwrap_or_default();
                            candidates.push(Candidate { source_id: source.source_id.clone(), reference, trust: TrustClass::UntrustedContent, reason, kind: CandidateKind::File(file) });
                        }
                    }
                }
                SourceType::SystemContext => {}
            }
        }

        // ٢ — القراءة والإدراج ضمن الميزانية.
        let instruction_bytes = request.instruction.len();
        let mut used_tokens = estimate_tokens(instruction_bytes).value;
        let mut total_bytes = 0usize;
        let mut items: Vec<IncludedItem> = Vec::new();
        let mut any_truncated = false;
        for candidate in candidates {
            let (text, class, digest, byte_count) = match candidate.kind {
                CandidateKind::Text(text, class) => {
                    let digest = sha256_hex(text.as_bytes());
                    let len = text.len() as u64;
                    (text, class, digest, len)
                }
                CandidateKind::File(path) => {
                    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    if is_sensitive(&name) {
                        omitted.push(OmittedView { source_id: candidate.source_id, item_reference: candidate.reference, reason: OmissionReason::SensitiveFileExcluded });
                        continue;
                    }
                    let snap = match snapshot(&path) {
                        Ok(s) => s,
                        Err(ReadFailure::NotAFile) => {
                            omitted.push(OmittedView { source_id: candidate.source_id, item_reference: candidate.reference, reason: OmissionReason::Missing });
                            continue;
                        }
                        Err(ReadFailure::TooLarge) => {
                            omitted.push(OmittedView { source_id: candidate.source_id, item_reference: candidate.reference, reason: OmissionReason::TooLargeToRead });
                            continue;
                        }
                        Err(ReadFailure::NotReadable) => {
                            omitted.push(OmittedView { source_id: candidate.source_id, item_reference: candidate.reference, reason: OmissionReason::NotReadable });
                            continue;
                        }
                    };
                    let (Some(bytes), Some(digest)) = (snap.bytes, snap.digest) else {
                        omitted.push(OmittedView { source_id: candidate.source_id, item_reference: candidate.reference, reason: OmissionReason::TooLargeToRead });
                        continue;
                    };
                    if !snap.class.is_text() {
                        omitted.push(OmittedView { source_id: candidate.source_id, item_reference: candidate.reference, reason: OmissionReason::NotText });
                        continue;
                    }
                    let Ok(text) = String::from_utf8(bytes) else {
                        omitted.push(OmittedView { source_id: candidate.source_id, item_reference: candidate.reference, reason: OmissionReason::InvalidEncoding });
                        continue;
                    };
                    let len = text.len() as u64;
                    (text, snap.class, digest, len)
                }
            };
            let remaining_tokens = max_tokens.saturating_sub(used_tokens);
            let remaining_bytes = max_total_bytes.saturating_sub(total_bytes).min((remaining_tokens as usize).saturating_mul(4));
            let allowed = remaining_bytes.min(MAX_SINGLE_SOURCE_BYTES);
            if allowed < 256 && !text.is_empty() {
                omitted.push(OmittedView { source_id: candidate.source_id, item_reference: candidate.reference, reason: OmissionReason::BudgetExceeded });
                continue;
            }
            let (cut, truncated) = truncate_utf8(&text, allowed);
            let included = cut.len();
            let estimate = estimate_tokens(included);
            used_tokens += estimate.value;
            total_bytes += included;
            any_truncated |= truncated;
            items.push(IncludedItem {
                view: ItemView {
                    source_id: candidate.source_id,
                    item_reference: candidate.reference.chars().take(512).collect(),
                    trust_class: candidate.trust,
                    content_class: class,
                    inclusion_reason: candidate.reason,
                    digest,
                    byte_count,
                    included_bytes: included as u64,
                    estimated_tokens: estimate,
                    truncated,
                },
                content: cut.to_string(),
            });
        }

        // ٣ — بصمة الحزمة: ترتيب العناصر، ومراجعها، وبصماتها، وما أُدرج منها، والتعليمة.
        let mut material = format!("project={}\ninstruction={}\n", project.project_id, sha256_hex(request.instruction.as_bytes()));
        for item in &items {
            material.push_str(&format!("{}|{}|{}|{}\n", item.view.source_id, item.view.item_reference, item.view.digest, item.view.included_bytes));
        }
        omitted.truncate(512);
        let view = BundleView {
            project_id: project.project_id.clone(),
            bundle_digest: sha256_hex(material.as_bytes()),
            items: items.iter().map(|i| i.view.clone()).collect(),
            omitted,
            instruction_trust_class: "DIRECT_USER_INSTRUCTION",
            total_bytes: total_bytes as u64,
            estimated_tokens: TokenEstimate { value: used_tokens, provenance: "ESTIMATED", method: "UTF8_BYTES_DIV_4" },
            budget: BudgetView {
                max_sources: MAX_SOURCES as u64,
                max_files: max_files as u64,
                max_total_bytes: max_total_bytes.max(1) as u64,
                max_single_source_bytes: MAX_SINGLE_SOURCE_BYTES as u64,
                max_tokens,
                context_window_known: window_known,
                reserved_output_tokens: request.reserved_output_tokens,
            },
            truncated: any_truncated,
        };
        Ok(Bundle { view, items })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p02::context::sources::tests::setup;
    use crate::p02::context::sources::AddSource;

    fn add_file(s: &SourceService, p: &Project, reference: &str) -> String {
        s.add(&p.project_id, AddSource { source_type: SourceType::File, reference: Some(reference.into()), text: None, display_name: None }).unwrap().source_id
    }

    fn request<'a>(p: &'a Project, ids: &'a [String]) -> BundleRequest<'a> {
        BundleRequest { project: p, source_ids: ids, instruction: "summarise", context_window: None, reserved_output_tokens: 512, max_tokens: None, max_files: None }
    }

    #[test]
    fn an_empty_selection_is_an_empty_bundle() {
        let (s, p, dir, _) = setup();
        let assembler = Assembler::new(s.clone());
        let bundle = assembler.assemble(&request(&p, &[])).unwrap();
        assert!(bundle.items.is_empty());
        assert_eq!(bundle.view.budget.max_tokens, UNKNOWN_WINDOW_TOKENS);
        assert!(!bundle.view.budget.context_window_known);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_same_inputs_give_the_same_bundle() {
        let (s, p, dir, _) = setup();
        std::fs::write(dir.join("docs").join("b.md"), "bbb").unwrap();
        let a = add_file(&s, &p, "docs/readme.md");
        let b = add_file(&s, &p, "docs/b.md");
        let assembler = Assembler::new(s.clone());
        let first = assembler.assemble(&request(&p, &[b.clone(), a.clone()])).unwrap();
        let second = assembler.assemble(&request(&p, &[a, b])).unwrap();
        assert_eq!(first.view.bundle_digest, second.view.bundle_digest);
        let refs: Vec<_> = first.view.items.iter().map(|i| i.item_reference.clone()).collect();
        assert_eq!(refs, vec!["docs/b.md", "docs/readme.md"]);
        assert!(first.view.items.iter().all(|i| i.trust_class == TrustClass::UntrustedContent));
        assert!(first.view.items.iter().all(|i| i.estimated_tokens.provenance == "ESTIMATED"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_token_budget_truncates_then_omits() {
        let (s, p, dir, _) = setup();
        std::fs::write(dir.join("docs").join("big.md"), "x".repeat(40_000)).unwrap();
        std::fs::write(dir.join("docs").join("c.md"), "y".repeat(5_000)).unwrap();
        let big = add_file(&s, &p, "docs/big.md");
        let c = add_file(&s, &p, "docs/c.md");
        let assembler = Assembler::new(s.clone());
        let bundle = assembler.assemble(&BundleRequest { max_tokens: Some(2_000), ..request(&p, &[big, c]) }).unwrap();
        assert!(bundle.view.estimated_tokens.value <= 2_000);
        assert_eq!(bundle.items.len(), 1);
        assert!(bundle.items[0].view.truncated);
        assert!(bundle.view.omitted.iter().any(|o| o.reason == OmissionReason::BudgetExceeded));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_single_source_never_exceeds_its_cap() {
        let (s, p, dir, _) = setup();
        std::fs::write(dir.join("docs").join("huge.md"), "z".repeat(600_000)).unwrap();
        let huge = add_file(&s, &p, "docs/huge.md");
        let assembler = Assembler::new(s.clone());
        let bundle = assembler.assemble(&BundleRequest { context_window: Some(1_000_000), ..request(&p, &[huge]) }).unwrap();
        assert!(bundle.items[0].view.included_bytes as usize <= MAX_SINGLE_SOURCE_BYTES);
        assert_eq!(bundle.view.budget.max_tokens, MAX_KNOWN_WINDOW_TOKENS);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_workspace_expansion_skips_sensitive_binary_and_invalid_files() {
        let (s, p, dir, _) = setup();
        std::fs::write(dir.join("docs").join("blob.md"), [0u8, 1]).unwrap();
        std::fs::write(dir.join("docs").join("bad.txt"), [0xffu8, 0xfe]).unwrap();
        std::fs::write(dir.join("docs").join("pic.png"), [1u8, 2]).unwrap();
        let root = s.list(&p.project_id).unwrap().into_iter().find(|x| x.source_type == SourceType::WorkspaceRoot).unwrap();
        let assembler = Assembler::new(s.clone());
        let bundle = assembler.assemble(&request(&p, &[root.source_id])).unwrap();
        let reasons: Vec<_> = bundle.view.omitted.iter().map(|o| (o.item_reference.clone(), o.reason)).collect();
        assert!(reasons.contains(&(".env".into(), OmissionReason::SensitiveFileExcluded)), "{reasons:?}");
        assert!(reasons.contains(&("docs/blob.md".into(), OmissionReason::NotText)), "{reasons:?}");
        assert!(reasons.contains(&("docs/bad.txt".into(), OmissionReason::InvalidEncoding)), "{reasons:?}");
        assert!(reasons.contains(&("docs/pic.png".into(), OmissionReason::NotText)), "{reasons:?}");
        assert!(bundle.items.iter().any(|i| i.view.item_reference == "docs/readme.md" && i.view.inclusion_reason == InclusionReason::WorkspaceMember));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_removed_and_deleted_sources_are_named_not_hidden() {
        let (s, p, dir, _) = setup();
        let a = add_file(&s, &p, "docs/readme.md");
        std::fs::remove_file(dir.join("docs").join("readme.md")).unwrap();
        let note = s.add(&p.project_id, AddSource { source_type: SourceType::TextNote, reference: None, text: Some("n".into()), display_name: Some("n".into()) }).unwrap();
        s.remove(&p.project_id, &note.source_id).unwrap();
        let unknown = crate::ids::new_uuid_v4();
        let assembler = Assembler::new(s.clone());
        let bundle = assembler.assemble(&request(&p, &[a, note.source_id, unknown])).unwrap();
        let reasons: Vec<_> = bundle.view.omitted.iter().map(|o| o.reason).collect();
        assert!(reasons.contains(&OmissionReason::Missing));
        assert!(reasons.contains(&OmissionReason::SourceRemoved));
        assert!(reasons.contains(&OmissionReason::UnknownSource));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_file_limit_is_enforced() {
        let (s, p, dir, _) = setup();
        let mut ids = Vec::new();
        for i in 0..4 {
            std::fs::write(dir.join("docs").join(format!("f{i}.md")), "x").unwrap();
            ids.push(add_file(&s, &p, &format!("docs/f{i}.md")));
        }
        let assembler = Assembler::new(s.clone());
        let bundle = assembler.assemble(&BundleRequest { max_files: Some(2), ..request(&p, &ids) }).unwrap();
        assert_eq!(bundle.items.len(), 2);
        assert_eq!(bundle.view.omitted.iter().filter(|o| o.reason == OmissionReason::MaxFilesExceeded).count(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
