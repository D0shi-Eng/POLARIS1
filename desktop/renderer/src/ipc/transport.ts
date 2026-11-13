// النقل: الوصلة الوحيدة بالإطار.
//
// هذه هي الدرزة التي يقول ADR-018 إنها وحدها ما يلمسه تغيير المضيف. كل ما فوقها
// يتكلّم `IPCEnvelopeV1` ولا يعرف Tauri. ولذلك يبقى الملف بهذا الحجم: واجهة،
// وتطبيق واحد، ومهلة.

export interface SendOptions {
  /** مهلة هذا الطلب وحده. استدعاء نموذج أطول بطبيعته من قراءة إعداد. */
  readonly timeoutMs?: number;
}

export interface Transport {
  /** يرسل ظرف طلب ويعيد ظرف الرد كما هو، دون تفسير. */
  send(envelope: unknown, options?: SendOptions): Promise<unknown>;
}

/** يُرفع عندما لا يصل ردّ خلال المهلة. لا يحمل تفصيلًا عن الداخل. */
export class TransportTimeout extends Error {
  constructor(public readonly timeoutMs: number) {
    super("transport timed out");
    this.name = "TransportTimeout";
  }
}

/** يُرفع عندما لا يوجد نقل أصلًا: التطبيق يعمل خارج المضيف الأصلي. */
export class TransportUnavailable extends Error {
  constructor() {
    super("no native transport");
    this.name = "TransportUnavailable";
  }
}

/** يلفّ أي نقل بمهلة. رسالة بلا ردّ ليست حالة انتظار أبدي بل خطأ مصنَّف. */
export function withTimeout(transport: Transport, defaultTimeoutMs: number): Transport {
  return {
    async send(envelope: unknown, options?: SendOptions): Promise<unknown> {
      const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          transport.send(envelope, options),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new TransportTimeout(timeoutMs)), timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}

/** نقل غائب. يجعل «لا مضيف» حالة صريحة بدل استثناء غامض من الإطار. */
export const absentTransport: Transport = {
  send(): Promise<unknown> {
    return Promise.reject(new TransportUnavailable());
  },
};
