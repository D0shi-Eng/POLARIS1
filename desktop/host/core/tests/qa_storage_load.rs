// QA 2026-10-15 — حمل متدرّج على المخزن وسجل التدقيق، على قاعدة حقيقية في مجلد مؤقت (WAL، المفاتيح الأجنبية، القفل).
//
// ما يُقاس: خيوط متزامنة تُلحق سجلات تدقيق عبر `AuditLedger::append` نفسه الذي يستعمله المضيف، ثم يُتحقَّق من أن
// العدد كامل، وأن سلسلة البصمات متصلة، وأن `integrity_check` سليم، وأن checkpoint يترك الملف وحده كاملًا.
// الطبقات: أساس (1 خيط)، ومتوسط (4)، وعالٍ (16). الكمية صغيرة في التشغيل العادي؛ `POLARIS_QA_LOAD_SCALE` يضاعفها
// للتحمّل الطويل (soak) يدويًّا. الأزمنة تُطبع ولا تُقارن بعتبة هنا: العتبات في PERFORMANCE-PLAN.md.

use std::sync::Arc;
use std::time::Instant;

use serde_json::json;

use polaris_host_core::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord, ChainVerification};
use polaris_host_core::storage::Database;

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = polaris_host_core::test_scratch::root().join(format!("qa-load-{name}-{}", polaris_host_core::ids::new_uuid_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn percentile(sorted: &[u128], q: f64) -> u128 {
    if sorted.is_empty() {
        return 0;
    }
    let index = ((q * sorted.len() as f64).ceil() as usize).clamp(1, sorted.len()) - 1;
    sorted[index]
}

/// يشغّل طبقة واحدة ويعيد (العدد المكتوب، p50، p95، p99 بالميكروثانية، المدّة بالمللي).
fn tier(ledger: &Arc<AuditLedger>, threads: usize, per_thread: usize) -> (usize, u128, u128, u128, u128) {
    let started = Instant::now();
    let handles: Vec<_> = (0..threads)
        .map(|t| {
            let ledger = ledger.clone();
            std::thread::spawn(move || {
                let mut latencies = Vec::with_capacity(per_thread);
                for i in 0..per_thread {
                    let record = AuditRecord::new(AuditEventType::ProviderRefreshed, "qa-load", format!("t{t}-{i}"), AuditOutcome::Success, json!({ "tier_thread": t, "i": i }));
                    let began = Instant::now();
                    ledger.append(&record).expect("an append failed under load");
                    latencies.push(began.elapsed().as_micros());
                }
                latencies
            })
        })
        .collect();
    let mut all: Vec<u128> = handles.into_iter().flat_map(|h| h.join().expect("a writer panicked")).collect();
    all.sort_unstable();
    (all.len(), percentile(&all, 0.50), percentile(&all, 0.95), percentile(&all, 0.99), started.elapsed().as_millis())
}

#[test]
fn qa_load_concurrent_audit_appends_stay_complete_chained_and_intact_in_three_tiers() {
    let scale: usize = std::env::var("POLARIS_QA_LOAD_SCALE").ok().and_then(|v| v.parse().ok()).unwrap_or(1).clamp(1, 200);
    let dir = scratch("audit");
    let db = Arc::new(Database::open(&dir).unwrap());
    let ledger = Arc::new(AuditLedger::new(db.clone()));
    let before = ledger.count("PROVIDER_REFRESHED").unwrap();
    let mut written = 0usize;
    for (name, threads, per) in [("baseline", 1usize, 100usize), ("moderate", 4, 100), ("high", 16, 50)] {
        let (n, p50, p95, p99, ms) = tier(&ledger, threads, per * scale);
        written += n;
        println!("QA-LOAD tier={name} threads={threads} appends={n} p50_us={p50} p95_us={p95} p99_us={p99} wall_ms={ms}");
    }
    assert_eq!(ledger.count("PROVIDER_REFRESHED").unwrap() - before, written as u64, "an append was lost under concurrency");
    match ledger.verify().unwrap() {
        ChainVerification::Intact { records } => assert!(records >= written as u64),
        ChainVerification::Broken { at_seq, reason } => panic!("the audit chain broke at {at_seq}: {reason}"),
    }
    let integrity: String = db.with(|c| Ok(c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?)).unwrap();
    assert_eq!(integrity, "ok");
    let fk: i64 = db.with(|c| Ok(c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?)).unwrap();
    assert_eq!(fk, 0);
    db.checkpoint().unwrap();
    let wal = std::fs::metadata(dir.join("polaris.db-wal")).map(|m| m.len()).unwrap_or(0);
    assert_eq!(wal, 0, "the log was not folded into the file after the load");
    drop(ledger);
    drop(db);
    let _ = std::fs::remove_dir_all(&dir);
}
