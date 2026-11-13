// فحص ساكن لمصدر محوّل ويندوز، يُشغَّل على أي مضيف.
//
// لماذا يوجد: المُصرِّف الحاكم هو csc.exe المدمج في ويندوز، وهو غير متاح في كل
// بيئة تحرير. تشغيل ويندوز أصلي يُهدر على خطأ تصريف تافه تكلفة حقيقية على المالك.
// هذا الفحص لا يدّعي أنه مُصرِّف — ولا يُسجَّل نجاحه بديلًا عن التصريف — لكنه
// يمنع صنفًا كاملًا من الأخطاء: قوس غير مغلق، بنية لغة أحدث مما يفهمه المُصرِّف
// المدمج، واستدعاء عضو ساكن لم يعد موجودًا بعد إعادة تسمية.
//
// الحكم: خرج بصفر = لم يُعثر على خرق. ليس معناه "يُصرَّف".

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ADAPTER = dirname(fileURLToPath(import.meta.url));

/** إزالة التعليقات والسلاسل حتى لا يُحاسَب النص على ما ليس شيفرة. */
function strip(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== "*/") i += 1;
      i += 2;
      continue;
    }
    if (source[i] === "@" && source[i + 1] === '"') {
      i += 2;
      while (i < source.length) {
        if (source[i] === '"' && source[i + 1] === '"') { i += 2; continue; }
        if (source[i] === '"') { i += 1; break; }
        i += 1;
      }
      out += '""';
      continue;
    }
    if (source[i] === '"') {
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === '"') { i += 1; break; }
        i += 1;
      }
      out += '""';
      continue;
    }
    if (source[i] === "'") {
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "'") { i += 1; break; }
        i += 1;
      }
      out += "'c'";
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

function balance(code) {
  const pairs = { "}": "{", ")": "(", "]": "[" };
  const stack = [];
  let line = 1;
  for (const ch of code) {
    if (ch === "\n") line += 1;
    if (ch === "{" || ch === "(" || ch === "[") stack.push({ ch, line });
    else if (ch === "}" || ch === ")" || ch === "]") {
      const top = stack.pop();
      if (top === undefined || top.ch !== pairs[ch]) {
        return `unbalanced "${ch}" at line ${String(line)}`;
      }
    }
  }
  if (stack.length > 0) {
    return `"${stack[stack.length - 1].ch}" opened at line ${String(stack[stack.length - 1].line)} is never closed`;
  }
  return undefined;
}

/**
 * المُصرِّف المدمج في .NET Framework يفهم C# 5. أي بنية أحدث تُصرَّف عندك ولا
 * تُصرَّف عنده، وهو الوحيد الذي يبني هذا المحوّل.
 */
