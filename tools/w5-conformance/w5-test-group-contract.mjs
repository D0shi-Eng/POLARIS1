// عقد دليل مجموعات اختبارات W5 — مصدر واحد للأسماء والأنواع.
//
// العيب الذي يغلقه هذا الملف وقع في التشغيل الأصلي الثالث: المجموعات الثماني
// كلها خرجت
//
//     INCONCLUSIVE W5-A audit chain — null tests, null failed, null skipped
//
// المُنتِج كان يقرأ ملخّص node:test من مجرى النصّ بتعبير نمطي يفترض شكل TAP
// وحده. المضيف الأصلي يحمل Node v24.14.1، ومُبلِّغه الافتراضي هناك spec:
//
//     TAP   :  "# tests 15"
//     spec  :  "ℹ tests 15"     (U+2139، بايتات e2 84 b9)
//
// فلم يطابق التعبير شيئًا، وعادت العدادات null. الأرقام لم تكن مفقودة؛ كان
// المستخرِج يقرأ شكلًا واحدًا من شكلين.
//
// وليست هذه مشكلة «مخطط بين المُنتِج والمستهلك»: run.ps1 قرأ summary.failed
// و summary.blocked و summary.inconclusive و summary.not_tested بنجاح وحكم
// W5_TEST_GROUP_NOT_CLEAN. الخلل كان قبل ذلك، داخل المُنتِج نفسه.
//
// لذلك: اسم واحد لكل حقل، ونوع واحد، وتحقّق يجري قبل أن يُحسب أي حكم. والغياب
// يبقى غيابًا: null لا يصير صفرًا.

export const W5_TEST_GROUP_SCHEMA_VERSION = "1.0.0";
export const W5_TEST_GROUP_TOOL = "polaris.w5.test-group";
export const W5_TEST_GROUPS_TOOL = "polaris.w5.test-groups";

export const W5_VERDICTS = ["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE", "NOT_TESTED"];

export const REASON_EVIDENCE_INCOMPLETE = "W5_TEST_GROUP_EVIDENCE_INCOMPLETE";
export const REASON_SUMMARY_UNREADABLE = "TEST_SUMMARY_UNREADABLE";
export const REASON_COUNT_MISMATCH = "W5_TEST_GROUP_COUNT_MISMATCH";

// الاسم المعتمد لكل عداد. لا مرادفات: passed لا pass، وfailed لا fail.
// الشكل المقروء من TAP يُترجم مرة واحدة عند القراءة، ولا يتسرّب إلى الدليل.
const COUNT_FIELDS = ["tests", "passed", "failed", "skipped", "cancelled", "todo"];

const REQUIRED_STRING = [
  "schema_version",
  "tool",
  "group_id",
  "group",
  "claim",
  "platform",
  "measurement_started",
  "measurement_completed",
  "summary_format",
  "verdict",
  "evidence_reference",
  "node_version",
  "reporter",
];

// حكمٌ نظيف لا سبب له: reason_code نصّ مطلوب، وفراغه قيمة صالحة تعني «لا عائق».
// وهذا ليس تساهلًا: النوع مفروض، والغياب التام مرفوض.
const REQUIRED_POSSIBLY_EMPTY_STRING = ["reason_code"];

const REQUIRED_BOOLEAN = ["canonical", "native", "evidence_complete", "reporter_forced"];

function isInteger(value) {
  return typeof value === "number" && Number.isInteger(value);
}

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * يتحقّق من سجل مجموعة واحدة.
 *
 * القاعدة الحاسمة: evidence_complete=true يعني أن كل عدّاد رقم صحيح. غيابه
 * يعني null صراحةً — لا صفرًا. صفرٌ مكانَ غياب يقول «لا إخفاقات» عن قياس لم
 * يُقرأ أصلًا، وهو أسوأ من الغياب لأنه يبدو نتيجة.
 */
export function validateGroupRecord(record) {
  const violations = [];
  const add = (field, reason) => violations.push({ field, reason });

  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, violations: [{ field: "<document>", reason: `NOT_AN_OBJECT (${typeName(record)})` }] };
  }

  for (const field of REQUIRED_STRING) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      add(field, `EXPECTED_NON_EMPTY_STRING (${typeName(record[field])})`);
    }
  }
  for (const field of REQUIRED_POSSIBLY_EMPTY_STRING) {
    if (typeof record[field] !== "string") add(field, `EXPECTED_STRING (${typeName(record[field])})`);
  }
  for (const field of REQUIRED_BOOLEAN) {
    if (typeof record[field] !== "boolean") add(field, `EXPECTED_BOOLEAN (${typeName(record[field])})`);
  }
  if (!isInteger(record["duration_ms"])) add("duration_ms", `EXPECTED_INTEGER (${typeName(record["duration_ms"])})`);
  if (record["exit_code"] !== null && !isInteger(record["exit_code"])) {
    add("exit_code", `EXPECTED_INTEGER_OR_NULL (${typeName(record["exit_code"])})`);
  }
  if (!W5_VERDICTS.includes(record["verdict"])) {
    add("verdict", `EXPECTED_ONE_OF ${W5_VERDICTS.join("|")} (${String(record["verdict"])})`);
  }
  if (record["schema_version"] !== W5_TEST_GROUP_SCHEMA_VERSION) {
    add("schema_version", `EXPECTED ${W5_TEST_GROUP_SCHEMA_VERSION} (${String(record["schema_version"])})`);
  }

  const complete = record["evidence_complete"] === true;
  for (const field of COUNT_FIELDS) {
    const value = record[field];
    if (complete) {
      if (!isInteger(value) || value < 0) add(field, `EXPECTED_NON_NEGATIVE_INTEGER (${typeName(value)})`);
    } else if (value !== null) {
      add(field, `EXPECTED_NULL_WHEN_EVIDENCE_INCOMPLETE (${typeName(value)})`);
    }
  }

  if (!complete && !["INCONCLUSIVE", "BLOCKED"].includes(record["verdict"])) {
    add("verdict", "INCOMPLETE_EVIDENCE_MUST_NOT_CARRY_A_MEASURED_VERDICT");
  }

  // مصالحة العدّ: مجموع الأصناف يساوي عدد الاختبارات المُعلَن.
  if (complete && violations.length === 0) {
    const sum =
      record["passed"] + record["failed"] + record["skipped"] + record["cancelled"] + record["todo"];
    if (sum !== record["tests"]) {
      add("tests", `COUNTS_DO_NOT_RECONCILE (tests=${record["tests"]}, parts=${sum})`);
    }
  }

  return { ok: violations.length === 0, violations };
}

