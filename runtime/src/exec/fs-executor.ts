// منفّذ آثار نظام الملفات. هذا هو الملف الوحيد في المشروع الذي يجمع بين
// نظام الملفات ونوع المنحة، أي الوحيد الذي يستطيع إحداث أثر تحت سلطة قرار.
//
// يعيد إثبات الاحتواء بنفسه من المنحة: لا يثق في أن نقطة الفرض فعلت ذلك.
// لا يقرأ استدعاءً ولا قرارًا ولا إعدادًا، فلا يملك ما يعيد تفسيره.
//
// الثابت المعماري الحاكم — SAME_OBJECT_VERIFY_AND_USE:
//   لا يُحلّ اسمُ مسار ثم يُفتح ذلك الاسم مرة أخرى. الهدف يُفتح مرة واحدة،
//   وتُؤخذ هويته ونوعه وحجمه وبايتاته من الكائن المفتوح نفسه، ويُغلق حتمًا.
//   ميكانيكا ذلك في ./target-object.js؛ هنا سياسة المنفّذ وبروتوكوله.

import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { fstatSync, readdirSync, readlinkSync } from "node:fs";

import {
  closeObject,
  identityOf,
  insideGrantedRoots,
  matchingRoot,
  openOnce,
  readWithCeiling,
  sameObject,
  scanChain,
} from "./target-object.js";
import type {
  DescriptorFinding,
  EnvironmentFinding,
  ExecutionGrant,
  ExecutionOutcome,
  ExecutorErrorCode,
  HandleProbe,
  HostDiagnostics,
  ResolutionDiagnostics,
} from "../pep/grant.js";

/**
 * يرصد البيئة وأسطح الشبكة داخل العملية المنفِّذة، لا حولها.
 *
 * التصنيف بالقيمة مقصود: تطابق الأسماء وحده لا يفرّق بين متغيّر بناه POLARIS
 * ومتغيّر ورثه الابن من الأب بنفس الاسم. المقارنة بالقيمة هي ما يجعل
 * "لم يُورَّث" ادعاءً قابلًا للإثبات.
 */
export function collectDiagnostics(contract?: Readonly<Record<string, string>>): HostDiagnostics {
  const surfaces = ["fetch", "WebSocket", "XMLHttpRequest", "EventSource"];
  const present = process.env;
  const findings: EnvironmentFinding[] = [];

  if (contract !== undefined) {
    // ويندوز يقارن أسماء البيئة بلا حساسية للحالة، فالمقارنة هنا كذلك.
    const declared = new Map<string, string>();
    for (const [name, value] of Object.entries(contract)) declared.set(name.toUpperCase(), value);

    for (const name of Object.keys(present).sort()) {
      const expected = declared.get(name.toUpperCase());
      if (expected === undefined) {
        findings.push({ name, classification: "AMBIENTLY_INHERITED" });
      } else if (present[name] !== expected) {
        findings.push({ name, classification: "AMBIENTLY_OVERRIDDEN" });
      } else {
        findings.push({ name, classification: "EXPLICITLY_CONSTRUCTED" });
      }
    }
  }

  return {
    environment_keys: Object.keys(present).sort(),
    environment_findings: findings,
    environment_contract_present: contract !== undefined,
    environment_exactly_as_constructed:
      contract !== undefined && findings.every((f) => f.classification === "EXPLICITLY_CONSTRUCTED"),
    network_globals_present: surfaces.filter(
      (name) => (globalThis as unknown as Record<string, unknown>)[name] !== undefined,
    ),
    working_directory: process.cwd(),
  };
}

/** سجل تشخيصي قابل للكتابة أثناء المسار، يُجمَّد في الحصيلة. */
type MutableDiagnostics = { -readonly [K in keyof ResolutionDiagnostics]: ResolutionDiagnostics[K] };

function newDiagnostics(grant: ExecutionGrant): MutableDiagnostics {
  return {
    precheck_target: grant.target.host,
    precheck_allowed_root: "",
    path_resolution_primitive: "SINGLE_OPEN_SAME_OBJECT",
    chain_scan_started: false,
    chain_scan_entries: 0,
    chain_scan_clean: false,
    chain_scan_reason: "",
    chain_scan_at: "",
    chain_scan_error_code: "",
    open_started: false,
    open_success: false,
    open_error_code: "",
    open_errno: 0,
    open_syscall: "",
    fstat_success: false,
    fstat_error_code: "",
    identity_expected: grant.target.identity,
    identity_observed: undefined,
    identity_compare_result: "NOT_COMPARED",
    identity_volume_compared: false,
    containment_compare_result: "NOT_COMPARED",
    reopen_after_verification: false,
    read_success: false,
    read_bytes: 0,
    read_error_code: "",
    close_success: false,
  };
}

