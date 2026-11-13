// التقاط الأنماط المحسوبة لكل عنصر في المعاينة (desktop/renderer/preview) ومقارنتها بين حالتين.
//
// كيف قِيس توحيد التنسيق (2026-10-01):
// 1. شغّل المعاينة (preview_start «renderer-preview»)، وافتح ?lang=en|ar&theme=LIGHT|DARK بمقاس ثابت.
// 2. نفّذ هذا الملف في الصفحة، ثم: await __cap("B") و await __capState("BI") بالتنسيق القديم.
// 3. بدّل الاستيراد، وأعد التحميل، ونفّذه ثانية، ثم: await __cap("A") و await __capState("AI").
// 4. await __cmp("B", "A") و await __cmp("BI", "AI") — diffCount هو عدد العناصر المختلفة.
// المؤشّر يُعطَّل أثناء الالتقاط (pointer-events) كي لا تدخل حالة :hover؛ وبطاقة النصائح الدوّارة مستثناة لأنها
// تتغيّر بالوقت. التقاطان متتاليان بلا تغيير أعطيا صفر فرق قبل استعمال الأداة.

window.__routes = ["/", "/projects", "/projects/1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60", "/missions", "/missions/11111111-1111-4111-8111-111111111111", "/agents", "/skills", "/browser-computer", "/memory", "/connectors", "/activity", "/settings", "/providers", "/models", "/tools", "/health", "/events", "/usage", "/diagnostics", "/schedules", "/artifacts", "/settings/host"];
window.__states = [
  ["/missions/11111111-1111-4111-8111-111111111111", "click", ".rail-thread__more"],
  ["/missions/11111111-1111-4111-8111-111111111111", "click", ".msg-user__remember"],
  ["/missions/11111111-1111-4111-8111-111111111111", "click", ".task-bar__details"],
  ["/", "click", ".composer__tools button"],
  ["/", "click", ".rail-section__add"],
  ["/", "focus", ".composer textarea"],
  ["/", "click", ".model-picker button"],
  ["/", "key", "k"],
  ["/projects/1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60", "click", ".project-page button[aria-haspopup], .project-head button[aria-haspopup], .icon-button"],
  ["/artifacts", "click", ".lib-card__more"],
];
window.__db = () => new Promise((ok, no) => { const r = indexedDB.open("css-capture", 1); r.onupgradeneeded = () => r.result.createObjectStore("snap"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const styleOf = (cs) => { const out = []; for (let i = 0; i < cs.length; i++) { const p = cs[i]; out.push(p + ":" + cs.getPropertyValue(p)); } return out.join(";"); };
const snapshot = () => [...document.querySelectorAll("body *")].map((el, i) => {
  const key = i + "|" + el.tagName + "|" + (typeof el.className === "string" ? el.className : (el.getAttribute("class") ?? ""));
  const b = getComputedStyle(el, "::before"), a = getComputedStyle(el, "::after");
  const pseudo = (b.content !== "none" && b.content !== "normal" ? "||B:" + styleOf(b) : "") + (a.content !== "none" && a.content !== "normal" ? "||A:" + styleOf(a) : "");
  return key + "\u0001" + styleOf(getComputedStyle(el)) + pseudo;
});
const prepare = async () => {
  if (!document.getElementById("cap-style")) { const s = document.createElement("style"); s.id = "cap-style"; s.textContent = "html *, html *::before, html *::after { pointer-events: none !important; }"; document.head.appendChild(s); }
  const q = new URLSearchParams(location.search);
  const variant = (q.get("lang") ?? "en") + "-" + (q.get("theme") ?? "SYSTEM") + "-" + innerWidth;
  const db = await __db();
  const put = (k, v) => new Promise((ok, no) => { const t = db.transaction("snap", "readwrite"); t.objectStore("snap").put(v, k); t.oncomplete = ok; t.onerror = () => no(t.error); });
  return { variant, put };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
window.__cap = async (TAG, from, to) => {
  const { variant, put } = await prepare();
  let total = 0;
  for (const route of __routes.slice(from ?? 0, to ?? 99)) {
    location.hash = "#" + route;
    await sleep(1300);
    const rows = snapshot();
    await put(TAG + "|" + variant + "|" + route, rows);
    total += rows.length;
  }
  return { TAG, variant, total };
};
window.__capState = async (TAG) => {
  const { variant, put } = await prepare();
  const done = [];
  for (let n = 0; n < __states.length; n++) {
    const [route, kind, arg] = __states[n];
    location.hash = "#/settings/host"; await sleep(300);
    location.hash = "#" + route; await sleep(1300);
    const el = kind === "key" ? null : document.querySelector(arg);
    if (kind === "click") el?.click();
    if (kind === "focus") el?.focus();
    if (kind === "key") document.dispatchEvent(new KeyboardEvent("keydown", { key: arg, ctrlKey: true, bubbles: true }));
    await sleep(600);
    const rows = snapshot();
    await put(TAG + "|" + variant + "|state" + n, rows);
    done.push(n + ":" + (kind === "key" || el ? "hit" : "MISS") + ":" + rows.length);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.activeElement?.blur?.();
  }
  return { TAG, variant, done };
};
window.__cmp = async (A, B) => {
  const db = await __db();
  const all = await new Promise((ok) => { const t = db.transaction("snap"); const s = t.objectStore("snap"); const keys = s.getAllKeys(); const vals = s.getAll(); t.oncomplete = () => ok(keys.result.map((k, i) => [k, vals.result[i]])); });
  const map = new Map(all);
  const diffs = []; let compared = 0; const missing = [];
  for (const [k, rowsA] of all) {
    if (!k.startsWith(A + "|")) continue;
    const rowsB = map.get(B + k.slice(A.length));
    if (!rowsB) { missing.push(B + k.slice(A.length)); continue; }
    if (rowsA.length !== rowsB.length) { diffs.push({ k, el: "COUNT " + rowsA.length + " vs " + rowsB.length }); continue; }
    for (let i = 0; i < rowsA.length; i++) {
      compared++;
      if (rowsA[i] === rowsB[i]) continue;
      const [ka, sa] = rowsA[i].split("\u0001"); const sb = rowsB[i].split("\u0001")[1];
      if (/tip/.test(ka)) continue;
      const pa = sa.split(";"), pb = sb.split(";"); const setA = new Set(pa), setB = new Set(pb);
      diffs.push({ k: k.split("|").slice(1).join("|"), el: ka, was: pa.filter((p) => !setB.has(p)).slice(0, 5), now: pb.filter((p) => !setA.has(p)).slice(0, 5) });
    }
  }
  return { compared, diffCount: diffs.length, missing, sample: diffs.slice(0, 30) };
};
