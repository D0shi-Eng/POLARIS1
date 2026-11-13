// انحدار W-12: ربط الهدف بكائنه داخل حاوية بصفر قدرات.
//
// تاريخ العلّة، بالأدلة لا بالذاكرة:
//   • تشغيل 2026-09-04 17:21Z: `resolveNow` تستدعي `realpathSync` الجافاسكربتية،
//     والقراءة المسموحة تفشل TARGET_MOVED بلا رمز نظام.
//   • ADR-010 يستبدلها بـ `realpathSync.native`.
//   • تشغيل 2026-09-04 18:24Z (نفس البناء المُدرَّج، بصمة مُثبَتة): القراءة
//     المسموحة **ما تزال** تفشل، والرمز المحفوظ هذه المرة صريح:
//     `target could not be resolved at execution time: EPERM`.
//     وفي التشغيل نفسه فتح ضابطُ ACL — كودٌ لا يخصّ المنفّذ، داخل الحاوية عينها —
//     الملفَ نفسه بـ `openSync(path,'r')` وقرأ 77 بايت.
//
// الحصيلة المقيسة: حقُّ «الفتح للقراءة» تملكه الحاوية؛ الحقّ الذي يطلبه حلّ
// اسم المسار — أيًّا كان — لا تملكه. فأُزيل حلّ الاسم من المنفّذ أصلًا.
//
// وأُغلق معه سباق التسمية: التحقق والقراءة صارا على الكائن المفتوح نفسه
// (SAME_OBJECT_VERIFY_AND_USE). هذه الاختبارات تحرس الاثنين معًا.

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeGrant } from "../src/exec/fs-executor.js";
import type { ExecutionGrant, TargetIdentity } from "../src/pep/grant.js";
import { runtimeSrcPath } from "./helpers.js";

const BODY = "POLARIS W-12 fixture body, identical across scope classes";

/** الهوية كما ترصدها نقطة الفرض على المسار المحلول. */
function identityOf(hostPath: string): TargetIdentity {
  const stat = statSync(hostPath, { bigint: true });
  return { volume: stat.dev.toString(), file: stat.ino.toString() };
}

function readGrant(hostPath: string, roots: readonly string[], identity?: TargetIdentity): ExecutionGrant {
  return {
    grant_id: "11111111-1111-4111-8111-111111111111",
    correlation_id: "22222222-2222-4222-8222-222222222222",
    invocation_id: "33333333-3333-4333-8333-333333333333",
    decision_id: "44444444-4444-4444-8444-444444444444",
    operation: "READ_FILE",
    target: { logical: "T:\\SCOPE\\target.txt", host: hostPath, mode: "READ", ...(identity ? { identity } : {}) },
    allowed_host_roots: roots,
    max_bytes: 262144,
    deadline_ms: 15000,
    encoding: "utf-8",
    allow_overwrite: false,
  };
}

/** مساحة عمل بمسار محلول أصلًا، فلا يخلط الاختبار روابط النظام المؤقت بالعيب المقيس. */
function workspace(): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), "polaris-w12-resolve-")));
}

