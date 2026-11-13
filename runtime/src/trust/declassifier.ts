// خدمة رفع التصنيف. هي المالك الوحيد للدفتر: لا أحد غيرها يصدر سجلًا.
//
// قرار بنيوي مهم: المراسي ومخططات الاستخراج لا تأتي من المستدعي.
// الوكيل يطلب رفع تصنيف قيمة لغرض، ولا يقدّم المرساة ولا المخطط.
// لو قدّمهما لَكان بإمكانه أن يخترع مرساة أو يخترع مخططًا متساهلًا،
// فيصير رفع التصنيف تحصيل حاصل. التسجيل يقع في جذر التركيب، خارج الوكيل.
//
// حدود أخرى مقصودة:
//   - لا تسمح بتنفيذ. تغيّر بيانات الثقة فقط، و PDP هو من يقرر.
//   - لا تلغي التلوث الأصلي؛ تسجّله داخل السجل.
//   - كل محاولة تُسجَّل، ناجحة كانت أو فاشلة، حتى يكون قياس العبء حقيقيًا.

import type { PathAuthority } from "../platform/path-authority.js";
import { runD1, type ExtractionSchema } from "./d1.js";
import { runD2, type TrustAnchor } from "./d2.js";
import { DeclassificationLedger, type DeclassificationReader } from "./ledger.js";
import type {
  DeclassificationAttempt,
  DeclassificationMethod,
  DeclassificationPurpose,
  DeclassificationScope,
} from "./record.js";
import type { TaintLabel } from "./taint.js";

export interface DeclassificationAttemptLog {
  readonly method: DeclassificationMethod;
  readonly correlation_id: string;
  readonly mission_id: string;
  readonly purpose_action: string;
  readonly succeeded: boolean;
  readonly failure_code?: string;
  readonly record_id?: string;
}

export interface DeclassifierDependencies {
  readonly path_authority: PathAuthority;
}

/** ما يستطيع المستدعي طلبه: قيمة، وغرض، وأصل. لا مرساة ولا مخطط. */
export interface ExtractionRequest {
  readonly correlation_id: string;
  readonly mission_id: string;
  readonly content: string;
  /** معرّف مخطط مسجَّل مسبقًا. مخطط غير مسجَّل يفشل الطلب. */
  readonly schema_id: string;
  readonly purpose: DeclassificationPurpose;
  readonly scope: DeclassificationScope;
  readonly input_taint: readonly TaintLabel[];
  readonly input_provenance: readonly string[];
}

export interface ProvenanceRequest {
  readonly correlation_id: string;
  readonly mission_id: string;
  readonly candidate: string;
  readonly purpose: DeclassificationPurpose;
  readonly scope: DeclassificationScope;
  readonly input_taint: readonly TaintLabel[];
  readonly input_provenance: readonly string[];
}

/**
 * المنفذ الضيّق الذي يُسلَّم لطبقة الوكيل: طلب رفع تصنيف فقط.
 * تسجيل المراسي والمخططات وإصدار السجلات كلها خارج هذا المنفذ عمدًا،
 * فلا يستطيع الوكيل أن يسجّل مرساة تثبت ما يريد ثم يستشهد بها.
 */
export interface DeclassificationRequestPort {
  byExtraction(request: ExtractionRequest): DeclassificationAttempt;
  byProvenance(request: ProvenanceRequest): DeclassificationAttempt;
}

export class DeclassifierService implements DeclassificationRequestPort {
  readonly #ledger = new DeclassificationLedger();
  readonly #attempts: DeclassificationAttemptLog[] = [];
  readonly #anchors = new Map<string, TrustAnchor[]>();
  readonly #schemas = new Map<string, ExtractionSchema>();
  readonly #pathAuthority: PathAuthority;

  public constructor(dependencies: DeclassifierDependencies) {
    this.#pathAuthority = dependencies.path_authority;
  }

  /** يُستدعى من جذر التركيب عند بدء المهمة، لا من الوكيل. */
  public registerAnchors(missionId: string, anchors: readonly TrustAnchor[]): void {
    this.#anchors.set(missionId, [...anchors]);
  }

  /** يُستدعى من جذر التركيب. مخطط الاستخراج جزء من تعريف النظام، لا من مقترح النموذج. */
  public registerExtractionSchema(schema: ExtractionSchema): void {
    this.#schemas.set(schema.schema_id, schema);
  }

  public anchorsFor(missionId: string): readonly TrustAnchor[] {
    return this.#anchors.get(missionId) ?? [];
  }

  /** D1: استخراج مقيّد بمخطط مسجَّل من محتوى غير موثوق. */
  public byExtraction(request: ExtractionRequest): DeclassificationAttempt {
    const schema = this.#schemas.get(request.schema_id);
    if (schema === undefined) {
      return this.#log(
        { ok: false, failure: { method: "D1", code: "SCHEMA_MISMATCH", detail: `no registered schema ${request.schema_id}` } },
        "D1",
        request.correlation_id,
        request.mission_id,
        request.purpose.action,
      );
    }
    const attempt = runD1({
      correlation_id: request.correlation_id,
      mission_id: request.mission_id,
      content: request.content,
      schema,
      purpose: request.purpose,
      scope: request.scope,
      input_taint: request.input_taint,
      input_provenance: request.input_provenance,
    });
    return this.#log(attempt, "D1", request.correlation_id, request.mission_id, request.purpose.action);
  }

  /** D2: مطابقة أصل بمراسٍ مسجَّلة للمهمة. سلطة المسارات تُحقن هنا. */
  public byProvenance(request: ProvenanceRequest): DeclassificationAttempt {
    const attempt = runD2({
      correlation_id: request.correlation_id,
      mission_id: request.mission_id,
      candidate: request.candidate,
      anchors: this.anchorsFor(request.mission_id),
      purpose: request.purpose,
      scope: request.scope,
      input_taint: request.input_taint,
      input_provenance: request.input_provenance,
      path_authority: this.#pathAuthority,
    });
    return this.#log(attempt, "D2", request.correlation_id, request.mission_id, request.purpose.action);
  }

  /** العرض الذي يُسلَّم إلى PDP: بحث فقط، بلا إصدار. */
  public reader(): DeclassificationReader {
    return this.#ledger.reader();
  }

  public attempts(): readonly DeclassificationAttemptLog[] {
    return this.#attempts;
  }

  #log(
    attempt: DeclassificationAttempt,
    method: DeclassificationMethod,
    correlationId: string,
    missionId: string,
    purposeAction: string,
  ): DeclassificationAttempt {
    if (attempt.ok) {
      this.#ledger.issue(attempt.record);
      this.#attempts.push({
        method,
        correlation_id: correlationId,
        mission_id: missionId,
        purpose_action: purposeAction,
        succeeded: true,
        record_id: attempt.record.record_id,
      });
      return attempt;
    }
    this.#attempts.push({
      method,
      correlation_id: correlationId,
      mission_id: missionId,
      purpose_action: purposeAction,
      succeeded: false,
      failure_code: attempt.failure.code,
    });
    return attempt;
  }
}
