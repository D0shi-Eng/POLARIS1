// أدوات مشغّلَي القياس الحقيقي (eval/1 وeval/2): عمال متعدّدون، وملف JSONL يُكتب بأمان من عدّة عمال، واستئناف صحيح (G4،
// تكليف 2026-10-14).
//
// - العمال خيوط في عملية واحدة؛ لكل عامل مضيف بمجلد بيانات مستقلّ يبنيه المستدعي، وطابور حالات مشترك.
// - كل سطر يُكتب كاملًا تحت قفل واحد ثم يُفرَّغ، فلا يتداخل سطران.
// - الاستئناف: ما كُتب قبل البدء ويصلح للتخطّي (يقرّره المستدعي) لا يُعاد؛ والحالة الواحدة لا تؤخذ من الطابور إلا مرة.
// - حالة غير مصحَّحة (محجوبة بحصّة أو تعذّر مزوّد) توقف أخذ حالات جديدة في كل العمال.

#![allow(dead_code)]

use std::collections::{BTreeSet, VecDeque};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde_json::Value;

/// عدد العمال من `POLARIS_EVAL_WORKERS` (افتراضًا 1، وبحدّ 8).
pub fn workers() -> usize {
    std::env::var("POLARIS_EVAL_WORKERS").ok().and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(1).clamp(1, 8)
}

/// ملف النتائج: إلحاق فقط، بقفل واحد.
pub struct JsonlSink {
    file: Mutex<std::fs::File>,
}

impl JsonlSink {
    pub fn open(path: &Path) -> Self {
        let file = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap_or_else(|e| panic!("cannot open {}: {e}", path.display()));
        Self { file: Mutex::new(file) }
    }

    /// يكتب سطرًا كاملًا ويفرّغه قبل أن يفلت القفل.
    pub fn append(&self, value: &Value) {
        let line = format!("{value}\n");
        let mut file = self.file.lock().unwrap_or_else(|p| p.into_inner());
        file.write_all(line.as_bytes()).unwrap();
        file.flush().unwrap();
    }
}

/// معرّفات الحالات التي كُتبت سابقًا وتصلح للتخطّي. `keep` يقرّر ذلك لكل سطر (النموذج، والبصمة، وأن الحالة مصحَّحة).
pub fn done_cases(path: &Path, keep: impl Fn(&Value) -> bool) -> BTreeSet<String> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| keep(v))
        .filter_map(|v| v["case_id"].as_str().map(str::to_string))
        .collect()
}

/// يشغّل الحالات على `workers` عاملًا. `harness(i)` يبني مضيف العامل `i` (بمجلد بيانات مستقلّ)، و`run` يشغّل حالة ويعيد
/// سطرها. السطر الذي `status` فيه ليس `GRADED` يُكتب ثم يوقف أخذ حالات جديدة. يعيد عدد ما كُتب.
pub fn run_pool<C: Send, H>(workers: usize, cases: Vec<C>, sink: &JsonlSink, harness: impl Fn(usize) -> H + Sync, run: impl Fn(&H, &C) -> Value + Sync) -> usize {
    let queue: Mutex<VecDeque<C>> = Mutex::new(cases.into());
    let stop = AtomicBool::new(false);
    let written = std::sync::atomic::AtomicUsize::new(0);
    std::thread::scope(|threads| {
        for i in 0..workers {
            let (queue, stop, written, harness, run) = (&queue, &stop, &written, &harness, &run);
            threads.spawn(move || {
                let h = harness(i);
                loop {
                    if stop.load(Ordering::SeqCst) {
                        return;
                    }
                    let Some(case) = queue.lock().unwrap_or_else(|p| p.into_inner()).pop_front() else { return };
                    let mut result = run(&h, &case);
                    result["worker"] = serde_json::json!(i);
                    sink.append(&result);
                    written.fetch_add(1, Ordering::SeqCst);
                    if result["status"] != serde_json::json!("GRADED") {
                        eprintln!("STOPPED {}: {} on {} ({:?})", result["status"], result["stop_reason"], result["case_id"], result["chat_failures"]);
                        stop.store(true, Ordering::SeqCst);
                        return;
                    }
                }
            });
        }
    });
    written.load(Ordering::SeqCst)
}
