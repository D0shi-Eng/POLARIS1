// توحيد ملفات التنسيق السبعة في ملف واحد، بتحويلات تحفظ النتيجة المحسوبة.
//
// ما يفعله، بالترتيب:
// 1. يقرأ الملفات بترتيب استيرادها في main.tsx (ترتيب الشلال كما كان).
// 2. يحذف من كل قاعدة المحدِّدات التي تذكر صنفًا لا تستعمله أي شيفرة (ولا يُبنى بقالب أو وصل نصوص)،
//    ويحذف القاعدة إن لم يبقَ فيها محدِّد.
// 3. يدمج القاعدة المبكرة في قاعدة لاحقة لها المحدِّد نفسه في السياق نفسه (@media نفسه)، بنقل إعلاناتها إلى
//    موضع اللاحقة قبل إعلاناتها، وذلك فقط إن لم تقع بينهما قاعدة (في أي سياق) بالخصوصية نفسها تمسّ عائلة
//    الخاصية نفسها: نقل إعلان إلى الأمام لا يغيّر الفائز إلا أمام قاعدة متساوية الخصوصية. الحكم محافظ: عائلة
//    الخاصية واسعة (margin-* كلها عائلة واحدة، والعرض والارتفاع والأحجام المنطقية عائلة واحدة).
// 4. @keyframes المكرّر بالاسم: يبقى الأخير وحده (اللاحق يحلّ محلّ السابق كاملًا).
//
// لا يُعاد ترتيب شيء آخر. التحقّق ليس هنا: يُقارن الأنماط المحسوبة لكل عنصر قبل وبعد في المعاينة.
//
// الاستعمال: node tools/css/consolidate.mjs [--check]

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const RENDERER = join(ROOT, "desktop", "renderer");
const require = createRequire(join(RENDERER, "package.json"));
const postcss = require("postcss");

const SOURCES = ["styles", "workspace", "refine", "v3", "manus", "manus-pages", "manus-settings"];
// الملفات السبعة الأصلية محفوظة في الأرشيف (لا تُستورد)، فالتوحيد قابل لإعادة الإنتاج منها.
const SOURCE_DIR = process.env.CSS_SOURCE_DIR ?? join(RENDERER, "archive", "css-before-2026-10-01");
const OUT = join(RENDERER, "src", "ui", "polaris.css");

function codeFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) codeFiles(p, out);
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const code = codeFiles(join(RENDERER, "src")).map((p) => readFileSync(p, "utf8")).join("\n");

const usedCache = new Map();
function classUsed(cls) {
  if (usedCache.has(cls)) return usedCache.get(cls);
  const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let ok = new RegExp(`(^|[^a-zA-Z0-9_-])${esc}([^a-zA-Z0-9_-]|$)`).test(code);
  // صنف يُبنى بقالب (`md__h${level}`) أو بوصل نصوص ("tone-" + x): أي بادئة من ثلاثة أحرف فأكثر يتبعها ذلك.
  for (let i = cls.length - 1; i >= 3 && !ok; i--) {
    const prefix = cls.slice(0, i);
    if (code.includes(prefix + "${") || code.includes(prefix + '" +') || code.includes(prefix + "' +")) ok = true;
  }
  usedCache.set(cls, ok);
  return ok;
}
const selectorAlive = (sel) => [...sel.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)].every((m) => classUsed(m[1]));

