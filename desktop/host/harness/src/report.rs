// سجلّ القياس: كل فحص بمعرّفه وحالته (PASS/FAIL/PARTIAL/BLOCKED/NOT_TESTED) وتفصيله وما قيس.
// الحالة تُكتب مما حدث فعلًا؛ لا حالة افتراضية ناجحة.

use std::path::Path;

use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Pass,
    Fail,
    Partial,
    Blocked,
    NotTested,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "PASS",
            Self::Fail => "FAIL",
            Self::Partial => "PARTIAL",
            Self::Blocked => "BLOCKED",
            Self::NotTested => "NOT_TESTED",
        }
    }
    pub fn of(ok: bool) -> Self {
        if ok {
            Self::Pass
        } else {
            Self::Fail
        }
    }
}

#[derive(Default)]
pub struct Section {
    pub checks: Vec<Value>,
}

impl Section {
    pub fn record(&mut self, id: &str, status: Status, detail: impl Into<String>, measured: Value) {
        let detail = detail.into();
        println!("  {:<11} {:<34} {}", status.as_str(), id, detail.chars().take(160).collect::<String>());
        self.checks.push(json!({ "id": id, "status": status.as_str(), "detail": detail.chars().take(2_000).collect::<String>(), "measured": measured }));
    }



    pub fn document(&self, name: &str, extra: Value) -> Value {
        let counts = ["PASS", "FAIL", "PARTIAL", "BLOCKED", "NOT_TESTED"].iter().map(|s| (s.to_string(), json!(self.checks.iter().filter(|c| c["status"] == *s).count()))).collect::<serde_json::Map<_, _>>();
        json!({ "schema_version": "1.0.0", "tool": "polaris.p08.native", "section": name, "counts": counts, "checks": self.checks, "extra": extra })
    }
}

pub fn write(dir: &Path, name: &str, value: &Value) {
    let _ = std::fs::create_dir_all(dir);
    let text = serde_json::to_string_pretty(value).unwrap_or_default().replace("\r\n", "\n");
    let _ = std::fs::write(dir.join(name), format!("{text}\n"));
}

pub fn now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    polaris_host_core::time::format_rfc3339_utc(secs)
}

/// لحظة بعد دقائق، بصيغة RFC3339 UTC.
pub fn in_minutes(minutes: i64) -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    polaris_host_core::time::format_rfc3339_utc(secs + minutes * 60)
}

/// ملف WAV صامت قصير (16 kHz، أحادي، 16 بت): عيّنة صالحة لا تحمل صوت أحد.
pub fn silent_wav() -> Vec<u8> {
    let samples = 16_000u32 / 2;
    let data = samples * 2;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&16_000u32.to_le_bytes());
    out.extend_from_slice(&32_000u32.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    out.resize(44 + data as usize, 0);
    out
}