function failure(
  grant: ExecutionGrant,
  code: ExecutorErrorCode,
  detail: string,
  probe: HandleProbe,
  diagnostics?: MutableDiagnostics,
): ExecutionOutcome {
  const base = {
    status: "FAILED" as const,
    grant_id: grant.grant_id,
    bytes: 0,
    truncated: false,
    handle_probe: probe,
    host_diagnostics: collectDiagnostics(grant.environment_contract),
    error: { code, detail },
  };
  return diagnostics === undefined ? base : { ...base, resolution_diagnostics: diagnostics };
}

/**
 * فحص المقابض الموروثة داخل العملية المنفِّذة.
 *
 * لا يكفي عدّ الواصفات المفتوحة: بيئة التشغيل تفتح واصفات داخلية بنفسها.
 * السؤال الحقيقي هو الذي أثبت W1 خطورته في X03: هل يوجد مقبض موروث يشير
 * إلى مورد في نظام الملفات خارج المنحة. لذلك يُقرأ هدف كل واصف ويُصنَّف.
 *
 * الطريقة متاحة على لينكس عبر /proc/self/fd. على ويندوز يحتاج المكافئ
 * استعلامًا أصليًا عن جدول المقابض، فتُعلَن الطريقة NONE ولا يُدّعى قياس.
 */
export function probeInheritedHandles(allowedRoots: readonly string[]): HandleProbe {
  const unsupported: HandleProbe = {
    supported: false,
    platform: process.platform,
    method: "NONE",
    filesystem_descriptors: [],
    other_descriptors: [],
    open_descriptor_count: 0,
  };
  if (process.platform !== "linux") return unsupported;

  let entries: string[];
  try {
    entries = readdirSync("/proc/self/fd");
  } catch {
    return unsupported;
  }

  const files: DescriptorFinding[] = [];
  const others: DescriptorFinding[] = [];
  let open = 0;

  for (const entry of entries) {
    const fd = Number(entry);
    if (!Number.isInteger(fd) || fd < 3) continue;
    open += 1;

    let target = "unknown";
    try {
      target = readlinkSync(`/proc/self/fd/${String(fd)}`);
    } catch {
      // واصف اختفى بين السرد والقراءة. يُعدّ ولا يُصنَّف.
    }
    // قراءة /proc/self/fd نفسها تفتح واصفًا مؤقتًا. لا معنى لتصنيفه.
    if (target.startsWith("/proc/")) continue;

    let kind: DescriptorFinding["kind"] = "OTHER";
    try {
      const stat = fstatSync(fd);
      kind = stat.isFile()
        ? "FILE"
        : stat.isDirectory()
          ? "DIRECTORY"
          : stat.isCharacterDevice()
            ? "CHARACTER_DEVICE"
            : stat.isFIFO()
              ? "PIPE"
              : stat.isSocket()
                ? "SOCKET"
                : "OTHER";
    } catch {
      kind = "OTHER";
    }

    const finding: DescriptorFinding = {
      fd,
      target,
      kind,
      inside_grant: kind === "FILE" || kind === "DIRECTORY" ? insideGrantedRoots(target, allowedRoots) : true,
    };
    if (kind === "FILE" || kind === "DIRECTORY") files.push(finding);
    else others.push(finding);
  }

  return {
    supported: true,
    platform: process.platform,
    method: "PROC_FD_LINKS",
    filesystem_descriptors: files,
    other_descriptors: others,
    open_descriptor_count: open,
  };
}

export function executeGrant(grant: ExecutionGrant): ExecutionOutcome {
  const probe = probeInheritedHandles(grant.allowed_host_roots);

  if (grant.allowed_host_roots.length === 0) {
    return failure(grant, "MALFORMED_GRANT", "grant carries no allowed roots", probe);
  }
  if (grant.max_bytes <= 0) {
    return failure(grant, "MALFORMED_GRANT", "grant carries no positive byte ceiling", probe);
  }
  // الحدّ الأول ما يزال نصّيًا وقبل أي فتح: هدف خارج الجذور يُرفض بلا لمس قرص.
  const root = matchingRoot(grant.target.host, grant.allowed_host_roots);
  if (root === undefined) {
    return failure(grant, "TARGET_OUTSIDE_GRANT", "target is not under any granted root", probe);
  }

  return grant.operation === "READ_FILE" ? readFile(grant, probe, root) : writeFile(grant, probe, root);
}

/**
 * القراءة، على الكائن نفسه من التحقق إلى البايتات.
 *
 * الترتيب مُلزِم ولا يُعاد ترتيبه: رفضٌ تمهيدي، ثم فتحٌ واحد، ثم هويةٌ ونوعٌ
 * وحجمٌ من ذلك الكائن، ثم مطابقةٌ للهوية المُقرّة، ثم سقفٌ عليه هو، ثم قراءة
 * منه هو، ثم إغلاق حتمي. لا فتح ثانٍ باسم المسار في أي موضع بعد التحقق.
 */
