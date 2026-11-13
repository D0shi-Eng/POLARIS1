// مُطلِق عملية التنفيذ.
//
// نظافة الإطلاق هنا هي جوهر انحدار X03 من W1:
//   - stdio ثلاثة أنابيب صريحة، ولا شيء غيرها. لا مقبض خارج النطاق يُورَّث.
//   - البيئة تُبنى مفتاحًا مفتاحًا، ولا تُورَّث.
//   - shell معطّل، فلا مفسّر وسيط يعيد تفسير الوسائط.
//   - مهلة صلبة وقتل عند تجاوزها، فلا عملية تنفيذ معلّقة إلى الأبد.
//   - سقف على حجم المخرجات، فلا يُستهلك المُطلِق بردّ ضخم.
//
// ما لا يُدّعى: هذه ليست AppContainer، ولا Job Object، ولا منعًا شبكيًا على مستوى
// النظام. حصر ويندوز الحقيقي هو محوّل منفصل، ويُثبَت بتشغيل أصلي على ويندوز.

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { newId } from "../ids.js";
import type { ExecutionAdmission } from "../control/admission.js";
import { childProcessHandle, type OwnedExecutionRegistry } from "../control/execution-registry.js";
import type { ExecutionHost } from "./execution-host.js";
import type { ExecutionGrant, ExecutionOutcome, HandleProbe, HostDiagnostics } from "./grant.js";

const HOST_ENTRY = fileURLToPath(new URL("../exec/host-main.js", import.meta.url));

/** أقصى ما يُقبل من العملية المنفِّذة على مجرى الخرج. */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

function unknownDiagnostics(): HostDiagnostics {
  return {
    environment_keys: [],
    environment_findings: [],
    environment_contract_present: false,
    environment_exactly_as_constructed: false,
    network_globals_present: [],
    working_directory: "",
  };
}

function unknownProbe(): HandleProbe {
  return {
    supported: false,
    platform: process.platform,
    method: "NONE",
    filesystem_descriptors: [],
    other_descriptors: [],
    open_descriptor_count: 0,
  };
}

/**
 * أسماء المتغيرات التي تنسخها libuv من بيئة العملية الأب إلى الابن على ويندوز
 * إذا لم تجدها في البيئة الممرَّرة (`required_vars` في `src/win/process.c`).
 *
 * هذه هي جذر عيب التسرب الذي رصده تشغيل ويندوز الحقيقي: مرّرنا بيئة صريحة،
 * ومع ذلك ظهرت في الابن ثمانية متغيرات لم نمررها. الدليل حاسم: المتغيرات
 * الثلاثة التي مرّرناها (SystemRoot، windir، SystemDrive) لم تُنسخ، والثمانية
 * التي لم نمررها نُسخت. النسخ إذن مشروط بالغياب.
 *
 * العلاج ليس حذفها بعد وصولها، بل ملء كل اسم منها بقيمة يبنيها POLARIS،
 * فلا تجد libuv اسمًا غائبًا تنسخه أصلًا.
 */
export const LIBUV_REQUIRED_WINDOWS_VARIABLES: readonly string[] = [
  "HOMEDRIVE",
  "HOMEPATH",
  "LOGONSERVER",
  "PATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
];

/** قيمة نائبة صريحة. غير فارغة عمدًا حتى يكون وجود الاسم مؤكدًا. */
const PLACEHOLDER = "POLARIS_UNSET";

/**
 * المتغيرات الوحيدة التي تُنقل بقيمتها الحقيقية من النظام، ولكل واحد سبب تقني:
 * محمّل ويندوز و ntdll يقرآن هذه المسارات لتحميل مكتبات النظام. بدونها لا تُقلع
 * العملية أصلًا. كل ما عداها يُبنى، ولا يُورَّث.
 */
const WINDOWS_LOADER_VARIABLES: readonly string[] = ["SystemRoot", "windir", "SystemDrive"];

function loaderValue(name: string): string | undefined {
  // القراءة من بيئة الأب هنا نقلٌ صريح لقيمة نظام مطلوبة، لا وراثة ضمنية:
  // الاسم مذكور في قائمة مغلقة، والسبب موثّق، والنتيجة تظهر في عقد البيئة.
  const direct = process.env[name];
  if (direct !== undefined && direct.length > 0) return direct;
  const upper = process.env[name.toUpperCase()];
  return upper !== undefined && upper.length > 0 ? upper : undefined;
}

/**
 * مسار PATH أدنى وحتمي. المنفّذ يُطلَق بمسار مطلق، فلا حاجة إلى مسار المستخدم،
 * وتمريره كاملًا يعني تسريب خريطة أدواته إلى داخل الحصر.
 */
