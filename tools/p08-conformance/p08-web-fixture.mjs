// تجهيزة الويب لمجموعة E2E في Phase-08 (TEST FIXTURE): موقع على الحلقة المحلية يبني جدوله
// بجافاسكربت، وهو نفسه موقع عُدّة القياس. بروتوكول التشغيل نفسه الذي تستعمله تجهيزات المراحل
// السابقة: --state يكتب المنفذ، و/__fixture/stop يوقفها، و--log يكتب عدد الطلبات عند التوقّف.
//
// الاستعمال: node p08-web-fixture.mjs --state <path> --log <path> [--max-seconds N]

import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
};

export const SHOP_PAGE = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Fixture Shop</title></head><body>\n<h1 id=\"h\">Loading\u2026</h1>\n<table id=\"prices\"><thead><tr><th>Product</th><th>Price</th><th>Stock</th></tr></thead><tbody id=\"rows\"></tbody></table>\n<label for=\"q\">Search</label><input id=\"q\" type=\"text\" placeholder=\"Search products\">\n<button id=\"go\" onclick=\"filter()\">Filter</button>\n<select id=\"sort\" onchange=\"document.getElementById('sorted').textContent='sorted by '+this.value\"><option value=\"name\">Name</option><option value=\"price\">Price</option></select>\n<p id=\"sorted\"></p>\n<input id=\"pw\" type=\"password\" placeholder=\"Password\">\n<form id=\"f\" method=\"post\" action=\"/submit\"><input name=\"note\" id=\"note\" type=\"text\" placeholder=\"Note\"><button id=\"send\" type=\"submit\">Send note</button></form>\n<a id=\"next\" href=\"/next\">Next page</a>\n<a id=\"dl\" href=\"/file.bin\">Download file</a>\n<p id=\"probe\"></p>\n<script>\n  let items = [];\n  function render(list) { document.getElementById('rows').innerHTML = list.map(i => '<tr><td>' + i.name + '</td><td>' + i.price.toFixed(2) + '</td><td>' + i.stock + '</td></tr>').join(''); }\n  function filter() { const q = document.getElementById('q').value.toLowerCase(); render(items.filter(i => i.name.toLowerCase().includes(q))); document.getElementById('h').textContent = 'Filtered: ' + q; }\n  fetch('/data.json').then(r => r.json()).then(d => { items = d.items; document.getElementById('h').textContent = 'Catalogue ' + d.version; render(items); });\n  fetch('http://169.254.169.254/latest/meta-data/').then(() => { document.getElementById('probe').textContent += ' metadata-reached'; }).catch(() => { document.getElementById('probe').textContent += ' metadata-blocked'; });\n  fetch('/redirect').then(() => { document.getElementById('probe').textContent += ' redirect-followed'; }).catch(() => { document.getElementById('probe').textContent += ' redirect-blocked'; });\n  alert('fixture alert');\n</script></body></html>";
export const DATA_JSON = "{\"version\":\"v7\",\"items\":[{\"name\":\"Alpha lamp\",\"price\":24.5,\"stock\":12},{\"name\":\"Beta chair\",\"price\":89.0,\"stock\":3},{\"name\":\"Gamma desk\",\"price\":240.0,\"stock\":7},{\"name\":\"Delta shelf\",\"price\":61.25,\"stock\":0}]}";

const statePath = arg("--state", null);
const logPath = arg("--log", null);
const maxSeconds = Number(arg("--max-seconds", "2400"));
const log = { requests: 0, posts: 0, paths: {} };

const server = createServer((req, res) => {
  log.requests += 1;
  const path = (req.url ?? "/").split("?")[0];
  log.paths[path] = (log.paths[path] ?? 0) + 1;
  const send = (status, type, body, extra = {}) => {
    res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body), Connection: "close", ...extra });
    res.end(body);
  };
  if (path === "/__fixture/stop") {
    send(200, "text/plain", "stopping");
    finish();
    return;
  }
  if (req.method === "POST" && path === "/submit") {
    log.posts += 1;
    send(200, "text/html", "<p>note received</p>");
    return;
  }
  if (req.method !== "GET") return send(405, "text/plain", "no");
  if (path === "/") return send(200, "text/html; charset=utf-8", SHOP_PAGE);
  if (path === "/data.json") return send(200, "application/json", DATA_JSON);
  if (path === "/next") return send(200, "text/html; charset=utf-8", "<!doctype html><title>Next</title><p>Second page reached</p>");
  if (path === "/redirect") return send(302, "text/plain", "", { Location: "http://10.0.0.1/admin" });
  if (path === "/file.bin") return send(200, "application/octet-stream", "BINARYDATA", { "Content-Disposition": 'attachment; filename="report.bin"' });
  send(404, "text/plain", "no");
});

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  if (logPath !== null) writeFileSync(logPath, `${JSON.stringify({ fixture: "TEST FIXTURE", ...log }, null, 2)}\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  if (statePath !== null) writeFileSync(statePath, `${JSON.stringify({ fixture: "TEST FIXTURE", port }, null, 2)}\n`);
});
setTimeout(finish, maxSeconds * 1000).unref();
