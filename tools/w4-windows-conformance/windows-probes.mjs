// مسبار المطابقة الأصلي لويندوز — W4.
//
// هذا الملف لا يُشغَّل في بيئة غير ويندوز، ولا يُدّعى أي من نتائجه قبل تشغيله فعلًا.
// كل مسبار يُعيد PASS أو FAIL أو SKIPPED مع سبب صريح. لا يوجد "افتراض نجاح".
//
// ما يثبته هذا المسبار:
//   دلالات مسارات ويندوز الحقيقية (وصلات، حالة الأحرف، أسماء الأجهزة، مجاري بديلة)
//   وأثر قراءة وكتابة حقيقي عبر Gateway → PDP → PEP → عملية تنفيذ منفصلة على ويندوز.
//
// ما لا يثبته:
//   حصر AppContainer + Job Object. ذاك محوّل منفصل لم يُبنَ في W4،
//   وإثباته يبقى مع مشروع W1 (tools/confinement-spike).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── جذر المستودع ────────────────────────────────────────────────────────────
// نفس عقد الإقلاع الذي في run.ps1: لا آلية واحدة، ولا اعتماد على مجلد العمل.
// مجلد العمل مقبول، لكنه ليس المصدر الوحيد ولا الأول.

const BOOTSTRAP_ERROR_CODE = "WINDOWS_RUNNER_BOOTSTRAP_DEFECT";

const REPOSITORY_MARKERS = [
  join("contracts", "package.json"),
  join("contracts", "schemas"),
  join("runtime", "package.json"),
  join("docs", "phases", "PHASE-00"),
  join("tools", "w4-windows-conformance", "windows-probes.mjs"),
];

function missingMarkers(root) {
  return REPOSITORY_MARKERS.filter((marker) => !existsSync(join(root, marker)));
}

function argumentRoot(argv) {
  const index = argv.indexOf("--root");
  if (index >= 0 && typeof argv[index + 1] === "string") return argv[index + 1];
  const inline = argv.find((a) => a.startsWith("--root="));
  return inline === undefined ? undefined : inline.slice("--root=".length);
}

/** يصعد من موقع هذا الملف بحثًا عن علامات المستودع. */
function rootFromModuleLocation() {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (missingMarkers(current).length === 0) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function resolveRepositoryRoot(argv) {
  const attempts = [];
  const consider = (source, candidate) => {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      attempts.push({ source, candidate: "", status: "EMPTY", missing_markers: [] });
      return undefined;
    }
    const resolved = resolvePath(candidate);
    if (!existsSync(resolved)) {
      attempts.push({ source, candidate: resolved, status: "NOT_A_DIRECTORY", missing_markers: [] });
      return undefined;
    }
    const missing = missingMarkers(resolved);
    if (missing.length > 0) {
      attempts.push({ source, candidate: resolved, status: "NOT_A_POLARIS_REPOSITORY", missing_markers: missing });
      return undefined;
    }
    attempts.push({ source, candidate: resolved, status: "ACCEPTED", missing_markers: [] });
    return resolved;
  };

  // وسيطة صريحة: تُستعمل وتُتحقق، وإن كانت خاطئة نفشل بصوت عالٍ بلا احتياطي.
  const explicit = argumentRoot(argv);
  if (explicit !== undefined) {
    const accepted = consider("--root argument", explicit);
    return { root: accepted, attempts };
  }

  const fromModule = rootFromModuleLocation();
  const ordered = [
    ["module location", fromModule],
    ["POLARIS_ROOT environment variable", process.env.POLARIS_ROOT],
    ["current directory", process.cwd()],
  ];
  for (const [source, candidate] of ordered) {
    if (candidate === undefined) continue;
    const accepted = consider(source, candidate);
    if (accepted !== undefined) return { root: accepted, attempts };
  }
  return { root: undefined, attempts };
}

