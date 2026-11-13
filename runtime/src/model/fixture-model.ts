// نموذج اختبار حتمي. الغرض واحد: أن تكون صحة W4 قابلة للإثبات وإعادة الإنتاج
// بلا مزوّد خارجي ولا مفتاح ولا شبكة. صلاحية W4 لا تتوقف على نموذج مدفوع.

import type { ModelPort, ModelRawOutput, ModelRequest } from "./model-port.js";

/** يعيد نصوصًا مكتوبة مسبقًا بالترتيب. آخر نص يتكرر إذا نفدت القائمة. */
export class ScriptedModel implements ModelPort {
  public readonly id: string;
  public readonly deterministic = true;

  readonly #script: readonly string[];
  #cursor = 0;

  public constructor(script: readonly string[], id = "polaris.fixture.scripted") {
    if (script.length === 0) throw new Error("scripted model needs at least one line");
    this.#script = script;
    this.id = id;
  }

  public complete(_request: ModelRequest): Promise<ModelRawOutput> {
    const index = Math.min(this.#cursor, this.#script.length - 1);
    this.#cursor += 1;
    return Promise.resolve({ model_id: this.id, revision: "fixture", raw: this.#script[index] as string });
  }

  public consumed(): number {
    return this.#cursor;
  }
}

/**
 * نموذج حتمي مُبرمَج بدالة خالصة من الطلب إلى النص.
 * يسمح ببناء سيناريو يعتمد على نتائج الأدوات السابقة دون أي عشوائية.
 */
export class ProgrammableModel implements ModelPort {
  public readonly id: string;
  public readonly deterministic = true;

  readonly #respond: (request: ModelRequest) => string;

  public constructor(respond: (request: ModelRequest) => string, id = "polaris.fixture.programmable") {
    this.#respond = respond;
    this.id = id;
  }

  public complete(request: ModelRequest): Promise<ModelRawOutput> {
    return Promise.resolve({ model_id: this.id, revision: "fixture", raw: this.#respond(request) });
  }
}
