// أدوات الحوكمة: الموافقة وإيقاف الطوارئ.
//
// مجموعة في وحدة واحدة لأنها تتشارك عمرًا واحدًا وترتيب تركيب واحدًا، وليست
// جزءًا من سلسلة الأثر (مهمة → قرار → منحة → أثر) بل حاكمة عليها.
//
// جذر التركيب هو المكان الوحيد الذي يُنشأ فيه هذا الكائن. الوكيل لا يستطيع
// الوصول إليه: لا يستورده، ولا يُمرَّر إليه، ولا يظهر في أي نوع يراه.

import type { AuditEmitter } from "./audit/emitter.js";
import { ApprovalCoordinator } from "./approval/coordinator.js";
import { OwnerControlledApprovalSurface } from "./approval/local-surface.js";
import type { ConfigService } from "./config/service.js";
import { PanicStopAdmission } from "./control/admission.js";
import { OwnedExecutionRegistry } from "./control/execution-registry.js";
import { IssuedGrantLedger } from "./control/grant-ledger.js";
import { PanicStopMachine } from "./control/panic-stop.js";
import { PanicStopController } from "./control/stop-controller.js";
import type { PathAuthority } from "./platform/path-authority.js";
import type { Doc } from "./policy/types.js";

export interface GovernanceControlsOptions {
  readonly audit: AuditEmitter;
  readonly config: ConfigService;
  readonly path_authority: PathAuthority;
  readonly core_actor_id: string;
  readonly system_identity: Doc;
  readonly termination_timeout_ms?: number;
}

export class GovernanceControls {
  public readonly panicStop: PanicStopMachine;
  public readonly admission: PanicStopAdmission;
  public readonly executions: OwnedExecutionRegistry;
  public readonly grants: IssuedGrantLedger;
  public readonly approvalSurface: OwnerControlledApprovalSurface;
  public readonly approval: ApprovalCoordinator;
  public readonly stop: PanicStopController;

  public constructor(options: GovernanceControlsOptions) {
    this.panicStop = new PanicStopMachine();
    this.admission = new PanicStopAdmission(this.panicStop);
    this.executions = new OwnedExecutionRegistry();
    this.grants = new IssuedGrantLedger();
    this.approvalSurface = new OwnerControlledApprovalSurface();
    this.approval = new ApprovalCoordinator({
      surface: this.approvalSurface,
      path_authority: options.path_authority,
      config: options.config,
      audit: options.audit,
      core_actor_id: options.core_actor_id,
    });
    this.stop = new PanicStopController({
      machine: this.panicStop,
      executions: this.executions,
      grants: this.grants,
      approvals: this.approval.registry,
      surface: this.approvalSurface,
      audit: options.audit,
      core_actor_id: options.core_actor_id,
      system_identity: options.system_identity,
      ...(options.termination_timeout_ms === undefined
        ? {}
        : { termination_timeout_ms: options.termination_timeout_ms }),
    });
  }
}