/**
 * علامة المشغّل. يضعها run.ps1 وحده قبل استدعاء المسابر. غيابها يعني أن هذا
 * التشغيل ليس التشغيل الأصلي القانوني، فلا يكتب باسمه ولا ينتحل دليله.
 */
const NATIVE_RUN = process.env["POLARIS_W4_NATIVE_RUN"] === "1";

const RESOLUTION = resolveRepositoryRoot(process.argv.slice(2));
const REPOSITORY_ROOT = RESOLUTION.root;
const RUNTIME_DIST =
  REPOSITORY_ROOT === undefined
    ? undefined
    : join(REPOSITORY_ROOT, "runtime", "dist", "src", "index.js");

// ── تصنيف الأحكام الرسمي ─────────────────────────────────────────────────────
// معتمد لكل نتائج W4، الحالية والمستقبلية. الفوارق بينها ليست لفظية:
//   PASS          القياس وقع، والدليل أثبت تحقق المتطلب.
//   FAIL          القياس وقع، والدليل أثبت مخالفة المتطلب.
//   BLOCKED       القياس لم يقع: prerequisite أو أداة أو بيئة تعذّرت.
//   INCONCLUSIVE  القياس وقع، لكن جودته أو اكتماله لا يسمح بحكم صالح.
//   NOT_TESTED    التجربة لم تُجرَ في هذه الجولة.
// ولا يُحوَّل BLOCKED ولا INCONCLUSIVE ولا NOT_TESTED إلى PASS بحال.
const VERDICT_CLASSIFICATION = {
  PASS: "the measurement ran and the evidence proves the requirement met",
  FAIL: "the measurement ran and the evidence proves the requirement violated",
  BLOCKED: "the required measurement did not happen: a prerequisite, tool or environment was unavailable",
  INCONCLUSIVE: "the measurement ran, but the quality or completeness of its evidence does not support a valid verdict",
  SKIPPED: "the probe does not apply on this host and claims nothing",
  NOT_TESTED: "the probe was not exercised in this run",
};

const MEASUREMENT_DEFAULTS = {
  PASS: { measurement_started: true, measurement_completed: true, evidence_complete: true },
  FAIL: { measurement_started: true, measurement_completed: true, evidence_complete: true },
  BLOCKED: { measurement_started: true, measurement_completed: false, evidence_complete: false },
  INCONCLUSIVE: { measurement_started: true, measurement_completed: true, evidence_complete: false },
  SKIPPED: { measurement_started: false, measurement_completed: false, evidence_complete: false },
  NOT_TESTED: { measurement_started: false, measurement_completed: false, evidence_complete: false },
};

const results = [];

/**
 * كل حكم يحمل معه: هل بدأ القياس، هل اكتمل، هل الدليل كامل، رمز السبب، ومرجع
 * الدليل. حكم بلا هذه الحقول لا يمكن مراجعته، والمراجعة هي المقصود.
 */
function record(id, title, status, detail, fields) {
  const defaults = MEASUREMENT_DEFAULTS[status] ?? MEASUREMENT_DEFAULTS.NOT_TESTED;
  const entry = {
    probe_id: id,
    title,
    status,
    detail,
    measurement_started: fields?.measurement_started ?? defaults.measurement_started,
    measurement_completed: fields?.measurement_completed ?? defaults.measurement_completed,
    evidence_complete: fields?.evidence_complete ?? defaults.evidence_complete,
    verdict: status,
    reason_code: fields?.reason_code ?? status,
    evidence_reference: fields?.evidence_reference ?? "evidence/w4-windows-conformance.json",
  };
  const existing = results.findIndex((probe) => probe.probe_id === id);
  if (existing >= 0) results[existing] = entry;
  else results.push(entry);
}