const FORBIDDEN = [
  [/\$@?"/, "interpolated string ($\"...\") is C# 6"],
  [/\?\./, "null-conditional (?.) is C# 6"],
  [/\?\[/, "null-conditional index (?[) is C# 6"],
  [/\bnameof\s*\(/, "nameof() is C# 6"],
  [/\bout\s+var\b/, "out var is C# 7"],
  [/=>/, "expression-bodied members and lambdas are avoided in this adapter (C# 6 for members)"],
  [/\bwhen\s*\(/, "exception filters are C# 6"],
  [/\?\?=/, "null-coalescing assignment is C# 8"],
];

function declaredTypes(sources) {
  const types = new Map();
  for (const [name, code] of sources) {
    const pattern = /\b(?:internal|public|private|protected)\s+(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(?:class|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let match;
    while ((match = pattern.exec(code)) !== null) {
      types.set(match[1], { file: name, index: match.index });
    }
  }
  return types;
}

/** أعضاء نوع: تُلتقط الأسماء المعلنة أيًا كان شكل الإعلان. */
function membersOf(code, typeName) {
  const start = code.search(new RegExp(`\\b(?:class|struct|enum)\\s+${typeName}\\b`));
  if (start < 0) return undefined;
  const isEnum = /\benum\s+$/.test(code.slice(Math.max(0, start - 8), start + 5).replace(new RegExp(`${typeName}$`), ""))
    || new RegExp(`\\benum\\s+${typeName}\\b`).test(code);
  let i = code.indexOf("{", start);
  if (i < 0) return undefined;
  let depth = 0;
  const begin = i;
  for (; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = code.slice(begin, i + 1);
  const members = new Set();
  const declaration = /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:[({=;]|\{)/g;
  let match;
  while ((match = declaration.exec(body)) !== null) members.add(match[1]);
  // أسماء الثوابت والحقول والخصائص أيضًا.
  const simple = /\b(?:internal|public|private|protected)\s+(?:static\s+|readonly\s+|const\s+|sealed\s+|override\s+|virtual\s+)*[A-Za-z_][A-Za-z0-9_<>,.\[\]]*\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((match = simple.exec(body)) !== null) members.add(match[1]);
  if (isEnum) {
    // أعضاء التعداد أسماء مجرّدة يفصلها فاصل، بلا شكل إعلان آخر.
    const member = /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:,|\})/g;
    while ((match = member.exec(body)) !== null) members.add(match[1]);
  }
  return members;
}

const files = readdirSync(ADAPTER).filter((name) => name.endsWith(".cs")).sort();
const raw = new Map();
const stripped = new Map();
for (const name of files) {
  const text = readFileSync(join(ADAPTER, name), "utf8");
  raw.set(name, text);
  stripped.set(name, strip(text));
}

const problems = [];

for (const [name, code] of stripped) {
  const imbalance = balance(code);
  if (imbalance !== undefined) problems.push(`${name}: ${imbalance}`);
  for (const [pattern, why] of FORBIDDEN) {
    const found = pattern.exec(code);
    if (found !== null) {
      const line = code.slice(0, found.index).split("\n").length;
      problems.push(`${name}:${String(line)}: ${why}`);
    }
  }
}

// السقف المخترع لا يعود بأي اسم.
const scanner = raw.get("HandleScanner.cs") ?? "";
if (/MaxHandleValue/.test(scanner)) problems.push("HandleScanner.cs: an arbitrary handle-value ceiling is back");

// ADR-007 بعد تصحيحه: الواجهة العامة أولًا، والداخلية شاهدًا أو احتياطيًا معلنًا.
const primaryAt = scanner.indexOf("PssHandleEnumeration.Query");
const secondaryAt = scanner.indexOf("NtHandleEnumeration.Query");
if (primaryAt < 0) {
  problems.push("HandleScanner.cs: the public Process Snapshotting enumerator is no longer the primary source");
} else if (secondaryAt >= 0 && secondaryAt < primaryAt) {
  problems.push("HandleScanner.cs: the internal enumeration API runs before the public one again");
}
if (!/HANDLE_ENUMERATION_SOURCES_DISAGREE/.test(scanner)) {
  problems.push("HandleScanner.cs: disagreeing enumeration sources are no longer classified");
}
// والادعاء الخاطئ لا يعود بأي صياغة: هناك واجهة kernel32 موثّقة، وهي المستعملة.
for (const [name, code] of raw) {
  if (/لا توجد واجهة kernel32 موثّقة/.test(code)) {
    problems.push(`${name}: the corrected ADR-007 claim about a missing documented kernel32 API is back`);
  }
}

const types = declaredTypes(stripped);
const memberIndex = new Map();
for (const [typeName, where] of types) {
  const members = membersOf(stripped.get(where.file) ?? "", typeName);
  if (members !== undefined) memberIndex.set(typeName, members);
}

// استدعاء عضو ساكن على نوع من أنواع المحوّل: إن لم يعد العضو معلنًا، هذا خطأ تصريف.
for (const [name, code] of stripped) {
  const reference = /\b([A-Z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let match;
  while ((match = reference.exec(code)) !== null) {
    const [, typeName, member] = match;
    const members = memberIndex.get(typeName);
    if (members === undefined) continue;
    if (!members.has(member)) {
      const line = code.slice(0, match.index).split("\n").length;
      problems.push(`${name}:${String(line)}: ${typeName}.${member} is referenced but ${typeName} declares no such member`);
    }
  }
}

// ── حارس سطح التصريف: عدد المعاملات، لا وجود الاسم وحده ─────────────
//
// العيب الذي يغلقه هذا القسم: CS1501 في التشغيل الأصلي. تغيّر توقيع
// GrantBuilder.ReadGrant حين أُضيفت target.identity، وبقي موضع نداء قديم بأربعة
// وسائط. الفحص كان يسأل "هل العضو معلن؟" فقط، فمرّ الاختلاف حتى وصل
// csc.exe على ويندوز وأهدر تشغيلًا أصليًا كاملًا. السؤال الآن: وبكم معاملًا؟

/** نهاية قائمة أنواع عامّة تبدأ عند "<"، أو -1 إن لم تكن قائمة أنواع أصلًا. */
function genericEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "<") depth += 1;
    else if (ch === ">") {
      depth -= 1;
      if (depth === 0) return i;
    } else if (!/[A-Za-z0-9_ ,.[\]?]/.test(ch)) return -1;
  }
  return -1;
}

/**
 * تقسيم على فواصل المستوى الأعلى وحدها. Dictionary<string, string> معامل واحد
 * لا اثنان، ولذلك تُقفز قائمة الأنواع العامّة كاملة حين تُرصد.
 */
function splitTopLevel(text) {
  const parts = [];
  let current = "";
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "<" && i > 0 && /[A-Za-z0-9_]/.test(text[i - 1])) {
      const end = genericEnd(text, i);
      if (end > 0) {
        current += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

/** نصّ ما بين قوسين متوازنين يبدآن عند openIndex، أو undefined إن لم يُغلق. */
function argumentText(code, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(openIndex + 1, i);
    }
  }
  return undefined;
}

/** جسم نوع معلن بالاسم، من "{" إلى "}" المقابل. */
function typeBody(code, typeName) {
  const start = code.search(new RegExp(`\\b(?:class|struct|enum)\\s+${typeName}\\b`));
  if (start < 0) return undefined;
  let i = code.indexOf("{", start);
  if (i < 0) return undefined;
  const begin = i;
  let depth = 0;
  for (; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return code.slice(begin, i + 1);
}

/**
 * تواقيع الدوال المعلنة داخل جسم نوع، بعدد معاملات كل واحدة.
 * ما له أكثر من إعلان، أو معامل اختياري، أو params — يُعلّم ولا يُحاسب على العدد.
 */
function methodSignatures(body) {
  const signatures = new Map();
  const pattern = /\b(?:internal|public|private|protected)\s+(?:static\s+|sealed\s+|override\s+|virtual\s+|new\s+|unsafe\s+|extern\s+|abstract\s+|async\s+)*[A-Za-z_][A-Za-z0-9_<>,.[\] ]*?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1];
    const open = match.index + match[0].length - 1;
    const parameters = argumentText(body, open);
    if (parameters === undefined) continue;
    const parts = parameters.trim().length === 0 ? [] : splitTopLevel(parameters);
    const variable = parts.some((part) => part.includes("=") || /\bparams\b/.test(part));
    const previous = signatures.get(name);
    signatures.set(name, {
      count: parts.length,
      variable: variable || (previous !== undefined && previous.count !== parts.length),
      overloads: previous === undefined ? 1 : previous.overloads + 1,
    });
  }
  return signatures;
}

const signatureIndex = new Map();
for (const [typeName, where] of types) {
  const body = typeBody(stripped.get(where.file) ?? "", typeName);
  if (body === undefined) continue;
  for (const [method, signature] of methodSignatures(body)) {
    signatureIndex.set(`${typeName}.${method}`, signature);
  }
}

function lineOf(code, index) {
  return String(code.slice(0, index).split("\n").length);
}

for (const [name, code] of stripped) {
  const call = /\b([A-Z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match;
  while ((match = call.exec(code)) !== null) {
    const key = `${match[1]}.${match[2]}`;
    const signature = signatureIndex.get(key);
    // ما له تحميل زائد أو معامل اختياري لا يُحكم عليه بالعدد: الصمت أصدق من إنذار كاذب.
    if (signature === undefined || signature.overloads > 1 || signature.variable) continue;
    const open = match.index + match[0].length - 1;
    const args = argumentText(code, open);
    if (args === undefined) continue;
    const count = args.trim().length === 0 ? 0 : splitTopLevel(args).length;
    if (count !== signature.count) {
      problems.push(
        `${name}:${lineOf(code, match.index)}: ${key} is called with ${String(count)} argument(s) but declares ${String(signature.count)} — the CS1501 class of defect`,
      );
    }
  }
}

// ── منحة القراءة: لا تُبنى بلا هوية هدف حقيقية ─────────────────────────

const grantBuilder = stripped.get("GrantBuilder.cs") ?? "";
if (!/internal static string ReadGrant\([^)]*TargetObjectIdentity\s+identity\s*\)/.test(grantBuilder)) {
  problems.push("GrantBuilder.cs: ReadGrant no longer takes the target object identity as its last parameter");
}
const grantBuilderRaw = raw.get("GrantBuilder.cs") ?? "";
if (!/json\.Name\("identity"\)/.test(grantBuilderRaw) || !/identity\.FileId/.test(grantBuilderRaw)) {
  problems.push("GrantBuilder.cs: the production read grant no longer carries target.identity");
}

for (const [name, code] of stripped) {
  const call = /GrantBuilder\.ReadGrant\s*\(/g;
  let match;
  while ((match = call.exec(code)) !== null) {
    const open = match.index + match[0].length - 1;
    const args = argumentText(code, open);
    if (args === undefined) continue;
    const parts = splitTopLevel(args);
    const last = parts.length === 0 ? "" : parts[parts.length - 1];
    const at = `${name}:${lineOf(code, match.index)}`;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(last)) {
      problems.push(`${at}: the read grant identity must be an identity the launcher observed, not "${last}"`);
      continue;
    }
    if (!new RegExp(`TargetObjectIdentity\\s+${last}\\s*=\\s*TargetObjectIdentity\\.Of\\(`).test(code)) {
      problems.push(`${at}: ${last} is passed as the read grant identity but does not come from TargetObjectIdentity.Of`);
    }
  }
}

// هوية تُصنع يدويًا هي الباب الذي تدخل منه القيمة الصفرية أو المخترعة.
for (const [name, code] of stripped) {
  if (name === "TargetObjectIdentity.cs") continue;
  if (/new\s+TargetObjectIdentity\s*\(/.test(code)) {
    problems.push(`${name}: a target object identity is constructed outside TargetObjectIdentity.Of`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) process.stdout.write(`ADAPTER_STATIC_CHECK ${problem}\n`);
  process.stdout.write(`ADAPTER_STATIC_CHECK ${String(problems.length)} problem(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`ADAPTER_STATIC_CHECK clean: ${String(files.length)} files, ${String(types.size)} types\n`);
  process.stdout.write("ADAPTER_STATIC_CHECK this is not a compiler; csc.exe on Windows remains the authority\n");
}