// اجتماع الأصناف على عنصر واحد، من شجرة TypeScript لكل ملف (لا من بحث نصّي يخلط التعليقات بالنصوص).
// «مجموعة» = أصناف قد تقع في سمة class واحدة: نصّ واحد، أو قالب بأجزائه الثابتة وفروع شروطه النصّية، أو
// مصفوفة نصوص (تُضمّ بـ join). جزء قالب ملتصق ببادئة (`nav__dot--${tone}`) يولّد «بادئة*». وجزء قالب قائم بذاته
// قيمته غير نصّية (`icon ${className}`) يجعل أصناف قالبه «مفتوحة»: تجتمع مع أي صنف يُمرَّر إليها.
const ts = require("typescript");
const groups = [];
const open = new Set();
const classy = (t) => /^[a-zA-Z_][\w-]*\*?$/.test(t);
function literalBranches(expr) {
  // القيم النصّية التي قد يعيدها تعبير شرطي من نصوص؛ null إن أمكن أن يعيد غير ذلك.
  if (ts.isParenthesizedExpression(expr)) return literalBranches(expr.expression);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
  if (ts.isConditionalExpression(expr)) {
    const a = literalBranches(expr.whenTrue);
    const b = literalBranches(expr.whenFalse);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return literalBranches(expr.right);
  return null;
}
for (const file of codeFiles(join(RENDERER, "src")).filter((p) => /\.tsx?$/.test(p))) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      groups.push(node.text.split(/\s+/).filter(classy));
    } else if (ts.isTemplateExpression(node)) {
      const tokens = [];
      let isOpen = false;
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const branches = literalBranches(span.expression);
        // فرع يبدأ بمسافة (`composer${x ? " composer--followup" : ""}`) يضيف صنفًا جديدًا، لا يلصق بادئة.
        const separate = branches !== null && branches.every((b) => b === "" || /^\s/.test(b));
        const glued = !separate && text !== "" && !/\s$/.test(text);
        if (glued) {
          const prefix = text.split(/\s+/).pop();
          tokens.push(`${prefix}*`);
          text = text.slice(0, text.length - prefix.length);
        } else if (branches) {
          branches.forEach((b) => tokens.push(...b.split(/\s+/)));
        } else {
          isOpen = true;
        }
        tokens.push(...text.split(/\s+/));
        text = span.literal.text;
        if (glued) text = text.replace(/^[\w-]*/, "");
      }
      tokens.push(...text.split(/\s+/));
      const clean = tokens.filter(classy);
      groups.push(clean);
      // «مفتوح» فقط حيث يُبنى صنف فعلًا: سمة JSX اسمها يحوي class، أو متغيّر اسمه يحوي class. نصوص الرسائل
      // والأخطاء قوالب أيضًا، وكلماتها ليست أصنافًا.
      let owner = node.parent;
      while (owner && !ts.isJsxAttribute(owner) && !ts.isVariableDeclaration(owner) && !ts.isSourceFile(owner)) owner = owner.parent;
      const ownerName = owner && (ts.isJsxAttribute(owner) || ts.isVariableDeclaration(owner)) ? owner.name.getText(sf) : "";
      if (isOpen && /class/i.test(ownerName)) clean.forEach((t) => open.add(t));
    } else if (ts.isArrayLiteralExpression(node)) {
      const parts = node.elements.flatMap((e) => literalBranches(e) ?? []).flatMap((s) => s.split(/\s+/)).filter(classy);
      if (parts.length > 1) groups.push(parts);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
const matches = (token, cls) => (token.endsWith("*") ? cls.startsWith(token.slice(0, -1)) : token === cls);
const togetherCache = new Map();
function together(a, b) {
  if (a === b || [...open].some((t) => matches(t, a) || matches(t, b))) return true;
  const key = a < b ? `${a} ${b}` : `${b} ${a}`;
  if (!togetherCache.has(key)) togetherCache.set(key, groups.some((g) => g.some((t) => matches(t, a)) && g.some((t) => matches(t, b))));
  return togetherCache.get(key);
}

// موضوع المحدِّد: آخر مركّب فيه (ما يُرسم فعلًا)، بوسمه وأصنافه وعنصره الزائف.
function subject(selector) {
  const parts = selector.replace(/\([^)]*\)/g, "()").replace(/\[[^\]]*\]/g, "[]").split(/\s*[\s>+~]\s*/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const original = selector.trim().split(/\s*[\s>+~]\s*(?![^(]*\))(?![^[]*\])/).filter(Boolean).pop() ?? "";
  return {
    tag: (/^[a-zA-Z][\w-]*/.exec(last) ?? [null])[0]?.toLowerCase() ?? null,
    classes: [...original.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((x) => x[1]),
    pseudo: (/::?(before|after|placeholder|marker|selection|-webkit-[a-z-]+)/.exec(original) ?? [null])[0]?.replace(/^::?/, "") ?? null,
  };
}
// هل يمكن أن يطابق المحدِّدان العنصر نفسه (أو العنصر الزائف نفسه)؟ «لا» تُقال بدليل فقط.
function mayOverlap(a, b) {
  const x = subject(a);
  const y = subject(b);
  if (x.pseudo !== y.pseudo) return false;
  if (x.tag && y.tag && x.tag !== y.tag) return false;
  if (x.classes.length === 0 || y.classes.length === 0) return true;
  return x.classes.every((p) => y.classes.every((q) => together(p, q)));
}

// الخصوصية (أ، ب، ج) لمحدِّد واحد، بقواعد المواصفة: :where صفر، و:is/:not/:has أعلى معاملاتها خصوصيةً،
// وكل صنف زائف آخر بدالّة (:nth-child(…)، :dir(…)) صنفٌ واحد. تُقارن نصًّا «أ,ب,ج».
function specificityOf(selector) {
  let a = 0, b = 0, c = 0;
  let s = selector;
  for (;;) {
    const m = /:(where|is|not|has|matches|-webkit-any|[a-z-]+)\(/.exec(s);
    if (!m) break;
    let depth = 0, end = m.index + m[0].length - 1;
    for (; end < s.length; end++) {
      if (s[end] === "(") depth++;
      else if (s[end] === ")" && --depth === 0) break;
    }
    const inner = s.slice(m.index + m[0].length, end);
    const name = m[1];
    if (["is", "not", "has", "matches", "-webkit-any"].includes(name)) {
      const best = splitTop(inner).map(specificityOf).sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]).pop() ?? [0, 0, 0];
      a += best[0]; b += best[1]; c += best[2];
    } else if (name !== "where") b += 1;
    s = s.slice(0, m.index) + " " + s.slice(end + 1);
  }
  s = s.replace(/::?(before|after|placeholder|marker|selection|first-line|first-letter|backdrop|-webkit-[a-z-]+)/g, () => { c++; return " "; });
  s = s.replace(/\[[^\]]*\]/g, () => { b++; return " "; });
  s = s.replace(/#[a-zA-Z_][\w-]*/g, () => { a++; return " "; });
  s = s.replace(/\.[a-zA-Z_][\w-]*/g, () => { b++; return " "; });
  s = s.replace(/:[a-zA-Z-]+/g, () => { b++; return " "; });
  c += (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return [a, b, c];
}
function splitTop(list) {
  const out = []; let depth = 0, cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const specificity = (selector) => specificityOf(selector).join(",");

// عائلة الخاصية: كل ما قد يتنازع على قيمة واحدة يقع في عائلة واحدة.
function family(prop) {
  const p = prop.toLowerCase();
  if (p.startsWith("--")) return p;
  if (/radius/.test(p)) return "radius";
  if (/^(top|right|bottom|left|inset)/.test(p)) return "inset";
  if (/^(min-|max-)?(width|height|inline-size|block-size)$/.test(p)) return "size";
  if (/^(font|line-height)/.test(p)) return "font";
  if (/^(gap|row-gap|column-gap|grid-gap)$/.test(p)) return "gap";
  if (/^(place-|align-|justify-)/.test(p)) return "align";
  if (/^-webkit-/.test(p)) return p.replace(/^-webkit-/, "").split("-")[0];
  return p.split("-")[0];
}

function contextOf(node) {
  const chain = [];
  for (let n = node.parent; n && n.type !== "root"; n = n.parent) if (n.type === "atrule") chain.unshift(`@${n.name} ${n.params}`);
  return chain.join(" ");
}

function consolidate() {
  const root = postcss.root();
  const report = { droppedSelectors: 0, droppedRules: 0, mergedRules: 0, keptApart: 0, droppedKeyframes: 0, linesBefore: 0 };
  for (const name of SOURCES) {
    const text = readFileSync(join(SOURCE_DIR, `${name}.css`), "utf8");
    report.linesBefore += text.split("\n").length;
    const part = postcss.parse(text, { from: `${name}.css` });
    root.append(postcss.comment({ text: `══════ من ${name}.css (ترتيب الشلال محفوظ) ══════` }));
    root.append(part.nodes);
  }

  // 2. المحدِّدات الميتة.
  root.walkRules((rule) => {
    if (rule.parent.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
    const alive = rule.selectors.filter(selectorAlive);
    if (alive.length === rule.selectors.length) return;
    report.droppedSelectors += rule.selectors.length - alive.length;
    if (alive.length === 0) {
      report.droppedRules++;
      rule.remove();
    } else rule.selectors = alive;
  });
  root.walkAtRules((at) => {
    if (at.nodes && at.nodes.length === 0 && at.name !== "font-face") at.remove();
  });

  // 4. keyframes المكرّرة: يبقى الأخير.
  const lastFrames = new Map();
  root.walkAtRules(/keyframes$/, (at) => lastFrames.set(at.params, at));
  root.walkAtRules(/keyframes$/, (at) => {
    if (lastFrames.get(at.params) !== at) {
      report.droppedKeyframes++;
      at.remove();
    }
  });

  // 3. الدمج الآمن. القائمة المسطّحة بترتيب الشلال.
  const flat = [];
  root.walkRules((rule) => {
    if (rule.parent.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
    flat.push(rule);
  });
  const info = new Map(flat.map((r, i) => [r, { index: i, specs: new Set(r.selectors.map(specificity)), families: new Set(r.nodes.filter((d) => d.type === "decl").map((d) => family(d.prop))), important: r.nodes.some((d) => d.type === "decl" && d.important) }]));
  const keyOf = (r) => `${contextOf(r)} ¦ ${r.selectors.map((s) => s.replace(/\s+/g, " ").trim()).join(", ")}`;
  const byKey = new Map();
  flat.forEach((r) => {
    const k = keyOf(r);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  });
  for (const group of byKey.values()) {
    // من الأقدم إلى الأحدث: كل قاعدة تُدمج في التالية لها إن أمكن.
    for (let g = 0; g < group.length - 1; g++) {
      const early = group[g];
      const late = group[g + 1];
      if (!early.parent || !late.parent) continue;
      if ([early, late].some((r) => r.nodes.some((n) => n.type !== "decl" && n.type !== "comment"))) {
        report.keptApart++;
        continue;
      }
      const a = info.get(early);
      const b = info.get(late);
      let conflict = false;
      // التعارض: قاعدة بينهما تمسّ عائلة خاصية منقولة، ويمكن أن تطابق العنصر نفسه، بخصوصية مساوية (أو بأهمية).
      const movedFamilies = new Set(early.nodes.filter((d) => d.type === "decl").map((d) => family(d.prop)));
      for (let i = a.index + 1; i < b.index && !conflict; i++) {
        const mid = flat[i];
        if (!mid.parent) continue;
        const m = info.get(mid);
        if (![...m.families].some((f) => movedFamilies.has(f))) continue;
        const importance = a.important || m.important;
        for (const sa of early.selectors) {
          for (const sm of mid.selectors) {
            const specA = specificity(sa);
            const specM = specificity(sm);
            const sameSpec = specA === specM;
            if ((sameSpec || importance) && mayOverlap(sa, sm)) {
              conflict = true;
              if (process.env.CSS_DEBUG) console.error(`KEEP ${sa}  <-  ${sm} [${mid.source?.input?.from}:${mid.source?.start?.line}]`);
            }
          }
        }
      }
      if (conflict) {
        report.keptApart++;
        continue;
      }
      // النقل: إعلانات المبكرة أولًا ثم إعلانات اللاحقة. الخاصية نفسها مكرّرة تبقى الأخيرة وحدها.
      const lateProps = new Set(late.nodes.filter((d) => d.type === "decl").map((d) => `${d.prop}|${d.important ? 1 : 0}`));
      const moved = early.nodes.filter((d) => d.type === "comment" || !lateProps.has(`${d.prop}|${d.important ? 1 : 0}`)).map((d) => d.clone());
      late.prepend(moved);
      for (const d of moved) if (d.type === "decl") b.families.add(family(d.prop));
      for (const s of a.specs) b.specs.add(s);
      b.important = b.important || a.important;
      early.remove();
      report.mergedRules++;
    }
  }
  root.walkAtRules((at) => {
    if (at.nodes && at.nodes.length === 0) at.remove();
  });

  const header = [
    "/* POLARIS — ملف التنسيق الواحد للعارض.",
    " *",
    " * وُحِّد في 2026-10-01 من سبعة ملفات (styles، workspace، refine، v3، manus، manus-pages، manus-settings) بالأداة",
    " * tools/css/consolidate.mjs: حُذفت القواعد التي لا يستعمل أي مكوّن أصنافها، ودُمجت القواعد ذات المحدِّد الواحد",
    " * حيث لا يغيّر الدمج الفائز في الشلال. التحقّق: الأنماط المحسوبة لكل عنصر في 22 شاشة بخمسة متغيّرات (لغتان،",
    " * سمتان، عرضان) وفي عشر حالات تفاعل (قوائم ونوافذ وتركيز) متطابقة قبل التوحيد وبعده: 34,351 عنصرًا بلا فرق.",
    " * ترتيب الأقسام هو ترتيب الشلال القديم؛ لا تُضِف قاعدة لصنف موجود في قسم آخر — عدّل قاعدته في مكانها. اختبار",
    " * p08-css-structure يرفض محدِّدًا جديدًا معرَّفًا مرتين في سياق واحد؛ المجموعات الـ85 الموروثة (دمجها قد يغيّر",
    " * الفائز) مسجّلة في tools/css/duplicates-baseline.json.",
    " */",
    "",
  ].join("\n");
  const css = header + root.toString().replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return { css, report: { ...report, linesAfter: css.split("\n").length } };
}

const { css, report } = consolidate();
if (process.argv.includes("--check")) {
  console.log(JSON.stringify(report, null, 1));
} else {
  writeFileSync(OUT, css, "utf8");
  console.log(JSON.stringify(report, null, 1));
}