/** خطة المسابر. تُسجَّل NOT_TESTED مسبقًا حتى لا يختفي مسبار لم يُنفَّذ بصمت. */
const PROBE_PLAN = [
  ["W-01", "the path authority reports native Windows semantics"],
  ["W-02", "a reserved device name is refused against the real filesystem"],
  ["W-03", "an alternate data stream is refused"],
  ["W-04", "a trailing dot or space is refused"],
  ["W-05", "an 8.3 short-name form is refused"],
  ["W-06", "containment is case-insensitive, as Windows paths really are"],
  ["W-07", "a directory junction that leaves the root is caught after real resolution"],
  ["W-08", "the walking skeleton completes natively on Windows with real effects"],
  ["W-09", "every tool parameter was declassified before the effect"],
  ["W-10", "an out-of-scope read is denied for the filesystem scope"],
  ["W-11", "Windows HANDLE inheritance regression (X03) with a positive control"],
  ["W-12", "AppContainer + Job Object integration of the real W4 executor"],
];

function planNotTested() {
  for (const [id, title] of PROBE_PLAN) {
    record(id, title, "NOT_TESTED", "the probe was not reached in this run", {
      reason_code: "NOT_REACHED_THIS_RUN",
    });
  }
}

const temporaryWorkspaces = [];