function executorSources(): string {
  const source =
    readFileSync(join(runtimeSrcPath(), "exec", "fs-executor.ts"), "utf8") +
    "\n" +
    readFileSync(join(runtimeSrcPath(), "exec", "target-object.ts"), "utf8");
  // التعليقات تشرح العلّة وتذكر الأسماء القديمة؛ الحكم على الكود وحده.
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ── الحراس الساكنون ──────────────────────────────────────────────────────────

test("the executor resolves no pathname at all: neither the JavaScript walk nor the native resolver", () => {
  const code = executorSources();
  assert.deepEqual(code.match(/realpathSync/g) ?? [], [], "the executor still resolves a pathname before opening");
});

test("SAME_OBJECT_VERIFY_AND_USE: nothing is reopened by pathname after verification", () => {
  const code = executorSources();

  // القراءة تقع على واصف: readSync وحدها. لا readFileSync ولا statSync على اسم.
  assert.deepEqual(code.match(/readFileSync\(/g) ?? [], [], "the read path reopens the target by pathname");
  assert.deepEqual(code.match(/\bstatSync\(/g) ?? [], [], "the target is re-examined by pathname after verification");

  // الهوية تُؤخذ من المقبض، لا من الاسم.
  assert.match(code, /fstatSync\(/, "the executor no longer takes the object identity from the open handle");
  assert.match(code, /readSync\(/, "the executor no longer reads from the open handle");

  // وترتيب المسار المسموح: فتح واحد، ثم هوية، ثم قراءة، ثم إغلاق.
  const openAt = code.indexOf("openOnce(grant.target.host)");
  const identityAt = code.indexOf("identityOf(opened.fd)");
  const readAt = code.indexOf("readWithCeiling(opened.fd");
  assert.ok(openAt > 0 && identityAt > openAt, "identity is taken before the single open");
  assert.ok(readAt > identityAt, "bytes are read before the opened object is verified");

  // ولا فتح ثانٍ للهدف في مسار القراءة: openOnce مرة واحدة على الهدف.
  assert.equal((code.match(/openOnce\(grant\.target\.host\)/g) ?? []).length, 2,
    "the target is opened by pathname more than once per operation path (read and write are one each)");
});

// ── السلوك الوظيفي ───────────────────────────────────────────────────────────

test("a plain in-scope file whose identity matches the grant is read from the opened object", () => {
  const root = workspace();
  try {
    const scope = join(root, "scope");
    mkdirSync(scope);
    const target = join(scope, "in-scope.txt");
    writeFileSync(target, BODY);

    const outcome = executeGrant(readGrant(target, [scope], identityOf(target)));
    assert.equal(outcome.error?.code, undefined);
    assert.equal(outcome.status, "SUCCESS");
    assert.equal(outcome.bytes, Buffer.byteLength(BODY));
    assert.equal(Buffer.from(outcome.content_base64 ?? "", "base64").toString("utf8"), BODY);

    const diagnostics = outcome.resolution_diagnostics;
    assert.equal(diagnostics?.path_resolution_primitive, "SINGLE_OPEN_SAME_OBJECT");
    assert.equal(diagnostics?.reopen_after_verification, false);
    assert.equal(diagnostics?.identity_compare_result, "MATCH");
    assert.equal(diagnostics?.containment_compare_result, "INSIDE");
    assert.equal(diagnostics?.close_success, true);
    assert.equal(diagnostics?.read_bytes, Buffer.byteLength(BODY));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a grant that carries no object identity is refused: nothing is read on trust", () => {
  const root = workspace();
  try {
    const scope = join(root, "scope");
    mkdirSync(scope);
    const target = join(scope, "in-scope.txt");
    writeFileSync(target, BODY);

    const outcome = executeGrant(readGrant(target, [scope]));
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.error?.code, "MISSING_TARGET_IDENTITY");
    assert.equal(outcome.bytes, 0);
    assert.equal(outcome.content_base64, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an identity mismatch fails closed: the object was replaced between decision and execution", () => {
  const root = workspace();
  try {
    const scope = join(root, "scope");
    mkdirSync(scope);
    const target = join(scope, "in-scope.txt");
    writeFileSync(target, BODY);
    const approved = identityOf(target);

    // استبدال ذرّي بين القرار والتنفيذ: الاسم نفسه، كائن آخر.
    // الاستبدال بإعادة تسمية عمدًا: الحذف ثم الإنشاء قد يعيد النظام فيه الرقم
    // نفسه، فلا يقيس الاختبار ما يدّعي قياسه.
    const replacement = join(scope, "replacement.txt");
    writeFileSync(replacement, "a different object entirely");
    assert.notEqual(identityOf(replacement).file, approved.file, "the host reused the object number");
    renameSync(replacement, target);

    const outcome = executeGrant(readGrant(target, [scope], approved));
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.error?.code, "TARGET_MOVED");
    assert.equal(outcome.content_base64, undefined);
    assert.equal(outcome.resolution_diagnostics?.identity_compare_result, "MISMATCH");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a link inside the scope that resolves outside it is refused before any open", (t) => {
  const root = workspace();
  try {
    const scope = join(root, "scope");
    const outside = join(root, "outside");
    mkdirSync(scope);
    mkdirSync(outside);
    const secret = join(outside, "secret.txt");
    writeFileSync(secret, BODY);
    const link = join(scope, "link.txt");
    try {
      symlinkSync(secret, link, "file");
    } catch {
      // إنشاء الروابط يحتاج امتيازًا على بعض المضيفات. لا يُدّعى ما لم يُقَس.
      t.skip("this host does not permit symlink creation");
      return;
    }

    // الأسوأ حالًا: منحة مزوَّرة تحمل هوية الملف السرّي نفسه. الرفض يقع قبلها.
    const outcome = executeGrant(readGrant(link, [scope], identityOf(secret)));
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.error?.code, "TARGET_LINK_IN_PATH");
    assert.equal(outcome.content_base64, undefined);
    assert.equal(outcome.bytes, 0);
    assert.equal(outcome.resolution_diagnostics?.open_started, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a link that stays inside the scope but names another file is refused too", (t) => {
  const root = workspace();
  try {
    const scope = join(root, "scope");
    mkdirSync(scope);
    const real = join(scope, "real.txt");
    writeFileSync(real, BODY);
    const link = join(scope, "alias.txt");
    try {
      symlinkSync(real, link, "file");
    } catch {
      t.skip("this host does not permit symlink creation");
      return;
    }

    const outcome = executeGrant(readGrant(link, [scope], identityOf(real)));
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.error?.code, "TARGET_LINK_IN_PATH");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a directory link between the granted root and the target is refused", (t) => {
  const root = workspace();
  try {
    const scope = join(root, "scope");
    const outside = join(root, "outside");
    mkdirSync(scope);
    mkdirSync(outside);
    const secret = join(outside, "secret.txt");
    writeFileSync(secret, BODY);
    const bridge = join(scope, "bridge");
    try {
      symlinkSync(outside, bridge, "dir");
    } catch {
      t.skip("this host does not permit symlink creation");
      return;
    }

    const target = join(bridge, "secret.txt");
    const outcome = executeGrant(readGrant(target, [scope], identityOf(secret)));
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.error?.code, "TARGET_LINK_IN_PATH");
    assert.match(outcome.resolution_diagnostics?.chain_scan_at ?? "", /bridge$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the byte ceiling is enforced on the opened object", () => {
  const root = workspace();
  try {
    const scope = join(root, "scope");
    mkdirSync(scope);
    const target = join(scope, "big.txt");
    writeFileSync(target, "x".repeat(64));

    const grant: ExecutionGrant = { ...readGrant(target, [scope], identityOf(target)), max_bytes: 8 };
    const outcome = executeGrant(grant);
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.error?.code, "TOO_LARGE");
    assert.equal(outcome.bytes, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a target that cannot be opened carries the real system error code", () => {
  // مسار يمرّ عبر ملف بوصفه مجلدًا: يفشل حتمًا وبلا امتيازات خاصة.
  const root = workspace();
  try {
    const scope = join(root, "scope");
    mkdirSync(scope);
    const blocker = join(scope, "blocker");
    writeFileSync(blocker, BODY);
    const target = join(scope, "blocker", "deeper", "child.txt");

    const outcome = executeGrant(readGrant(target, [scope], identityOf(blocker)));
    assert.equal(outcome.status, "FAILED");
    // الرمز يُنقل كما ورد من النظام: ENOTDIR ليس ENOENT ليس EPERM.
    const diagnostics = outcome.resolution_diagnostics;
    assert.equal(diagnostics?.chain_scan_clean, false);
    assert.match(
      `${diagnostics?.chain_scan_error_code ?? ""}${diagnostics?.chain_scan_reason ?? ""}`,
      /(ENOTDIR|ENOENT|EPERM|EACCES|ELOOP|ENAMETOOLONG|NOT_A_DIRECTORY|UNKNOWN)/,
      "the underlying system error was collapsed instead of preserved",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an out-of-scope target is still refused before any scan, open or identity check", () => {
  const root = workspace();
  try {
    const scope = join(root, "scope");
    const outside = join(root, "outside");
    mkdirSync(scope);
    mkdirSync(outside);
    const denied = join(outside, "denied.txt");
    writeFileSync(denied, BODY);

    const outcome = executeGrant(readGrant(denied, [scope], identityOf(denied)));
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.error?.code, "TARGET_OUTSIDE_GRANT");
    assert.equal(outcome.resolution_diagnostics, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── ما لا يُدّعى ─────────────────────────────────────────────────────────────

test("NOT A WINDOWS CLAIM: this file measures POSIX semantics on this host only", () => {
  // الوصلات والمقابض ودلالة الحقوق على ويندوز لا يقيسها هذا الملف. الادعاء
  // الوحيد هنا سلوكيّ ومحايد للمنصّة، وإثبات AppContainer يبقى W-12 الأصلي.
  assert.notEqual(process.platform, undefined);
});
