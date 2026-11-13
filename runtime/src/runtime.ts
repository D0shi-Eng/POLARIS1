// جذر التركيب. المكان الوحيد الذي تُربط فيه الطبقات ببعضها.
//
// أهمية هذا الملف أمنية لا تنظيمية فقط: المراسي ومخططات الاستخراج تُسجَّل هنا،
// خارج الوكيل. لو سجّلها الوكيل لَاستطاع أن يخترع مرساة تثبت ما يريد.

import { ConfigService } from "./config/service.js";
import { AuditEmitter } from "./audit/emitter.js";
import { GovernanceControls } from "./controls.js";
import { CapabilityGateway } from "./gateway/gateway.js";
import { newId, nowTimestamp } from "./ids.js";
import { CompletionProver } from "./proof/prover.js";
import { GatewayConfinedObserver, systemObserverIdentity } from "./proof/gateway-observer.js";
import type { CompletionProof, CompletionRequirement } from "./proof/types.js";
import { ChildProcessExecutionHost } from "./pep/child-execution-host.js";
import type { ExecutionHost } from "./pep/execution-host.js";
import { FilesystemPep } from "./pep/filesystem-pep.js";
import { HostPathAuthority } from "./platform/host-path-authority.js";
import { MountTable } from "./platform/mount-table.js";
import type { PathAuthority } from "./platform/path-authority.js";
import { LocalPdp } from "./policy/pdp.js";
import type { Doc } from "./policy/types.js";
import { DeclassifierService } from "./trust/declassifier.js";
import type { TrustAnchor } from "./trust/d2.js";
import type { ExtractionSchema } from "./trust/d1.js";
import { AgentLoop } from "./agent/loop.js";
import { BudgetLedger, DEFAULT_BUDGET, type SafetyBudget } from "./agent/budget.js";
import type { Mission, MissionResult } from "./agent/types.js";
import type { ModelPort } from "./model/model-port.js";

/** ما صرّح به المستخدم لهذه المهمة. مصدره فعل مستخدم، لا اقتراح نموذج. */
export interface MissionAuthorization {
  readonly authorized_read_roots: readonly string[];
  readonly authorized_write_roots: readonly string[];
  readonly user_supplied_values?: readonly string[];
}

export interface PolarisRuntimeOptions {
  readonly config: ConfigService;
  readonly mounts: MountTable;
  readonly model: ModelPort;
  readonly working_directory: string;
  readonly budget?: SafetyBudget;
  readonly platform?: NodeJS.Platform;
  /** محوّل تنفيذ بديل. الافتراضي عملية منفصلة بمقابض ومجاري صريحة. */
  readonly execution_host?: ExecutionHost;
  readonly extraction_schemas?: readonly ExtractionSchema[];
  /** مهلة انتظار موت التنفيذ المملوك عند إيقاف الطوارئ. */
  readonly termination_timeout_ms?: number;
}

export class PolarisRuntime {
  public readonly config: ConfigService;
  public readonly audit = new AuditEmitter();
  public readonly pathAuthority: PathAuthority;
  public readonly declassifier: DeclassifierService;
  public readonly pdp: LocalPdp;
  public readonly pep: FilesystemPep;
  public readonly gateway: CapabilityGateway;
  public readonly loop: AgentLoop;
  public readonly executionHost: ExecutionHost;
  /** الحوكمة: الموافقة وإيقاف الطوارئ. حاكمة على السلسلة، وليست حلقة فيها. */
  public readonly controls: GovernanceControls;
  public readonly prover: CompletionProver;

  readonly #coreActorId = newId();
  readonly #systemIdentity = systemObserverIdentity();

  public constructor(options: PolarisRuntimeOptions) {
    this.config = options.config;
    this.pathAuthority = new HostPathAuthority(options.mounts, options.platform ?? process.platform);
    this.declassifier = new DeclassifierService({ path_authority: this.pathAuthority });
    for (const schema of options.extraction_schemas ?? []) this.declassifier.registerExtractionSchema(schema);

    // PDP يقرأ الدفتر قراءةً فقط. لا يستطيع أحد حقن سجل عبر مستند الاستدعاء.
    this.pdp = new LocalPdp(this.config, { declassification: this.declassifier.reader() });

    // الحوكمة تُبنى قبل مسار الأثر، لأن كل حلقة فيه تسأل بوابة القبول.
    this.controls = new GovernanceControls({
      audit: this.audit,
      config: this.config,
      path_authority: this.pathAuthority,
      core_actor_id: this.#coreActorId,
      system_identity: this.#systemIdentity,
      ...(options.termination_timeout_ms === undefined
        ? {}
        : { termination_timeout_ms: options.termination_timeout_ms }),
    });

    this.executionHost =
      options.execution_host ??
      new ChildProcessExecutionHost({
        workingDirectory: options.working_directory,
        registry: this.controls.executions,
        admission: this.controls.admission,
      });
    this.pep = new FilesystemPep({
      path_authority: this.pathAuthority,
      execution_host: this.executionHost,
      config: this.config,
      approval: { issuer: this.controls.approval.issuer, registry: this.controls.approval.registry },
      admission: this.controls.admission,
      grants: this.controls.grants,
      audit: this.audit,
      core_actor_id: this.#coreActorId,
    });
    this.gateway = new CapabilityGateway({
      pdp: this.pdp,
      filesystem_pep: this.pep,
      audit: this.audit,
      config: this.config,
      core_actor_id: this.#coreActorId,
      approval: this.controls.approval,
      admission: this.controls.admission,
    });
    this.prover = new CompletionProver({
      path_authority: this.pathAuthority,
      config: this.config,
      audit: this.audit,
      core_actor_id: this.#coreActorId,
    });
    this.loop = new AgentLoop({
      model: options.model,
      gateway: this.gateway,
      declassifier: this.declassifier,
      audit: this.audit,
      ...(options.budget === undefined ? {} : { budget: options.budget }),
    });
  }

