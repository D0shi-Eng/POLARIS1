// بوابة القبول.
//
// حدٌّ ضيّق جدًا عمدًا: سؤال واحد بجواب مغلق. كل طبقة تستطيع أن تسأله قبل أن
// تبدأ عملًا، دون أن تعرف شيئًا عن آلة الحالة ولا عن السجل ولا عن الإنهاء.
//
// وجود الحدّ هو ما يجعل «لا عمل جديد بعد الإيقاف» قابلًا للفرض في أكثر من
// موضع بلا تكرار منطق: المهمة، والاستدعاء، وإصدار المنحة، وإطلاق العملية.

import { W5ErrorCode, failWith, succeed, w4Error, type Attempt } from "../errors.js";
import type { PanicStopMachine } from "./panic-stop.js";

/** ما يُطلب القبول من أجله. يظهر في السبب الداخلي فيصير الرفض قابلًا للإسناد. */
export type AdmissionSubject = "MISSION" | "INVOCATION" | "EXECUTION_GRANT" | "PROCESS_LAUNCH";

export interface ExecutionAdmission {
  /** هل يُقبل عمل جديد الآن. الرفض دائمًا مُسمّى، ولا يوجد رفض بلا سبب. */
  admit(subject: AdmissionSubject): Attempt<void>;
  admits(): boolean;
}

export class PanicStopAdmission implements ExecutionAdmission {
  readonly #machine: PanicStopMachine;

  public constructor(machine: PanicStopMachine) {
    this.#machine = machine;
  }

  public admits(): boolean {
    return this.#machine.admits();
  }

  public admit(subject: AdmissionSubject): Attempt<void> {
    const state = this.#machine.state();
    if (state === "RUNNING") return succeed(undefined);
    return failWith(
      w4Error(
        state === "STOPPED" ? W5ErrorCode.EXECUTION_REFUSED_WHILE_STOPPED : W5ErrorCode.PANIC_STOP_IN_PROGRESS,
        "PANIC_STOP",
        "POLARIS is stopped. Nothing new will run until it is resumed.",
        `${subject} refused while the system is ${state}`,
      ),
    );
  }
}

/** بوابة تقبل دائمًا. للتركيبات التي لا يُركَّب فيها إيقاف طوارئ. */
export class AlwaysAdmit implements ExecutionAdmission {
  public admits(): boolean {
    return true;
  }

  public admit(): Attempt<void> {
    return succeed(undefined);
  }
}