function minimalPath(): string {
  if (process.platform !== "win32") return "/usr/bin:/bin";
  const root = loaderValue("SystemRoot") ?? "C:\\Windows";
  return `${root}\\System32;${root}`;
}

export interface ConstructedEnvironment {
  readonly variables: Readonly<Record<string, string>>;
  /** الأسماء التي حملت قيمة نظام حقيقية، ولماذا. دليل لا وصف. */
  readonly system_values: readonly string[];
}

/**
 * يبني بيئة الابن من قائمة سماح صريحة. لا يوجد في هذه الدالة أي دمج مع
 * process.env، ولا نسخ جماعي، ولا انتشار افتراضي.
 */
export function buildExecutionEnvironment(temporaryDirectory: string): ConstructedEnvironment {
  const variables: Record<string, string> = {
    POLARIS_EXECUTION_HOST: "1",
    // هوية مبنية، لا هوية المستخدم.
    USERNAME: "polaris-execution-host",
    USERDOMAIN: "POLARIS",
    LOGONSERVER: PLACEHOLDER,
    // كل ما يشبه "الوطن" يشير إلى مساحة يملكها POLARIS، لا إلى ملف المستخدم.
    USERPROFILE: temporaryDirectory,
    TEMP: temporaryDirectory,
    TMP: temporaryDirectory,
    PATH: minimalPath(),
  };

  if (process.platform === "win32") {
    const drive = /^([A-Za-z]:)/.exec(temporaryDirectory);
    variables["HOMEDRIVE"] = drive === null ? PLACEHOLDER : (drive[1] as string);
    variables["HOMEPATH"] = drive === null ? temporaryDirectory : temporaryDirectory.slice(2);
  } else {
    variables["HOMEDRIVE"] = PLACEHOLDER;
    variables["HOMEPATH"] = temporaryDirectory;
  }

  const systemValues: string[] = [];
  for (const name of WINDOWS_LOADER_VARIABLES) {
    const value = loaderValue(name);
    if (value !== undefined) {
      variables[name] = value;
      systemValues.push(name);
    } else if (process.platform === "win32") {
      variables[name] = PLACEHOLDER;
    }
  }

  // الحارس الأخير: كل اسم تنسخه libuv عند الغياب يجب أن يكون حاضرًا هنا.
  // غيابه يعني عودة التسرب، فيُملأ بنائب بدل أن يُترك للنسخ.
  for (const required of LIBUV_REQUIRED_WINDOWS_VARIABLES) {
    const present = Object.keys(variables).some((name) => name.toUpperCase() === required);
    if (!present) variables[required] = PLACEHOLDER;
  }

  return { variables, system_values: systemValues };
}

export interface ChildExecutionHostOptions {
  /** مجلد العمل للعملية المنفِّذة. يُضبط على مجلد محايد لا علاقة له بالمنحة. */
  readonly workingDirectory: string;
  /** هامش فوق مهلة المنحة، لإتاحة الإقلاع والردّ قبل القتل. */
  readonly startupGraceMs?: number;
  /**
   * مجلد مؤقت يملكه POLARIS. يُشار إليه من TEMP و TMP و USERPROFILE، فلا يقع
   * الابن على مسار مشتق من ملف المستخدم بالوراثة. الافتراضي مجلد باسم POLARIS
   * تحت جذر النظام المؤقت، معلوم المنشأ ويُنشأ عند الحاجة.
   */
  readonly temporaryDirectory?: string;
  /**
   * سجل التنفيذات المملوكة. كل عملية يطلقها هذا المُطلِق تُسجَّل فيه لحظة
   * إطلاقها وتُرفع منه عند انتهائها. هذا هو مصدر الملكية الوحيد الذي يعرفه
   * إيقاف الطوارئ: بدون تسجيل لا توجد ملكية، وبلا ملكية لا يُنهى شيء.
   */
  readonly registry?: OwnedExecutionRegistry;
  /** بوابة القبول. رفضها يمنع الإطلاق أصلًا، فلا تولد عملية ثم تُقتل. */
  readonly admission?: ExecutionAdmission;
}

export class ChildProcessExecutionHost implements ExecutionHost {
  public readonly id = "polaris.exec.child-process.v1";
  /** false صراحةً: لا يوجد حصر ويندوز في هذا المحوّل. */
  public readonly windowsConfinement = false;

  readonly #workingDirectory: string;
  readonly #grace: number;
  readonly #temporaryDirectory: string;
  readonly #environment: ConstructedEnvironment;
  readonly #registry: OwnedExecutionRegistry | undefined;
  readonly #admission: ExecutionAdmission | undefined;

