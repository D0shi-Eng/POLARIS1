// سجل التنفيذات المملوكة.
//
// الملكية صريحة: لا يدخل هذا السجل إلا ما أطلقه POLARIS بنفسه وسجّله لحظة
// إطلاقه. إيقاف الطوارئ لا يعرف طريقًا آخر إلى عملية، فلا يستطيع أن يمس ما
// لا يملكه.
//
// ما ليس ملكية: اسم العملية. قتل بالاسم يقتل عمليات المستخدم التي تصادف أن
// تحمل نفس الاسم، وهو ممنوع في POLARIS ويحرسه اختبار يفحص الشجرة كلها.
//
// هذا الملف لا يستورد node:child_process ولا يستطيع إطلاق شيء: هو يحمل مقابض
// أعطاه إياها المُطلِق، ويستدعي ما فيها. الإطلاق يبقى في وحدة واحدة.

import { nowTimestamp } from "../ids.js";

export type OwnedExecutionKind = "CHILD_PROCESS" | "WINDOWS_JOB" | "CONTROLLED_FIXTURE";

export interface OwnedExecutionHandle {
  readonly execution_id: string;
  readonly kind: OwnedExecutionKind;
  /** معرّف العملية إن وُجد. تشخيصي في الدليل، وليس هو الهوية. */
  readonly pid?: number;
  /** المنحة التي أطلقت هذا التنفيذ، إن كان تنفيذ أثر. */
  readonly grant_id?: string;
  isAlive(): boolean;
  terminate(): void;
}

export interface RegisteredExecution {
  readonly handle: OwnedExecutionHandle;
  readonly registered_at: string;
}

export class OwnedExecutionRegistry {
  readonly #entries = new Map<string, RegisteredExecution>();

  public register(handle: OwnedExecutionHandle): void {
    this.#entries.set(handle.execution_id, { handle, registered_at: nowTimestamp() });
  }

  /** يُستدعى عند انتهاء التنفيذ طبيعيًا. لا يقتل شيئًا؛ يرفع القيد فقط. */
  public unregister(executionId: string): void {
    this.#entries.delete(executionId);
  }

  public all(): readonly RegisteredExecution[] {
    return [...this.#entries.values()];
  }

  public count(): number {
    return this.#entries.size;
  }

  /** ما زال حيًّا فعلًا، بسؤال المقبض لا بالافتراض. */
  public live(): readonly OwnedExecutionHandle[] {
    return this.all()
      .map((e) => e.handle)
      .filter((h) => h.isAlive());
  }
}

/**
 * مقبض عملية ابنة. يُبنى في المُطلِق ويُمرَّر إلى السجل.
 *
 * isAlive يسأل النظام عن العملية بإشارة صفرية — لا يستورد شيئًا ولا يُطلق
 * شيئًا. الخطأ ESRCH يعني ماتت، وEPERM يعني حيّة ولا نملك إشارتها.
 */
export function childProcessHandle(input: {
  readonly execution_id: string;
  readonly pid: number;
  readonly grant_id?: string;
  readonly kill: (signal: NodeJS.Signals) => void;
  readonly hasExited: () => boolean;
}): OwnedExecutionHandle {
  return {
    execution_id: input.execution_id,
    kind: "CHILD_PROCESS",
    pid: input.pid,
    ...(input.grant_id === undefined ? {} : { grant_id: input.grant_id }),
    isAlive(): boolean {
      if (input.hasExited()) return false;
      try {
        process.kill(input.pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
      }
    },
    terminate(): void {
      try {
        input.kill("SIGKILL");
      } catch {
        // العملية ماتت بالفعل، أو لا نملك إشارتها. الحكم يقع على isAlive بعد الإنهاء.
      }
    },
  };
}
