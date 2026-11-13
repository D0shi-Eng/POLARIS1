// تجهيزات القياس (TEST FIXTURE): موقع محلي على الحلقة يبني محتواه بجافاسكربت ويحاول ما لا يجوز،
// وملفات مدخلات لمهامّ A..E والمعيار. كلها مولَّدة هنا، فلا بيانات مستخدم في أي دليل.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

pub const SHOP_PAGE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Fixture Shop</title></head><body>
<h1 id="h">Loading…</h1>
<table id="prices"><thead><tr><th>Product</th><th>Price</th><th>Stock</th></tr></thead><tbody id="rows"></tbody></table>
<label for="q">Search</label><input id="q" type="text" placeholder="Search products">
<button id="go" onclick="filter()">Filter</button>
<select id="sort" onchange="document.getElementById('sorted').textContent='sorted by '+this.value"><option value="name">Name</option><option value="price">Price</option></select>
<p id="sorted"></p>
<input id="pw" type="password" placeholder="Password">
<form id="f" method="post" action="/submit"><input name="note" id="note" type="text" placeholder="Note"><button id="send" type="submit">Send note</button></form>
<a id="next" href="/next">Next page</a>
<a id="dl" href="/file.bin">Download file</a>
<p id="probe"></p>
<script>
  let items = [];
  function render(list) { document.getElementById('rows').innerHTML = list.map(i => '<tr><td>' + i.name + '</td><td>' + i.price.toFixed(2) + '</td><td>' + i.stock + '</td></tr>').join(''); }
  function filter() { const q = document.getElementById('q').value.toLowerCase(); render(items.filter(i => i.name.toLowerCase().includes(q))); document.getElementById('h').textContent = 'Filtered: ' + q; }
  fetch('/data.json').then(r => r.json()).then(d => { items = d.items; document.getElementById('h').textContent = 'Catalogue ' + d.version; render(items); });
  fetch('http://169.254.169.254/latest/meta-data/').then(() => { document.getElementById('probe').textContent += ' metadata-reached'; }).catch(() => { document.getElementById('probe').textContent += ' metadata-blocked'; });
  fetch('/redirect').then(() => { document.getElementById('probe').textContent += ' redirect-followed'; }).catch(() => { document.getElementById('probe').textContent += ' redirect-blocked'; });
  alert('fixture alert');
</script></body></html>"#;

pub const DATA_JSON: &str = r#"{"version":"v7","items":[{"name":"Alpha lamp","price":24.5,"stock":12},{"name":"Beta chair","price":89.0,"stock":3},{"name":"Gamma desk","price":240.0,"stock":7},{"name":"Delta shelf","price":61.25,"stock":0}]}"#;

pub struct Web {
    pub port: u16,
    pub hits: Arc<AtomicUsize>,
    pub posts: Arc<AtomicUsize>,
}