  public constructor(options: ChildExecutionHostOptions) {
    this.#workingDirectory = options.workingDirectory;
    this.#grace = options.startupGraceMs ?? 5000;
    this.#registry = options.registry;
    this.#admission = options.admission;
    this.#temporaryDirectory = options.temporaryDirectory ?? join(tmpdir(), "polaris-execution-host");
    // المسار يُعلَن ولا يُنشأ. الغرض الأمني هو ألا يرث الابن TEMP المشتق من ملف
    // المستخدم، وذلك يتحقق بالإعلان وحده. وإنشاء المجلد هنا يعني أن يلمس
    // المُطلِق نظام الملفات، وهو حدّ معماري لا داعي لكسره: لا شيء في W4 يكتب
    // في TEMP، وأي حاجة مستقبلية إليه تُنشئه في موضعها بصوت عالٍ لا بصمت.
    this.#environment = buildExecutionEnvironment(this.#temporaryDirectory);
  }

  /** عقد البيئة: ما بناه POLARIS بالضبط. يُمرَّر إلى الابن ليقارن به نفسه. */
  public environmentContract(): Readonly<Record<string, string>> {
    return this.#environment.variables;
  }

  public async execute(grant: ExecutionGrant): Promise<ExecutionOutcome> {
    // الحارس الأخير قبل أن تولد عملية. رفض القبول هنا يعني ألا يوجد ابن أصلًا،
    // وهو أقوى من إطلاقه ثم إنهائه: ما لم يوجد لا يحتاج إنهاءً.
    const admitted = this.#admission?.admit("PROCESS_LAUNCH");
    if (admitted !== undefined && !admitted.ok) {
      return {
        status: "FAILED",
        grant_id: grant.grant_id,
        bytes: 0,
        truncated: false,
        handle_probe: unknownProbe(),
        host_diagnostics: unknownDiagnostics(),
        error: { code: "REFUSED_WHILE_STOPPED", detail: admitted.error.internal_detail },
      };
    }

    return new Promise<ExecutionOutcome>((resolve) => {
      const child = spawn(process.execPath, [HOST_ENTRY], {
        cwd: this.#workingDirectory,
        // بيئة مبنية بالكامل من قائمة سماح. لا دمج، ولا انتشار من process.env.
        env: this.#environment.variables,
        // ثلاثة أنابيب صريحة فقط. أي مقبض إضافي هنا هو بالضبط عيب X03.
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        detached: false,
        windowsHide: true,
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let received = 0;
      let settled = false;

      // التسجيل فور الإطلاق، لا بعد نجاح شيء: عملية وُلدت ولم تُسجَّل هي بالضبط
      // العملية التي ينجو منها إيقاف الطوارئ.
      const executionId = newId();
      if (this.#registry !== undefined && typeof child.pid === "number") {
        this.#registry.register(
          childProcessHandle({
            execution_id: executionId,
            pid: child.pid,
            grant_id: grant.grant_id,
            kill: (signal) => child.kill(signal),
            hasExited: () => child.exitCode !== null || child.signalCode !== null,
          }),
        );
      }

      const finish = (outcome: ExecutionOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#registry?.unregister(executionId);
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({
          status: "FAILED",
          grant_id: grant.grant_id,
          bytes: 0,
          truncated: false,
          handle_probe: unknownProbe(),
          host_diagnostics: unknownDiagnostics(),
          error: { code: "IO_ERROR", detail: "execution host exceeded its deadline and was killed" },
        });
      }, grant.deadline_ms + this.#grace);

      child.stdout.on("data", (chunk: Buffer) => {
        received += chunk.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
          child.kill("SIGKILL");
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk);
      });

      child.on("error", (error) => {
        finish({
          status: "FAILED",
          grant_id: grant.grant_id,
          bytes: 0,
          truncated: false,
          handle_probe: unknownProbe(),
          host_diagnostics: unknownDiagnostics(),
          error: { code: "IO_ERROR", detail: `execution host could not start: ${error.message}` },
        });
      });

      child.on("close", () => {
        const raw = Buffer.concat(stdout).toString("utf8");
        try {
          const parsed = JSON.parse(raw) as ExecutionOutcome;
          finish({ ...parsed, grant_id: grant.grant_id });
        } catch {
          finish({
            status: "FAILED",
            grant_id: grant.grant_id,
            bytes: 0,
            truncated: false,
            handle_probe: unknownProbe(),
            host_diagnostics: unknownDiagnostics(),
            error: {
              code: "IO_ERROR",
              detail: `execution host returned no usable result: ${Buffer.concat(stderr).toString("utf8").slice(0, 256)}`,
            },
          });
        }
      });

      // عقد البيئة يسافر مع المنحة، فيستطيع المنفّذ أن يصنّف ما وصله بالقيمة
      // لا بالاسم: متغيّر بالاسم الصحيح وقيمة أخرى وراثةٌ لا بناء.
      child.stdin.end(JSON.stringify({ ...grant, environment_contract: this.#environment.variables }));
    });
  }
}
