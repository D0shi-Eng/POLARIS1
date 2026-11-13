// دفتر المنح المُصدَرة.
//
// منحة صدرت ولم تُستهلك بعد هي سلطة معلّقة. إيقاف الطوارئ يجب أن يبطلها،
// وإلا بقي في النظام إذنٌ يصلح لإحداث أثر بعد الإيقاف.
//
// الدفتر لا يعرف ما تفعله المنحة، ولا يقرأ هدفها. يعرف معرّفها وحالتها.

import { nowTimestamp } from "../ids.js";

export type GrantState = "ISSUED" | "CONSUMED" | "INVALIDATED";

export interface GrantEntry {
  readonly grant_id: string;
  readonly correlation_id: string;
  readonly invocation_id: string;
  readonly state: GrantState;
  readonly updated_at: string;
}

export class IssuedGrantLedger {
  readonly #entries = new Map<string, GrantEntry>();

  public issued(grantId: string, correlationId: string, invocationId: string): void {
    this.#entries.set(grantId, {
      grant_id: grantId,
      correlation_id: correlationId,
      invocation_id: invocationId,
      state: "ISSUED",
      updated_at: nowTimestamp(),
    });
  }

  public consumed(grantId: string): void {
    this.#settle(grantId, "CONSUMED");
  }

  public state(grantId: string): GrantState | undefined {
    return this.#entries.get(grantId)?.state;
  }

  /** يبطل كل منحة صدرت ولم تُستهلك. يعيد ما أُبطل، للدليل. */
  public invalidateOutstanding(): readonly string[] {
    const invalidated: string[] = [];
    for (const [id, entry] of this.#entries) {
      if (entry.state === "ISSUED") {
        this.#entries.set(id, { ...entry, state: "INVALIDATED", updated_at: nowTimestamp() });
        invalidated.push(id);
      }
    }
    return invalidated;
  }

  public outstanding(): readonly GrantEntry[] {
    return [...this.#entries.values()].filter((e) => e.state === "ISSUED");
  }

  public all(): readonly GrantEntry[] {
    return [...this.#entries.values()];
  }

  #settle(grantId: string, state: GrantState): void {
    const entry = this.#entries.get(grantId);
    if (entry === undefined) return;
    this.#entries.set(grantId, { ...entry, state, updated_at: nowTimestamp() });
  }
}