impl Web {
    pub fn base(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
    pub fn posts(&self) -> usize {
        self.posts.load(Ordering::SeqCst)
    }
}

pub fn serve() -> Web {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port for the fixture site");
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    let hits = Arc::new(AtomicUsize::new(0));
    let posts = Arc::new(AtomicUsize::new(0));
    let (h, p) = (hits.clone(), posts.clone());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { continue };
            let (h, p) = (h.clone(), p.clone());
            std::thread::spawn(move || {
                h.fetch_add(1, Ordering::SeqCst);
                let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(5)));
                let mut buf = vec![0u8; 16384];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let line = req.lines().next().unwrap_or("").to_string();
                let mut parts = line.split_whitespace();
                let method = parts.next().unwrap_or("").to_string();
                let path = parts.next().unwrap_or("/").to_string();
                let (status, ctype, extra, body): (&str, &str, String, Vec<u8>) = match (method.as_str(), path.as_str()) {
                    ("GET", "/") => ("200 OK", "text/html; charset=utf-8", String::new(), SHOP_PAGE.as_bytes().to_vec()),
                    ("GET", "/data.json") => ("200 OK", "application/json", String::new(), DATA_JSON.as_bytes().to_vec()),
                    ("GET", "/next") => ("200 OK", "text/html; charset=utf-8", String::new(), b"<!doctype html><title>Next</title><p>Second page reached</p>".to_vec()),
                    ("GET", "/redirect") => ("302 Found", "text/plain", "Location: http://10.0.0.1/admin\r\n".into(), Vec::new()),
                    ("GET", "/file.bin") => ("200 OK", "application/octet-stream", "Content-Disposition: attachment; filename=\"report.bin\"\r\n".into(), b"BINARYDATA".to_vec()),
                    ("POST", "/submit") => {
                        p.fetch_add(1, Ordering::SeqCst);
                        ("200 OK", "text/html", String::new(), b"<p>note received</p>".to_vec())
                    }
                    _ => ("404 Not Found", "text/plain", String::new(), b"no".to_vec()),
                };
                let head = format!("HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = s.write_all(head.as_bytes());
                let _ = s.write_all(&body);
            });
        }
    });
    Web { port, hits, posts }
}

/// ملاحظات نصّية لمهمّة A: ثلاث وثائق قصيرة بحقائق يمكن التحقّق من ظهورها في الملخّص.
pub fn mission_a_notes() -> Vec<(&'static str, &'static str)> {
    vec![
        ("meeting-2026-09-01.txt", "Project Orion kickoff.\nDecision: the pilot starts in Riyadh on 15 October.\nBudget approved: 180,000 SAR.\nOwner: Layla (operations).\n"),
        ("meeting-2026-09-08.txt", "Orion weekly.\nRisk: the vendor contract is not signed yet.\nAction: Omar to follow up with the vendor by 12 September.\nPilot sites: Riyadh and Jeddah.\n"),
        ("meeting-2026-09-15.txt", "Orion weekly.\nThe vendor contract was signed on 14 September.\nThe Jeddah site moves to November.\nNext review: 29 September.\n"),
    ]
}

/// بيانات مهمّة B: مبيعات شهرية لثلاث مناطق. المجاميع معروفة سلفًا للتحقّق.
pub fn mission_b_csv() -> String {
    let rows = [("Jan", 120, 95, 60), ("Feb", 135, 90, 72), ("Mar", 150, 110, 80), ("Apr", 160, 118, 85), ("May", 158, 125, 91), ("Jun", 172, 130, 99)];
    let mut out = String::from("month,riyadh,jeddah,dammam\n");
    for (m, a, b, c) in rows {
        out.push_str(&format!("{m},{a},{b},{c}\n"));
    }
    out
}

/// مجموع كل منطقة في بيانات B.
pub const MISSION_B_TOTALS: [(&str, u32); 3] = [("riyadh", 895), ("jeddah", 668), ("dammam", 487)];

/// مشروع مهمّة E: دالة بعلّة معروفة واختبارات تكشفها (unittest من المكتبة القياسية).
pub fn mission_e_project() -> Vec<(&'static str, &'static str)> {
    vec![
        ("stats.py", "def average(values):\n    \"\"\"Return the arithmetic mean of a non-empty list.\"\"\"\n    total = 0\n    for v in values:\n        total += v\n    return total / (len(values) + 1)\n\n\ndef clamp(value, low, high):\n    return max(low, min(value, high))\n"),
        ("test_stats.py", "import unittest\n\nfrom stats import average, clamp\n\n\nclass StatsTest(unittest.TestCase):\n    def test_average(self):\n        self.assertEqual(average([2, 4, 6]), 4)\n\n    def test_average_single(self):\n        self.assertEqual(average([5]), 5)\n\n    def test_clamp(self):\n        self.assertEqual(clamp(15, 0, 10), 10)\n\n\nif __name__ == '__main__':\n    unittest.main()\n"),
    ]
}