function run(id, title, body) {
  try {
    const outcome = body();
    if (outcome && outcome.skipped) record(id, title, "SKIPPED", outcome.reason, outcome.fields);
    // BLOCKED عائق تقني مُشخَّص. ليس تخطّيًا، وليس نجاحًا، ويمنع W4 من أن تكون PASS.
    else if (outcome && outcome.blocked) record(id, title, "BLOCKED", outcome.reason, outcome.fields);
    // INCONCLUSIVE مسبار لم يثبت صحّته. تسجيله فشلًا أمنيًا ادّعاءُ نتيجة لم تُرصد،
    // وتسجيله نجاحًا كذبٌ صريح. له حالته، وهو يمنع W4 من أن تكون PASS مثل BLOCKED.
    else if (outcome && outcome.inconclusive) record(id, title, "INCONCLUSIVE", outcome.reason, outcome.fields);
    else record(id, title, "PASS", outcome?.detail ?? "ok", outcome?.fields);
  } catch (error) {
    record(id, title, "FAIL", error instanceof Error ? error.message : String(error), error?.fields);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  // الإقلاع أولًا: لا يُدّعى أي شيء عن المطابقة قبل معرفة أين نحن.
  if (REPOSITORY_ROOT === undefined) {
    record(
      "W-00",
      "repository root resolution",
      "FAIL",
      `${BOOTSTRAP_ERROR_CODE}: no candidate resolved to a POLARIS repository. Tried ` +
        RESOLUTION.attempts.map((a) => `${a.source}=${a.status}`).join(", ") +
        ". Pass --root <path> explicitly. This is a runner bootstrap defect, not a conformance failure.",
    );
    emit();
    return;
  }
  if (process.platform !== "win32") {
    record(
      "W-00",
      "platform gate",
      "SKIPPED",
      `this harness only runs on Windows; current platform is ${process.platform}. Repository root resolved to ${REPOSITORY_ROOT}.`,
    );
    emit();
    return;
  }
  if (!existsSync(RUNTIME_DIST)) {
    record(
      "W-00",
      "runtime build present",
      "FAIL",
      `${BOOTSTRAP_ERROR_CODE}: ${RUNTIME_DIST} not found; run npm run build in runtime\\ first. This is a bootstrap defect, not a conformance failure.`,
    );
    emit();
    return;
  }

  // من هنا فصاعدًا كل مسبار في الخطة مسجَّل. ما لا يُنفَّذ يبقى NOT_TESTED ظاهرًا
  // في الدليل بدل أن يختفي، فلا يُقرأ غيابه نجاحًا ولا نظافة.
  planNotTested();

  const runtime = await import(pathToFileURL(RUNTIME_DIST).href);
  const {
    ConfigService,
    HostPathAuthority,
    MountTable,
    PolarisRuntime,
    ProgrammableModel,
    agentCallerIdentity,
    newId,
  } = runtime;

  const workspace = mkdtempSync(join(tmpdir(), "polaris-w4-win-"));
  const outside = mkdtempSync(join(tmpdir(), "polaris-w4-outside-"));
  try {
    mkdirSync(join(workspace, "project"), { recursive: true });
    mkdirSync(join(workspace, "out"), { recursive: true });
    writeFileSync(join(workspace, "project", "README.md"), "# Sample Project\n\n- component: sample\n", "utf8");
    writeFileSync(join(outside, "secret.txt"), "not yours", "utf8");

    // على ويندوز الربط هوية: الفضاء المنطقي هو الفضاء الحقيقي.
    const mounts = MountTable.identity([workspace]);
    const authority = new HostPathAuthority(mounts, "win32");

    run("W-01", "the path authority reports native Windows semantics", () => {
      assert(authority.nativeWindowsSemantics === true, "nativeWindowsSemantics is false on Windows");
      return { detail: "canonicalisation runs with real Windows semantics" };
    });

    run("W-02", "a reserved device name is refused against the real filesystem", () => {
      const result = authority.canonicalize(`${workspace}\\project\\NUL`, { mustExist: false });
      assert(result.ok === false, "NUL was accepted");
      assert(result.failure.rejection === "RESERVED_DEVICE_NAME", `rejected as ${result.failure.rejection}`);
      return { detail: result.failure.rejection };
    });

    run("W-03", "an alternate data stream is refused", () => {
      const result = authority.canonicalize(`${workspace}\\project\\README.md:hidden`, { mustExist: false });
      assert(result.ok === false, "an ADS path was accepted");
      assert(result.failure.rejection === "ALTERNATE_DATA_STREAM", `rejected as ${result.failure.rejection}`);
      return { detail: result.failure.rejection };
    });

    run("W-04", "a trailing dot or space is refused", () => {
      for (const suffix of [".", " "]) {
        const result = authority.canonicalize(`${workspace}\\project\\README.md${suffix}`, { mustExist: false });
        assert(result.ok === false, `a trailing "${suffix}" was accepted`);
        assert(result.failure.rejection === "TRAILING_DOT_OR_SPACE", `rejected as ${result.failure.rejection}`);
      }
      return { detail: "both trailing forms refused" };
    });

    run("W-05", "an 8.3 short-name form is refused", () => {
      const result = authority.canonicalize(`${workspace}\\PROGRA~1\\a.md`, { mustExist: false });
      assert(result.ok === false, "a short name was accepted");
      assert(result.failure.rejection === "SHORT_NAME_FORM", `rejected as ${result.failure.rejection}`);
      return { detail: result.failure.rejection };
    });

    run("W-06", "containment is case-insensitive, as Windows paths really are", () => {
      const result = authority.containedIn(workspace.toUpperCase(), `${workspace.toLowerCase()}\\project\\README.md`, {
        mustExist: true,
      });
      assert(result.ok === true, `case-folded containment failed: ${result.ok ? "" : result.failure.rejection}`);
      return { detail: "case-folded containment holds" };
    });

    run("W-07", "a directory junction that leaves the root is caught after real resolution", () => {
      const link = join(workspace, "project", "linkdir");
      try {
        execFileSync("cmd.exe", ["/c", "mklink", "/J", link, outside], { stdio: "pipe" });
      } catch (error) {
        // اكتشاف هروب نقاط إعادة التحليل ادّعاء أمني حرج. غياب mklink يعني أن
        // القياس لم يقع: BLOCKED، لا تخطٍّ صامت يُقرأ لاحقًا نظافةً.
        return {
          blocked: true,
          reason: `MKLINK_UNAVAILABLE: mklink /J failed: ${error instanceof Error ? error.message : String(error)}`,
          fields: { reason_code: "MKLINK_UNAVAILABLE" },
        };
      }
      const result = authority.containedIn(workspace, `${workspace}\\project\\linkdir\\secret.txt`, { mustExist: true });
      assert(result.ok === false, "a junction escape was NOT caught");
      assert(result.failure.rejection === "SYMLINK_ESCAPE", `caught as ${result.failure.rejection}`);
      return { detail: "junction escape detected as SYMLINK_ESCAPE" };
    });

    const config = new ConfigService();
    const applied = config.apply({
      changeset_id: "w4-windows-conformance",
      origin: "CORE",
      changes: [
        { key: "polaris.filesystem.allowed_read_roots", scope: "USER", value: [workspace] },
        { key: "polaris.filesystem.allowed_write_roots", scope: "USER", value: [`${workspace}\\out`] },
        { key: "polaris.filesystem.allow_write", scope: "USER", value: true },
      ],
    });
    if (!applied.applied) throw new Error("configuration did not apply");

    const source = `${workspace}\\project\\README.md`;
    const target = `${workspace}\\out\\summary.txt`;
    const model = new ProgrammableModel((request) => {
      const done = request.blocks.filter((b) => b.label.startsWith("TOOL RESULT")).length;
      if (done === 0) {
        return JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.read_file", arguments: { path: source } });
      }
      if (done === 1) {
        return JSON.stringify({
          action: "invoke_tool",
          capability_id: "polaris.fs.write_file",
          arguments: { path: target, content: "SUMMARY OF Sample Project\n" },
        });
      }
      return JSON.stringify({ action: "finish", summary: "done" });
    });

    const polaris = new PolarisRuntime({ config, mounts, model, working_directory: workspace });
    const missionId = newId();
    polaris.authorize(missionId, {
      authorized_read_roots: [workspace],
      authorized_write_roots: [`${workspace}\\out`],
    });

    const missionResult = await polaris.runMission({
      mission_id: missionId,
      title: "Windows walking skeleton",
      instruction: "read the README and write a summary",
      correlation_id: newId(),
      agent_id: newId(),
      caller_identity: agentCallerIdentity(),
    });

    run("W-08", "the walking skeleton completes natively on Windows with real effects", () => {
      assert(missionResult.status === "COMPLETED", `mission ${missionResult.termination}: ${JSON.stringify(missionResult.errors)}`);
      assert(existsSync(join(workspace, "out", "summary.txt")), "summary.txt was not created");
      const body = readFileSync(join(workspace, "out", "summary.txt"), "utf8");
      assert(body.startsWith("SUMMARY OF"), "summary content is wrong");
      return { detail: `${String(missionResult.budget.tool_calls)} tool calls, summary written` };
    });

    run("W-09", "every tool parameter was declassified before the effect", () => {
      const steps = missionResult.steps.flatMap((s) => s.declassifications);
      assert(steps.length >= 3, `only ${String(steps.length)} declassification steps`);
      assert(steps.every((s) => s.succeeded), "a declassification failed on the happy path");
      return { detail: `${String(steps.length)} declassifications, all bound to their effect` };
    });

    run("W-10", "an out-of-scope read is denied for the filesystem scope", async () => {
      const denyModel = new ProgrammableModel(() =>
        JSON.stringify({
          action: "invoke_tool",
          capability_id: "polaris.fs.read_file",
          arguments: { path: `${outside}\\secret.txt` },
        }),
      );
      const denyRuntime = new PolarisRuntime({ config, mounts, model: denyModel, working_directory: workspace });
      const denyMission = newId();
      denyRuntime.authorize(denyMission, { authorized_read_roots: [workspace], authorized_write_roots: [] });
      return denyRuntime
        .runMission({
          mission_id: denyMission,
          title: "out of scope",
          instruction: "read the secret",
          correlation_id: newId(),
          agent_id: newId(),
          caller_identity: agentCallerIdentity(),
        })
        .then((outcome) => {
          const step = outcome.steps[outcome.steps.length - 1];
          assert(outcome.termination === "TOOL_DENIED", `terminated as ${outcome.termination}`);
          assert(step.error_layer === "PDP", `denied at ${step.error_layer}`);
          assert(
            (step.reason_codes ?? []).includes("RESOURCE_OUT_OF_SCOPE"),
            `reasons were ${(step.reason_codes ?? []).join(", ")}`,
          );
          return { detail: "denied at PDP with RESOURCE_OUT_OF_SCOPE" };
        });
    });

    // ── W-11 و W-12: محوّل ويندوز الأصلي ────────────────────────────────────
    // لا يُدّعى شيء عن المقابض أو الحصر من منطق لينكس. المحوّل يعمل بواجهات
    // Win32 موثّقة، ويُصدر حكمه بنفسه: PASS أو FAIL أو BLOCKED أو INCONCLUSIVE.

    const adapter = join(REPOSITORY_ROOT, "tools", "w4-windows-adapter", "bin", "polaris-w4-windows-adapter.exe");
    const hostScript = join(REPOSITORY_ROOT, "runtime", "dist", "src", "exec", "host-main.js");
    const runtimeDist = join(REPOSITORY_ROOT, "runtime", "dist");
    const evidenceDirectory = join(REPOSITORY_ROOT, "evidence");

    function runAdapter(mode, extraArgs, reportName) {
      const reportPath = join(evidenceDirectory, reportName);
      const reference = `evidence/${reportName}`;
      if (!existsSync(adapter)) {
        // لم يُبنَ الثنائي: لم يُجرَ أي قياس. مرحلة عائق، وليست نتيجة مسبار.
        return {
          verdict: "BLOCKED",
          blocked_stage: "ADAPTER_BUILD",
          reason_code: "ADAPTER_NOT_BUILT",
          evidence_reference: reference,
          measurement_started: false,
          blocked_reason:
            `the native adapter is not built at ${adapter}. Nothing about handles or confinement was measured. ` +
            `Build it with tools\\w4-windows-adapter\\build.ps1 - the conformance runner does this before the probes.`,
        };
      }
      const result = spawnSync(
        adapter,
        ["--mode", mode, "--report", reportPath, ...extraArgs],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180000 },
      );
      const raw = (result.stdout ?? "").trim();
      let report;
      try {
        report = JSON.parse(raw);
      } catch {
        return {
          verdict: "INCONCLUSIVE",
          verdict_reason: "ADAPTER_PRODUCED_NO_REPORT",
          reason_code: "ADAPTER_PRODUCED_NO_REPORT",
          evidence_reference: reference,
          blocked_reason: `the adapter produced no usable report (exit ${String(result.status)}): ${(result.stderr ?? raw).slice(0, 400)}`,
        };
      }
      report.evidence_reference = reference;

      // القاعدة: عند اختلاف التقرير عن الدليل الخام، الدليل الخام هو المرجع
      // ويُعتبر التقرير معيبًا. هنا التقرير هو المخرج القياسي، والدليل الخام هو
      // الملف الذي كتبه المحوّل. اختلافهما عيب في الأداة، لا نتيجة أمنية.
      try {
        const onDisk = JSON.parse(readFileSync(reportPath, "utf8"));
        report.raw_evidence_verdict = onDisk.verdict ?? null;
        if (onDisk.verdict !== undefined && onDisk.verdict !== report.verdict) {
          return {
            verdict: "INCONCLUSIVE",
            verdict_reason: "REPORT_EVIDENCE_DIVERGENCE",
            reason_code: "REPORT_EVIDENCE_DIVERGENCE",
            evidence_reference: reference,
            blocked_reason:
              `the adapter's standard output says ${String(report.verdict)} while ${reference} says ${String(onDisk.verdict)}. ` +
              `The raw evidence is the reference and the report is defective; no security claim is read from either until they agree.`,
          };
        }
      } catch (error) {
        report.raw_evidence_verdict = null;
        report.raw_evidence_error = error instanceof Error ? error.message : String(error);
      }
      return report;
    }

    /**
     * ترجمة حكم المحوّل إلى حالة مسبار، بلا ترقية ولا تخفيض:
     *   PASS          نجاح مُثبَت.
     *   FAIL          نتيجة أمنية رُصدت فعلًا.
     *   BLOCKED       عائق تقني مُشخَّص بمرحلته. لم يُقَس شيء.
     *   INCONCLUSIVE  المسبار لم يثبت صحّته أو اكتمال قياسه.
     * وأي حكم غائب يبقى INCONCLUSIVE، لا PASS.
     */
    /**
     * الرقم المرافق للعائق يُسمّى بمصدره الحقيقي. خلط رمز خروج الابن برقم خطأ
     * Win32 في تسمية واحدة يجعل "win32 1" يبدو ERROR_INVALID_FUNCTION وهو ليس
     * كذلك. المحوّل يعلن failure_value_source، وهذه الدالة تلتزم به ولا تخمّن.
     */
    function failureValue(report) {
      const source = report.failure_value_source;
      if (source === "CHILD_EXIT_CODE") return ` (child exit code ${String(report.child_exit_code ?? 0)})`;
      if (source === "WIN32_API") return ` (win32 ${String(report.win32_error ?? 0)})`;
      if (source === "NONE") return "";
      // محوّل أقدم من هذا العقد لا يعلن مصدرًا: يُقال ذلك بدل نسبة الرقم لواجهة.
      if (source === undefined) {
        const legacy = report.win32_error ?? 0;
        return legacy === 0 ? "" : ` (unlabelled failure value ${String(legacy)})`;
      }
      return "";
    }

    function classify(report, passDetail) {
      const stage = report.blocked_stage ?? "UNKNOWN_STAGE";
      const why = report.verdict_reason ?? report.blocked_reason ?? report.interpretation ?? "no detail recorded";
      const fields = {
        reason_code: report.reason_code ?? report.verdict_reason ?? stage,
        evidence_reference: report.evidence_reference ?? "evidence/w4-windows-conformance.json",
        measurement_started: report.measurement_started ?? true,
        measurement_completed: report.measurement_completed ?? false,
        evidence_complete: report.evidence_complete ?? false,
      };
      if (report.verdict === "PASS") return { detail: report.interpretation ?? passDetail, fields };
      if (report.verdict === "FAIL") {
        const failure = new Error(`FAIL: ${why}`);
        failure.fields = { ...fields, measurement_completed: true, evidence_complete: true };
        throw failure;
      }
      if (report.verdict === "BLOCKED") {
        return {
          blocked: true,
          reason: `${stage}${failureValue(report)}: ${why}`,
          fields: { ...fields, measurement_completed: false, evidence_complete: false },
        };
      }
      if (report.verdict === "INCONCLUSIVE") return { inconclusive: true, reason: why, fields };
      return { inconclusive: true, reason: `NO_VERDICT: ${why}`, fields: { ...fields, reason_code: "NO_VERDICT" } };
    }

    // الوضع المؤقت لكل تشغيل: مساحة معزولة تُهدم بعد الفحص.
    const x03Workspace = mkdtempSync(join(tmpdir(), "polaris-w4-x03-"));
    const confinedWorkspace = mkdtempSync(join(tmpdir(), "polaris-w4-conf-"));
    temporaryWorkspaces.push(x03Workspace, confinedWorkspace);

    run("W-11", "Windows HANDLE inheritance regression (X03) with a positive control", () => {
      const report = runAdapter(
        "handle-x03",
        ["--workspace", x03Workspace, "--node", process.execPath, "--host-script", hostScript],
        "w4-windows-x03.json",
      );
      return classify(report, "explicit handle list held; the deliberate leak was detected first");
    });

    run("W-12", "AppContainer + Job Object integration of the real W4 executor", () => {
      const report = runAdapter(
        "confined-exec",
        [
          "--workspace", confinedWorkspace,
          "--node", process.execPath,
          "--host-script", hostScript,
          "--runtime-dist", runtimeDist,
        ],
        "w4-windows-confined-exec.json",
      );
      return classify(report, "the W4 executor ran under AppContainer and Job confinement");
    });
  } finally {
    // كل عينة مؤقتة تُهدم: لا يبقى ملف تعريف ولا ACL ولا مجلد بعد التشغيل.
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    for (const directory of temporaryWorkspaces) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        // الهدم مجهود أفضل، ويُذكر تعذّره في المسبار لا يُخفى.
      }
    }
  }

  emit();
}

