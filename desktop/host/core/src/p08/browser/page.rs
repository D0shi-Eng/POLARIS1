// نصوص برمجية تُقيَّم في «عالم معزول» داخل الصفحة: يرى DOM نفسه ولا يرى متغيّرات الصفحة، ولا
// تراه الصفحة. منه تُقرأ الصفحة وتُحدَّد العناصر بأرقام، ومنه تُحسب مواضع النقر. الفعل نفسه
// (نقر، كتابة) يُرسل من المضيف أحداث إدخال موثوقة، لا من داخل الصفحة.

pub fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// يقرأ الصفحة: العنوان والرابط ونصّ الجسم المرئي (محدودًا) والعناصر التفاعلية المرئية بأرقام.
/// الأرقام تُحفظ في العالم المعزول وحده (`__polarisRefs`)، فلا تستطيع الصفحة تزويرها.
pub const SNAPSHOT: &str = r#"(() => {
  const maxText = 12000, maxItems = 150;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const sel = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[onclick],[contenteditable=true],summary,label[for]';
  const refs = [];
  const items = [];
  for (const el of document.querySelectorAll(sel)) {
    if (items.length >= maxItems) break;
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && type === 'hidden') continue;
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    refs.push(el);
    const item = { ref: refs.length, tag, label };
    if (type) item.type = type;
    if (tag === 'a') item.href = (el.href || '').slice(0, 300);
    if (tag === 'select') item.options = Array.from(el.options).slice(0, 30).map(o => (o.value + '=' + o.text).slice(0, 80));
    if (el.disabled) item.disabled = true;
    if (type === 'password') item.password = true;
    items.push(item);
  }
  globalThis.__polarisRefs = refs;
  const text = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, maxText);
  const tables = Array.from(document.querySelectorAll('table')).filter(visible).slice(0, 5).map(t => ({ id: (t.id || '').slice(0, 60), rows: Array.from(t.rows).slice(0, 200).map(r => Array.from(r.cells).slice(0, 20).map(c => (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200))) })).filter(t => t.rows.length > 0);
  return JSON.stringify({ url: location.href.slice(0, 600), title: document.title.slice(0, 300), text, truncated: (document.body ? document.body.innerText.length : 0) > maxText, items, tables, ready: document.readyState });
})()"#;

/// موضع عنصر بعد تمريره إلى المشهد، بإحداثيات النافذة. `REF` يُستبدل برقم.
pub const LOCATE: &str = r#"(() => {
  const el = (globalThis.__polarisRefs || [])[REF - 1];
  if (!el || !el.isConnected) return JSON.stringify({ error: 'STALE_REF' });
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const type = (el.getAttribute('type') || '').toLowerCase();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, tag: el.tagName.toLowerCase(), type, disabled: !!el.disabled });
})()"#;

/// يركّز حقلًا ويحدّد محتواه ليُستبدل بالكتابة. يرفض حقول كلمات المرور.
pub const FOCUS: &str = r#"(() => {
  const el = (globalThis.__polarisRefs || [])[REF - 1];
  if (!el || !el.isConnected) return 'STALE_REF';
  if ((el.getAttribute('type') || '').toLowerCase() === 'password') return 'PASSWORD_FIELD';
  el.scrollIntoView({ block: 'center' });
  el.focus();
  if (typeof el.select === 'function' && CLEAR) el.select();
  else if (el.isContentEditable && CLEAR) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  return document.activeElement === el ? 'OK' : 'NOT_FOCUSABLE';
})()"#;

/// يختار قيمة في قائمة ويطلق حدثي input وchange كما يفعل اختيار المستخدم.
pub const SELECT: &str = r#"(() => {
  const el = (globalThis.__polarisRefs || [])[REF - 1];
  if (!el || !el.isConnected) return 'STALE_REF';
  if (el.tagName.toLowerCase() !== 'select') return 'NOT_A_SELECT';
  const want = VALUE;
  const opt = Array.from(el.options).find(o => o.value === want || o.text.trim() === want);
  if (!opt) return 'NO_SUCH_OPTION';
  el.value = opt.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()"#;

/// هل ظهر نصّ في الصفحة.
pub const CONTAINS: &str = r#"(() => (document.body ? document.body.innerText : '').includes(NEEDLE))()"#;

/// يجهّز نصًّا برمجيًّا برقم مرجع.
pub fn with_ref(script: &str, reference: u32) -> String {
    script.replace("REF", &reference.to_string())
}

/// يضع قيمة نصّية بأمان داخل نصّ برمجي (JSON نصّ صالح في JavaScript).
pub fn js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_are_embedded_as_string_literals_never_as_code() {
        let s = SELECT.replace("VALUE", &js_string("'); alert(1); ('"));
        assert!(s.contains(r#"const want = "'); alert(1); ('";"#));
        assert_eq!(with_ref(LOCATE, 7).matches("[7 - 1]").count(), 1);
        assert_eq!(html_escape("<b>&"), "&lt;b&gt;&amp;");
    }
}
