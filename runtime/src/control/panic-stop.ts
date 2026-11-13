// آلة حالة إيقاف الطوارئ.
//
// ثلاث حالات فقط، وانتقالات صريحة لا غير:
//   RUNNING → STOPPING   بطلب إيقاف
//   STOPPING → STOPPED   بعد إنهاء مُثبَت وتحقق من عدم وجود ناجين
//   STOPPED → RUNNING    بفعل مالك صريح
//
// ما لا يوجد في هذا الملف عمدًا: مؤقّت، وإعادة محاولة، ومسار يعود إلى RUNNING
// من تلقاء نفسه. «لا استئناف ضمني» ليس قاعدة موصوفة بل غياب شيفرة تُنفّذها.
//
// ولا يستورد هذا الملف نموذجًا ولا مزوّدًا ولا شبكة ولا نوعًا من طبقة الوكيل.
// استقلال الإيقاف عن النموذج مُثبَت ببنية الوحدات، لا بالنية.

export type PanicStopState = "RUNNING" | "STOPPING" | "STOPPED";

export interface StateTransition {
  readonly from: PanicStopState;
  readonly to: PanicStopState;
  readonly at: string;
}

export class PanicStopMachine {
  #state: PanicStopState = "RUNNING";
  readonly #transitions: StateTransition[] = [];

  public state(): PanicStopState {
    return this.#state;
  }

  /** هل يُقبل عمل جديد. RUNNING وحدها تقبل. */
  public admits(): boolean {
    return this.#state === "RUNNING";
  }

  public transitions(): readonly StateTransition[] {
    return [...this.#transitions];
  }

  /** RUNNING → STOPPING. طلب ثانٍ أثناء الإيقاف لا يعيد الحالة ولا يكرّر العمل. */
  public beginStop(at: string): boolean {
    return this.#move("RUNNING", "STOPPING", at);
  }

  /** STOPPING → STOPPED. لا تُستدعى إلا بعد إنهاء مُثبَت وصفر ناجين. */
  public completeStop(at: string): boolean {
    return this.#move("STOPPING", "STOPPED", at);
  }

  /** STOPPED → RUNNING. فعل مالك صريح، ولا مصدر آخر له. */
  public resume(at: string): boolean {
    return this.#move("STOPPED", "RUNNING", at);
  }

  #move(from: PanicStopState, to: PanicStopState, at: string): boolean {
    if (this.#state !== from) return false;
    this.#state = to;
    this.#transitions.push({ from, to, at });
    return true;
  }
}