function emit() {
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIPPED").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  const inconclusive = results.filter((r) => r.status === "INCONCLUSIVE").length;
  const notTested = results.filter((r) => r.status === "NOT_TESTED").length;
  const report = {
    harness: "polaris.w4.windows-conformance",
    harness_version: "1.0.0",
    platform: process.platform,
    node: process.version,
    ran_at: new Date().toISOString(),
    repository_root: REPOSITORY_ROOT ?? null,
    repository_root_resolution: RESOLUTION.attempts,
    executed_natively_on_windows: process.platform === "win32",
    summary: { passed, failed, skipped, blocked, inconclusive, not_tested: notTested, total: results.length },
    verdict_classification: VERDICT_CLASSIFICATION,
    verdict_rules: [
      "a missing binary, adapter or prerequisite before the measurement starts is BLOCKED, never FAIL",
      "a failed positive control is INCONCLUSIVE, never PASS and never FAIL for the targeted security claim",
      "a proven leak or escape is FAIL",
      "BLOCKED, INCONCLUSIVE and NOT_TESTED are never promoted to PASS",
      "W1 or Linux/POSIX evidence never substitutes for a Windows measurement required by W4",
      "where the report and the raw evidence disagree, the raw evidence is the reference and the report is defective",
      "a final W4 PASS requires no FAIL, no BLOCKED, no INCONCLUSIVE and no security-critical NOT_TESTED",
    ],
    probes: results,
    provenance: NATIVE_RUN
      ? "POLARIS_W4_NATIVE_RUN: produced by tools/w4-windows-conformance/run.ps1"
      : "AD_HOC: produced outside the conformance runner; not the canonical native evidence",
  };
  const base = REPOSITORY_ROOT ?? process.cwd();
  // اسم الملف القانوني محجوز لتشغيل ويندوز أصلي وقع فعلًا، أطلقه المشغّل نفسه.
  //
  // العيب الذي يغلقه هذا الشرط: اختبار داخل حزمة runtime كان يشغّل هذا الملف
  // بجذر المستودع الحقيقي، فيكتب فوق الدليل القانوني بنتائج مسابر جرت خارج
  // المشغّل — قبل بناء المحوّل الأصلي. فبدا وكأن المسابر الأمنية فشلت، بينما لم
  // يُقَس شيء أصلًا. الدليل القانوني لا يكتبه إلا المشغّل، وأي تشغيل آخر يكتب
  // باسمه الخاص.
  const name = !NATIVE_RUN
    ? "w4-windows-conformance.adhoc.json"
    : process.platform === "win32"
      ? "w4-windows-conformance.json"
      : "w4-windows-conformance.local-dryrun.json";
  const target = join(base, "evidence", name);
  mkdirSync(join(base, "evidence"), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report.summary)}\n`);
  for (const probe of results) process.stdout.write(`${probe.status.padEnd(8)} ${probe.probe_id} ${probe.title}\n`);
  // فشل أو عائق أو حكم غير حاسم أو مسبار لم يُجرَ: أربعتها تمنع النجاح. لا يخرج
  // المشغّل بصفر إلا إذا لم يقع أيٌّ منها. ولا تُرقّى أيٌّ منها إلى PASS.
  process.exitCode = failed > 0 || blocked > 0 || inconclusive > 0 || notTested > 0 ? 1 : 0;
}

await main();