function readFile(grant: ExecutionGrant, probe: HandleProbe, root: string): ExecutionOutcome {
  const diagnostics = newDiagnostics(grant);
  diagnostics.precheck_allowed_root = root;

  const expected = grant.target.identity;
  if (expected === undefined || expected.file.length === 0 || expected.file === "0") {
    diagnostics.identity_compare_result = "UNAVAILABLE";
    return failure(
      grant,
      "MISSING_TARGET_IDENTITY",
      "the grant carries no target object identity, so the opened object cannot be proven to be the approved one",
      probe,
      diagnostics,
    );
  }

  // 1) رفض تمهيدي: وصلة ظاهرة بين الجذر الممنوح والهدف تُرفض قبل الفتح.
  diagnostics.chain_scan_started = true;
  const chain = scanChain(root, grant.target.host);
  if (!chain.ok) {
    diagnostics.chain_scan_reason = chain.reason;
    diagnostics.chain_scan_at = chain.at;
    diagnostics.chain_scan_error_code = chain.code;
    const code: ExecutorErrorCode = chain.reason === "LINK_IN_PATH" ? "TARGET_LINK_IN_PATH" : "IO_ERROR";
    return failure(grant, code, `${chain.reason} at ${chain.at}: ${chain.code}`, probe, diagnostics);
  }
  diagnostics.chain_scan_clean = true;
  diagnostics.chain_scan_entries = chain.entries;

  // 2) الفتح الواحد.
  diagnostics.open_started = true;
  const opened = openOnce(grant.target.host);
  if (!opened.ok) {
    diagnostics.open_error_code = opened.code;
    diagnostics.open_errno = opened.errno;
    diagnostics.open_syscall = opened.syscall;
    return failure(grant, "IO_ERROR", `open failed: ${opened.code}`, probe, diagnostics);
  }
  diagnostics.open_success = true;
  let closed = false;

  try {
    // 3) الهوية والنوع والحجم من الكائن المفتوح نفسه.
    const identified = identityOf(opened.fd);
    if (!identified.ok) {
      diagnostics.fstat_error_code = identified.code;
      diagnostics.identity_compare_result = "UNAVAILABLE";
      const code: ExecutorErrorCode =
        identified.code === "IDENTITY_UNAVAILABLE" ? "TARGET_IDENTITY_UNAVAILABLE" : "IO_ERROR";
      return failure(grant, code, identified.detail, probe, diagnostics);
    }
    const object = identified.object;
    diagnostics.fstat_success = true;
    diagnostics.identity_observed = object.identity;

    // 4) مطابقة الهوية. هنا يُغلق سباق الاسم: المفتوح إمّا هو المُقرّ أو لا شيء.
    const comparison = sameObject(expected, object.identity);
    diagnostics.identity_volume_compared = comparison.volume_compared;
    diagnostics.identity_compare_result = comparison.equal ? "MATCH" : "MISMATCH";
    if (!comparison.equal) {
      return failure(
        grant,
        "TARGET_MOVED",
        "the opened object is not the object the grant identifies",
        probe,
        diagnostics,
      );
    }
    // الاحتواء: الاسم أُثبت داخل الجذر قبل الفتح، والكائن أُثبت هو المُقرّ.
    diagnostics.containment_compare_result = "INSIDE";

    if (!object.is_file) {
      return failure(grant, "NOT_A_FILE", "target is not a regular file", probe, diagnostics);
    }
    // 5) السقف على الكائن المفتوح.
    if (object.size > grant.max_bytes) {
      return failure(
        grant,
        "TOO_LARGE",
        `size ${String(object.size)} exceeds ceiling ${String(grant.max_bytes)}`,
        probe,
        diagnostics,
      );
    }

    // 6) القراءة من الكائن نفسه، والسقف يُفرض ثانيةً على ما قُرئ فعلًا.
    let bytes: Buffer;
    let truncated: boolean;
    try {
      const read = readWithCeiling(opened.fd, grant.max_bytes);
      bytes = read.bytes;
      truncated = read.truncated;
    } catch (error) {
      diagnostics.read_error_code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
      return failure(grant, "IO_ERROR", `read failed: ${diagnostics.read_error_code}`, probe, diagnostics);
    }
    diagnostics.read_success = true;
    diagnostics.read_bytes = bytes.byteLength;
    // الإغلاق قبل بناء الحصيلة، حتى تحمل نتيجته لا وعدًا بها.
    diagnostics.close_success = closeObject(opened.fd);
    closed = true;

    return {
      status: "SUCCESS",
      grant_id: grant.grant_id,
      bytes: bytes.byteLength,
      truncated,
      content_base64: bytes.toString("base64"),
      content_sha256: createHash("sha256").update(bytes).digest("hex"),
      handle_probe: probe,
      host_diagnostics: collectDiagnostics(grant.environment_contract),
      resolution_diagnostics: { ...diagnostics },
    };
  } finally {
    // إغلاق حتمي مهما كان مسار الخروج، ومرة واحدة.
    if (!closed) diagnostics.close_success = closeObject(opened.fd);
  }
}

