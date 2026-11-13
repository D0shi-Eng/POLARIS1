// أدوات اختبار Phase-07: مضيف حقيقي على مجلد بيانات حقيقي، وأسماء المشاريع فيه،
// وإفساد ملف القاعدة إفسادًا مقصودًا يُبقي ترويستها.
//
// المضيف يُبنى عبر أدوات Phase-06 نفسها (البوابة الحقيقية وظرف 1.6)، فما تثبته هذه
// الاختبارات يمرّ بمسار المنتج، لا بمسار مختصر للاختبار.

#![allow(dead_code)]

#[path = "../p06_support/mod.rs"]
pub mod p06;

use std::path::{Path, PathBuf};

use serde_json::json;

pub use p06::Harness;

pub fn temp_dir(name: &str) -> PathBuf {
    let dir = polaris_host_core::test_scratch::root().join(format!("p07-{name}-{}", p06::uuid()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// مضيف كامل على مجلد البيانات، بلا نموذج، مع موصل الاختبار (لا يُستعمل هنا).
pub fn host(dir: &Path) -> Harness {
    p06::build_with(Some(dir.to_path_buf()), None, p06::connector_fixture())
}

/// مضيف بلا شرط على نجاح المراحل: لاختبار الحالة التي يُغلق فيها المخزن.
pub fn bare_host(dir: &Path) -> polaris_host_core::DesktopHost {
    let config = polaris_host_core::p02::Phase02Config { data_dir: Some(dir.to_path_buf()), ..polaris_host_core::p02::Phase02Config::for_tests() };
    polaris_host_core::DesktopHost::with_phase02(polaris_host_core::services::platform_info::PlatformInfoService::default(), config)
}

pub fn create_project(h: &Harness, name: &str) -> String {
    h.ok("project.create", json!({ "name": name }))["project"]["project_id"].as_str().unwrap().to_string()
}

pub fn project_names(h: &Harness) -> Vec<String> {
    let mut names: Vec<String> = h.ok("project.list", json!({ "include_archived": true }))["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap().to_string())
        .collect();
    names.sort();
    names
}

/// يفسد صفحات القاعدة بعد الأولى ويُبقي الترويسة: ملف «قاعدة» تالف لا «ليس قاعدة».
pub fn corrupt_pages(db: &Path) {
    let mut bytes = std::fs::read(db).unwrap();
    assert!(bytes.len() > 8192, "the store is too small to corrupt meaningfully");
    for byte in bytes.iter_mut().skip(4096) {
        *byte = 0xA5;
    }
    std::fs::write(db, bytes).unwrap();
}

pub fn store(dir: &Path) -> PathBuf {
    dir.join("polaris.db")
}

pub fn now() -> String {
    polaris_host_core::time::now_rfc3339_utc()
}