  /**
   * يبني المراسي من تصريح المستخدم ومن حالة النظام، ويسجّلها للمهمة.
   * كل مرساة مربوطة بأغراضها: جذر قراءة لا يثبت شيئًا لأثر كتابة.
   */
  public authorize(missionId: string, authorization: MissionAuthorization): readonly TrustAnchor[] {
    const at = nowTimestamp();
    const anchors: TrustAnchor[] = [];
    if (authorization.authorized_read_roots.length > 0) {
      anchors.push({
        anchor_id: newId(),
        kind: "USER_AUTHORIZED_FS_ROOT",
        value_kind: "FILESYSTEM_PATH",
        values: [...authorization.authorized_read_roots],
        established_by: "USER_ACTION",
        established_at: at,
        purpose_actions: ["read.filesystem"],
      });
    }
    if (authorization.authorized_write_roots.length > 0) {
      anchors.push({
        anchor_id: newId(),
        kind: "USER_AUTHORIZED_FS_ROOT",
        value_kind: "FILESYSTEM_PATH",
        values: [...authorization.authorized_write_roots],
        established_by: "USER_ACTION",
        established_at: at,
        purpose_actions: ["write.filesystem", "create.filesystem"],
      });
    }
    if (authorization.user_supplied_values !== undefined && authorization.user_supplied_values.length > 0) {
      anchors.push({
        anchor_id: newId(),
        kind: "DIRECT_USER_VALUE",
        value_kind: "FILESYSTEM_PATH",
        values: [...authorization.user_supplied_values],
        established_by: "USER_ACTION",
        established_at: at,
      });
    }
    // حالة نظام مملوكة لـPOLARIS: قائمة وجهات الخروج المصرّح بها في الإعدادات.
    const destinations = (this.config.get("polaris.network.brokered_egress.allowed_destinations") ??
      []) as readonly string[];
    if (destinations.length > 0) {
      anchors.push({
        anchor_id: newId(),
        kind: "POLARIS_SYSTEM_STATE",
        value_kind: "NETWORK_DESTINATION",
        values: [...destinations],
        established_by: "SYSTEM_STATE",
        established_at: at,
      });
    }
    this.declassifier.registerAnchors(missionId, anchors);
    return anchors;
  }

  /**
   * يشغّل مهمة. القبول يُسأل هنا أولًا: مهمة جديدة بعد الإيقاف لا تبدأ أصلًا،
   * فلا تُستشار نماذج ولا تُبنى سياقات لعمل لن يقع.
   */
  public async runMission(mission: Mission): Promise<MissionResult> {
    const admitted = this.controls.admission.admit("MISSION");
    if (!admitted.ok) {
      return {
        mission_id: mission.mission_id,
        correlation_id: mission.correlation_id,
        status: "TERMINATED",
        termination: "TOOL_DENIED",
        steps: [],
        // ميزانية لم تُصرف: المهمة لم تبدأ أصلًا. اللقطة تُؤخذ من الدفتر نفسه
        // حتى لا يوجد شكل ثانٍ للميزانية ينجرف عن الأول.
        budget: new BudgetLedger(DEFAULT_BUDGET).snapshot(),
        errors: [admitted.error],
      };
    }
    return this.loop.run(mission);
  }

  /**
   * يُثبِت متطلبًا قابلًا للرصد. المتطلب يُعلَن هنا لا في مقترح النموذج.
   *
   * الرصد المؤكِّد يمر بالبوابة نفسها: قراءة محصورة مُصرَّح بها ومسجَّلة،
   * لا استدعاء نظام ملفات خام.
   */
  public prove(
    requirement: CompletionRequirement,
    mission: { readonly correlation_id: string; readonly agent_id: string; readonly caller_identity: Doc },
  ): Promise<CompletionProof> {
    const prover = new CompletionProver({
      path_authority: this.pathAuthority,
      config: this.config,
      audit: this.audit,
      core_actor_id: this.#coreActorId,
      observer: new GatewayConfinedObserver({
        gateway: this.gateway,
        correlation_id: mission.correlation_id,
        mission_id: requirement.mission_id,
        agent_id: mission.agent_id,
      }),
    });
    return prover.prove({
      requirement,
      correlation_id: mission.correlation_id,
      caller_identity: mission.caller_identity,
    });
  }

  /** إيقاف الطوارئ. لا يمر بالنموذج ولا بالوكيل ولا بالشبكة. */
  public panicStop(reason: string): ReturnType<GovernanceControls["stop"]["stop"]> {
    return this.controls.stop.stop(reason);
  }

  /** استئناف بفعل مالك صريح. لا يوجد مسار آخر يستدعيه. */
  public resume(): boolean {
    return this.controls.stop.resume();
  }
}

/** هوية مستدعٍ صالحة لوكيل يعمل نيابةً عن مستخدم. */
export function agentCallerIdentity(userId: string = newId(), sessionId: string = newId()): Doc {
  return {
    caller_type: "AGENT",
    principal_id: newId(),
    trust_tier: "TIER_1_LIMITED",
    session_id: sessionId,
    on_behalf_of: { caller_type: "USER", principal_id: userId },
  };
}

/** جدول ربط للمضيف الحالي: على ويندوز هوية، وعلى غيره ربط صريح لجذر اختبار حقيقي. */
export function mountTableFor(
  logicalRoot: string,
  hostRoot: string,
  platform: NodeJS.Platform = process.platform,
): MountTable {
  return platform === "win32"
    ? MountTable.identity([logicalRoot])
    : new MountTable([{ logical_root: logicalRoot, host_root: hostRoot }], "/");
}