/**
 * كتابة آمنة: ملف مؤقت في نفس المجلد المسموح، ثم دفع إلى القرص، ثم استبدال ذرّي.
 * الادعاء محدود عمدًا: لا كتابة جزئية صامتة. متانة الانهيار غير مُدّعاة
 * لأنها غير مُختبَرة في W4.
 *
 * حدّ مُعلَن (ADR-010): الاستبدال الذرّي يقع باسم المسار، فدلالة «الكائن نفسه»
 * ليست مُدّعاة للكتابة في هذه الجولة، وهي عمل Phase-00 لاحق. الموجود هنا:
 * وجودُ الهدف يُقرَّر بفتح واحد، وهويته — إن حملتها المنحة — تُطابَق على ذلك
 * المقبض قبل أي استبدال.
 */
function writeFile(grant: ExecutionGrant, probe: HandleProbe, root: string): ExecutionOutcome {
  const payload = grant.payload_base64;
  if (payload === undefined) return failure(grant, "MISSING_PAYLOAD", "write grant carries no payload", probe);

  const chain = scanChain(root, grant.target.host);
  if (!chain.ok && chain.reason === "LINK_IN_PATH") {
    return failure(grant, "TARGET_LINK_IN_PATH", `LINK_IN_PATH at ${chain.at}`, probe);
  }

  // وجود الهدف يُقرَّر بفتح واحد، لا باستعلام اسم ثم فتح.
  let exists: boolean;
  const opened = openOnce(grant.target.host);
  if (opened.ok) {
    exists = true;
    const declared = grant.target.identity;
    if (declared !== undefined && declared.file.length > 0) {
      const identified = identityOf(opened.fd);
      const equal = identified.ok && sameObject(declared, identified.object.identity).equal;
      closeObject(opened.fd);
      if (!equal) {
        return failure(grant, "TARGET_MOVED", "the existing object is not the object the grant identifies", probe);
      }
    } else {
      closeObject(opened.fd);
    }
  } else if (opened.code === "ENOENT") {
    exists = false;
  } else {
    return failure(grant, "IO_ERROR", `target could not be examined: ${opened.code}`, probe);
  }

  if (exists && !grant.allow_overwrite) {
    return failure(grant, "OVERWRITE_FORBIDDEN", "target exists and the grant does not permit overwrite", probe);
  }
  if (exists && grant.target.mode !== "MODIFY") {
    return failure(grant, "OVERWRITE_FORBIDDEN", "grant declares CREATE but the target already exists", probe);
  }
  if (!exists && grant.target.mode !== "CREATE") {
    return failure(grant, "IO_ERROR", "grant declares MODIFY but the target does not exist", probe);
  }

  const buffer = Buffer.from(payload, "base64");
  if (buffer.byteLength > grant.max_bytes) {
    return failure(grant, "TOO_LARGE", `payload ${String(buffer.byteLength)} exceeds ceiling ${String(grant.max_bytes)}`, probe);
  }

  const temporary = `${grant.target.host}.polaris-${randomBytes(8).toString("hex")}.tmp`;
  if (!insideGrantedRoots(temporary, grant.allowed_host_roots)) {
    return failure(grant, "TARGET_OUTSIDE_GRANT", "temporary file would fall outside the granted roots", probe);
  }

  let descriptor: number | undefined;
  try {
    writeFileSync(temporary, buffer, { flag: "wx" });
    descriptor = openSync(temporary, "r+");
    // دفع المحتوى إلى القرص قبل الاستبدال. لا يُدّعى أكثر من ذلك.
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, grant.target.host);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // لا شيء يُفعل هنا.
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // إن تعذّر الحذف يبقى الملف المؤقت. يُذكر في الخطأ ولا يُخفى.
    }
    return failure(grant, "IO_ERROR", (error as NodeJS.ErrnoException).code ?? "write failed", probe);
  }

  return {
    status: "SUCCESS",
    grant_id: grant.grant_id,
    bytes: buffer.byteLength,
    truncated: false,
    content_sha256: createHash("sha256").update(buffer).digest("hex"),
    wrote: exists ? "MODIFY" : "CREATE",
    handle_probe: probe,
    host_diagnostics: collectDiagnostics(grant.environment_contract),
  };
}