/** يتحقّق من الوثيقة المجمِّعة: التسميات، والأنواع، ومصالحة عدد المجموعات. */
export function validateAggregate(document) {
  const violations = [];
  const add = (field, reason) => violations.push({ field, reason });

  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, violations: [{ field: "<document>", reason: `NOT_AN_OBJECT (${typeName(document)})` }] };
  }
  if (document["schema_version"] !== W5_TEST_GROUP_SCHEMA_VERSION) {
    add("schema_version", `EXPECTED ${W5_TEST_GROUP_SCHEMA_VERSION} (${String(document["schema_version"])})`);
  }
  const groups = document["groups"];
  if (!Array.isArray(groups)) return { ok: false, violations: [...violations, { field: "groups", reason: "EXPECTED_ARRAY" }] };

  const summary = document["summary"];
  if (summary === null || typeof summary !== "object") {
    return { ok: false, violations: [...violations, { field: "summary", reason: "EXPECTED_OBJECT" }] };
  }
  const verdictTallies = ["passed", "failed", "blocked", "inconclusive", "not_tested"];
  for (const field of verdictTallies) {
    if (!isInteger(summary[field]) || summary[field] < 0) {
      add(`summary.${field}`, `EXPECTED_NON_NEGATIVE_INTEGER (${typeName(summary[field])})`);
    }
  }
  for (const field of ["total_tests", "total_failed", "total_skipped"]) {
    const value = summary[field];
    if (value !== null && (!isInteger(value) || value < 0)) {
      add(`summary.${field}`, `EXPECTED_NON_NEGATIVE_INTEGER_OR_NULL (${typeName(value)})`);
    }
  }
  if (violations.length === 0) {
    const tallied = verdictTallies.reduce((total, field) => total + summary[field], 0);
    if (tallied !== groups.length) {
      add("summary", `GROUP_COUNT_DOES_NOT_RECONCILE (tallied=${tallied}, groups=${groups.length})`);
    }
    // الإجماليات غياب لا صفر: مجموعة واحدة غير مقروءة تجعل الإجمالي null.
    const anyIncomplete = groups.some((group) => group["evidence_complete"] !== true);
    if (anyIncomplete && summary["total_tests"] !== null) {
      add("summary.total_tests", "EXPECTED_NULL_WHEN_ANY_GROUP_EVIDENCE_IS_INCOMPLETE");
    }
  }

  for (const group of groups) {
    const result = validateGroupRecord(group);
    for (const violation of result.violations) {
      add(`groups[${String(group?.["group_id"] ?? "?")}].${violation.field}`, violation.reason);
    }
  }

  return { ok: violations.length === 0, violations };
}

// أشكال ملخّص node:test المعروفة. الاسم يُعلَن في الدليل، فلا يُخمَّن لاحقًا.
const SUMMARY_SHAPES = [
  { format: "TAP", marker: "#" },
  { format: "SPEC", marker: "ℹ" },
];

const TAP_TO_CANONICAL = {
  tests: "tests",
  pass: "passed",
  fail: "failed",
  skipped: "skipped",
  cancelled: "cancelled",
  todo: "todo",
};

export function stripAnsi(text) {
  // محارف التلوين تُزال قبل المطابقة: مُبلِّغ ملوَّن لا يجوز أن يجعل قياسًا
  // مقروءًا يبدو غير مقروء. \u001b هو ESC.
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

/**
 * يقرأ ملخّص node:test من المخرَج.
 *
 * القراءة تجري سطرًا سطرًا بعد الفصل على /\r?\n/ حتى لا يكون خاتم السطر
 * (LF أو CRLF) هو ما يقرّر إن كان القياس مقروءًا. والشكل المقروء يُسمّى.
 */
export function scanSummary(output) {
  const lines = stripAnsi(output).split(/\r?\n/).map((line) => line.trim());
  for (const shape of SUMMARY_SHAPES) {
    const values = {};
    for (const [tapName, canonicalName] of Object.entries(TAP_TO_CANONICAL)) {
      const pattern = new RegExp(`^${shape.marker}\\s+${tapName}\\s+(\\d+)$`);
      for (const line of lines) {
        const match = pattern.exec(line);
        if (match !== null) values[canonicalName] = Number(match[1]);
      }
    }
    if (typeof values["tests"] === "number") {
      return { format: shape.format, values };
    }
  }
  return { format: "UNREADABLE", values: {} };
}
