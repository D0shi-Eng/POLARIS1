// فحص ساكن لمصدر محوّل W5، يُشغَّل على أي مضيف.
//
// نفس منطق فحص W4 وأضيق منه: هذه الشجرة ملفان، والمُصرِّف الحاكم هو csc.exe
// المدمج في ويندوز. الفحص لا يدّعي أنه مُصرِّف، ونجاحه لا يُسجَّل بديلًا عن
// التصريف؛ يمنع صنفًا واحدًا من الأخطاء: قوس غير مغلق، وبنية لغة أحدث مما
// يفهمه المُصرِّف المدمج.
//
// الحكم: خرج بصفر = لم يُعثر على خرق. ليس معناه «يُصرَّف».

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ADAPTER = dirname(fileURLToPath(import.meta.url));

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
  const pairs = { "{": "}", "(": ")", "[": "]" };
  const stack = [];
  let line = 1;
  for (const character of code) {
    if (character === "\n") line += 1;
    if (pairs[character] !== undefined) stack.push({ character, line });
    else if (character === "}" || character === ")" || character === "]") {
      const open = stack.pop();
      if (open === undefined) return `unbalanced closing "${character}" at line ${line}`;
      if (pairs[open.character] !== character) {
        return `"${open.character}" opened at line ${open.line} is closed by "${character}" at line ${line}`;
      }
    }
  }
  if (stack.length > 0) {
    const open = stack[stack.length - 1];
    return `"${open.character}" opened at line ${open.line} is never closed`;
  }
  return undefined;
}

const FORBIDDEN = [
  [/\$@?"/, 'interpolated string ($"...") is C# 6'],
  [/\?\./, "null-conditional (?.) is C# 6"],
  [/\?\[/, "null-conditional index (?[) is C# 6"],
  [/\bnameof\s*\(/, "nameof() is C# 6"],
  [/\bout\s+var\b/, "out var is C# 7"],
  [/=>/, "expression-bodied members and lambdas are avoided in this adapter"],
  [/\bwhen\s*\(/, "exception filters are C# 6"],
  [/\?\?=/, "null-coalescing assignment is C# 8"],
];

const problems = [];
const files = readdirSync(ADAPTER).filter((name) => name.endsWith(".cs")).sort();
if (files.length === 0) problems.push("no W5 adapter sources were found");

for (const name of files) {
  const code = strip(readFileSync(join(ADAPTER, name), "utf8"));
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

// الادعاء لا يتوسّع: هذا الوضع يقيس الإيقاف وحده.
const panic = readFileSync(join(ADAPTER, "PanicStopMode.cs"), "utf8");
for (const [pattern, why] of [
  [/taskkill/i, "the W5 adapter must never kill a process by name"],
  [/GetProcessesByName/, "the W5 adapter must never resolve processes by name in order to kill them"],
]) {
  if (pattern.test(panic)) problems.push(`PanicStopMode.cs: ${why}`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`W5 adapter static check: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`W5 adapter static check: ${files.length} file(s), no breach found (this is not a compile)`);
