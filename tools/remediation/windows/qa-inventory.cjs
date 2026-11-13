// Static UI control inventory for POLARIS renderer (QA 2026-10-15).
// Walks every .tsx under src (not tests/e2e/generated) with the TypeScript compiler API and records each
// interactive JSX element: tag, handler attrs, label keys (resolved in ar/en), disabled expression,
// client methods called (resolved to IPC operations), and file:line.
const fs = require("fs");
const path = require("path");
const os = require("os");
const ROOT = "D:/POLARIS/desktop/renderer";
const ts = require(ROOT + "/node_modules/typescript");
const SRC = ROOT + "/src";

// ---------- catalogs: transpile to CJS in a temp dir and require ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "polaris-cat-"));
function transpileTree(dir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { transpileTree(full, path.join(outDir, name)); continue; }
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const out = ts.transpileModule(fs.readFileSync(full, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
    fs.writeFileSync(path.join(outDir, name.replace(/\.ts$/, ".js")), out.outputText);
  }
}
transpileTree(SRC + "/localization", path.join(tmp, "localization"));
const { CATALOGS } = require(path.join(tmp, "localization/catalog/index.js"));
function lookup(locale, key) {
  const cat = CATALOGS[locale];
  const v = cat && (cat[key] ?? (cat.messages && cat.messages[key]));
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return v.other || v.one || JSON.stringify(v);
  return undefined;
}

// ---------- client method -> operation map ----------
const methodOp = {};
for (const f of fs.readdirSync(SRC + "/ipc")) {
  if (!/-client\.ts$|^client\.ts$/.test(f)) continue;
  const text = fs.readFileSync(SRC + "/ipc/" + f, "utf8");
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
  sf.forEachChild(function visit(n) {
    if (ts.isClassDeclaration(n)) {
      for (const m of n.members) {
        if ((ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m)) && m.name && ts.isIdentifier(m.name)) {
          const body = m.getText(sf);
          const ops = [...body.matchAll(/["'`]((?:polaris|p0\d|host|config|provider|mission|memory|skill|tool|agent|schedule|project|connector|thread|artifact)[\w.\-]*)["'`]/g)].map((x) => x[1]);
          if (ops.length) methodOp[m.name.text] = [...new Set(ops)];
        }
      }
    }
    n.forEachChild(visit);
  });
}

// ---------- walk components ----------
const files = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const f = path.join(d, n);
    if (fs.statSync(f).isDirectory()) { if (!/^(e2e|generated|__tests__|test)$/.test(n)) walk(f); continue; }
    if (f.endsWith(".tsx") && !/\.test\.tsx$/.test(f)) files.push(f);
  }
})(SRC);

const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea", "summary"]);
const INTERACTIVE_ROLES = new Set(["button", "menuitem", "tab", "switch", "checkbox", "option", "link", "menuitemradio", "radio", "slider"]);
const EVENT_RE = /^on(Click|Select|Change|Submit|KeyDown|KeyUp|Drop|DragOver|ContextMenu|DoubleClick|Toggle|Input|Activate|Pick|Confirm|Cancel|Close|Save|Delete|Run|Stop|Choose)$/;
const rows = [];
const keyRe = /\bt\(\s*["'`]([\w.\-:]+)["'`]/g;
const labelKeyRe = /(?:labelKey|titleKey|messageKey|hintKey|aria-label|label|title)=\{?\s*["'`]([\w.\-]+\.[\w.\-]+)["'`]/g;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // function bodies in this file, for resolving named handlers
  const fnBodies = {};
  sf.forEachChild(function collect(n) {
    if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name && ts.isIdentifier(n.name)) fnBodies[n.name.text] = n.getText(sf);
    n.forEachChild(collect);
  });
  function visit(n) {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      const attrs = {};
      for (const a of n.attributes.properties) {
        if (ts.isJsxAttribute(a)) attrs[a.name.getText(sf)] = a.initializer ? a.initializer.getText(sf) : "true";
      }
      const handlers = Object.keys(attrs).filter((k) => EVENT_RE.test(k));
      const role = (attrs.role || "").replace(/["'{}]/g, "");
      const interactive = INTERACTIVE_TAGS.has(tag) || handlers.length > 0 || INTERACTIVE_ROLES.has(role);
      if (interactive && !(tag === "input" && /hidden/.test(attrs.type || ""))) {
        const elementNode = ts.isJsxOpeningElement(n) ? n.parent : n;
        const elementText = elementNode.getText(sf);
        const keys = new Set();
        for (const m of elementText.matchAll(keyRe)) keys.add(m[1]);
        for (const m of elementText.matchAll(labelKeyRe)) keys.add(m[1]);
        const handlerText = handlers.map((h) => h + "=" + attrs[h]).join(" | ");
        // resolve client calls in the handler and in named functions it references
        let scan = handlerText;
        for (const id of handlerText.match(/\b[a-zA-Z_]\w*\b/g) || []) if (fnBodies[id] && id.length > 2) scan += "\n" + fnBodies[id];
        const methods = [...new Set([...scan.matchAll(/\b(?:client|phase0\d|p0\d|host|api|\w+Client)\??\.(\w+)\(/g)].map((m) => m[1]))];
        const ops = [...new Set(methods.flatMap((m) => methodOp[m] || []))];
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        const rel = path.relative(SRC, file).replace(/\\/g, "/");
        const firstKey = [...keys][0];
        const noOp = handlers.some((h) => /=\{\s*\(\s*\)\s*=>\s*(\{\s*\}|undefined|null|void 0)\s*\}$/.test(h + "=" + attrs[h]) || /^\{\s*\(\)\s*=>\s*\{\s*\}\s*\}$/.test(attrs[h]));
        rows.push({
          control_id: rel.replace(/\.tsx$/, "").replace(/\//g, ".") + ":" + (line + 1),
          component: rel, line: line + 1, tag, role: role || undefined,
          type: attrs.type ? attrs.type.replace(/["'{}]/g, "") : undefined,
          handlers, handler_src: handlerText.slice(0, 220),
          label_keys: [...keys],
          label_keys_values: { ar: [...keys].map((k) => lookup("ar", k)).filter(Boolean), en: [...keys].map((k) => lookup("en", k)).filter(Boolean) },
          label_ar: firstKey ? lookup("ar", firstKey) : undefined,
          label_en: firstKey ? lookup("en", firstKey) : undefined,
          aria_label: attrs["aria-label"], disabled: attrs.disabled,
          client_methods: methods, ipc_operations: ops,
          no_handler: (tag === "button" || role === "button" || role === "menuitem") && handlers.length === 0 && !/submit/.test(attrs.type || ""),
          noop_handler: noOp,
        });
      }
    }
    n.forEachChild(visit);
  }
  visit(sf);
}
const out = process.argv[2];
fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), files: files.length, controls: rows.length, method_operation_map_size: Object.keys(methodOp).length, rows }, null, 1));
const missingAr = rows.filter((r) => r.label_keys.length && !r.label_ar).length;
console.log(JSON.stringify({ files: files.length, controls: rows.length, with_handlers: rows.filter((r) => r.handlers.length).length, with_ipc: rows.filter((r) => r.ipc_operations.length).length, buttons_without_handler: rows.filter((r) => r.no_handler).length, noop_handlers: rows.filter((r) => r.noop_handler).length, label_key_unresolved_ar: missingAr, methods_mapped: Object.keys(methodOp).length }));
