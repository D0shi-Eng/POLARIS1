// إعدادات Phase-08 القليلة التي لا تملكها طبقة إعدادات Phase-06: نقطة نهاية التفريغ الصوتي
// المحلية، والنموذج الصوتي، وتفعيل محرّك المتصفّح. المفاتيح مغلقة بقيد في القاعدة نفسها.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::storage::Database;

pub const KEYS: [&str; 18] = [
    "voice.transcription_endpoint",
    "voice.transcription_model",
    "workspace.export_folder_label",
    "browser.engine_enabled",
    "web.search_endpoint",
    "profile.nickname",
    "profile.profession",
    "profile.about",
    "profile.instructions",
    // v19 (تكليف 2026-10-19): مزوّد البحث، وإشعارات النظام وصوتها. مفتاح API للبحث في مخزن الاعتماد لا هنا.
    "web.search_provider",
    "notifications.enabled",
    "notifications.sound",
    // v23 (PHASE-12): الاسترجاع الدلالي للذاكرة (`p08/semantic_memory.rs`). العنوان على هذا الجهاز وحده.
    "memory.semantic.enabled",
    "memory.semantic.endpoint",
    "memory.semantic.model",
    "memory.semantic.min_similarity",
    "memory.semantic.query_prefix",
    "memory.semantic.document_prefix",
];

/// مفاتيح يضبطها `integration.settings.set` العامّ. مفاتيح الاسترجاع الدلالي لا: طريقها الوحيد `memory.semantic.set`، الذي يفحص
/// العنوان (على هذا الجهاز) والنموذج والحدّ ثم يطبّق الإعداد على الذاكرة.
pub fn generic(key: &str) -> bool {
    KEYS.contains(&key) && !key.starts_with("memory.semantic.")
}

/// حدّ كل حقل من «تخصيص» بالأحرف، كما في مانوس (مزيد عنك 2000، تعليمات مخصّصة 3000). غيره 400 كما كان.
fn max_chars(key: &str) -> usize {
    match key {
        "profile.nickname" | "profile.profession" => 80,
        "profile.about" => 2_000,
        "profile.instructions" => 3_000,
        _ => 400,
    }
}

pub struct Phase08Settings {
    db: Arc<Database>,
}

impl Phase08Settings {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        if !KEYS.contains(&key) {
            return None;
        }
        self.db
            .with(|c| Ok(c.query_row("SELECT value_json FROM p08_settings WHERE setting_key = ?1", params![key], |r| r.get::<_, String>(0)).optional()?))
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn get_str(&self, key: &str) -> Option<String> {
        self.get(key).and_then(|v| v.as_str().map(str::to_string)).filter(|s| !s.trim().is_empty())
    }

    pub fn set(&self, key: &str, value: &Value, now: &str) -> Result<(), String> {
        if !KEYS.contains(&key) {
            return Err(format!("{key} is not a Phase-08 setting"));
        }
        if value.as_str().is_some_and(|s| s.chars().count() > max_chars(key)) {
            return Err("the value is too long".into());
        }
        let text = value.to_string();
        if text.len() > 16_000 {
            return Err("the value is too long".into());
        }
        self.db
            .with(|c| {
                c.execute(
                    "INSERT INTO p08_settings (setting_key, value_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                    params![key, text, now],
                )?;
                Ok(())
            })
            .map_err(|e| e.to_string())
    }

    pub fn all(&self) -> serde_json::Map<String, Value> {
        // المفاتيح العامّة وحدها: إعداد الاسترجاع الدلالي يقرؤه `memory.semantic.status`.
        KEYS.iter().filter(|k| generic(k)).filter_map(|k| self.get(k).map(|v| (k.to_string(), v))).collect()
    }
}

/// الملف الشخصي من «تخصيص» نصًّا واحدًا يدخل تعليمة النظام في كل مهمّة، أو لا شيء إن لم يكتب المستخدم شيئًا.
pub fn profile_text(settings: &Phase08Settings) -> Option<String> {
    let field = |key: &str| settings.get_str(key).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let mut about = Vec::new();
    if let Some(v) = field("profile.nickname") {
        about.push(format!("- What the user wants to be called: {v}"));
    }
    if let Some(v) = field("profile.profession") {
        about.push(format!("- Profession: {v}"));
    }
    if let Some(v) = field("profile.about") {
        about.push(format!("- About the user, in their words:
{v}"));
    }
    let instructions = field("profile.instructions");
    if about.is_empty() && instructions.is_none() {
        return None;
    }
    let mut out = String::new();
    if !about.is_empty() {
        out.push_str(&about.join("
"));
    }
    if let Some(v) = instructions {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&format!("- The user's custom instructions for every task:
{v}"));
    }
    Some(out)
}
