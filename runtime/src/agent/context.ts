// بناء السياق المحدود.
//
// انضباط مقصود: كل مقطع له سقف، والمجموع له سقف، والتقصير يُعلَن في النص نفسه
// بدل أن يختفي بصمت. لا يوجد هنا ذكاء سياق؛ قصّ بسيط وحدود واضحة.

import type { ContextBlock } from "../model/model-port.js";
import type { IngressRecord } from "../trust/ingress.js";

export interface ContextLimits {
  readonly max_block_bytes: number;
  readonly max_total_bytes: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  max_block_bytes: 16384,
  max_total_bytes: 49152,
};

export interface ContextSource {
  readonly label: string;
  readonly body: string;
  readonly ingress: IngressRecord;
}

function truncate(body: string, limit: number): string {
  const bytes = Buffer.from(body, "utf8");
  if (bytes.byteLength <= limit) return body;
  return `${bytes.subarray(0, limit).toString("utf8")}\n[TRUNCATED by POLARIS: ${String(bytes.byteLength - limit)} bytes withheld]`;
}

/**
 * يبني المقاطع بترتيب الأحدث أولًا بعد المهمة، ويتوقف عند بلوغ السقف الكلي.
 * سلطة التعليمات تُنقل من سجل المدخل مباشرة: لا يستطيع مقطع أن يرفع سلطته بنفسه.
 */
export function buildBlocks(sources: readonly ContextSource[], limits: ContextLimits = DEFAULT_CONTEXT_LIMITS): readonly ContextBlock[] {
  const blocks: ContextBlock[] = [];
  let total = 0;
  for (const source of sources) {
    const body = truncate(source.body, limits.max_block_bytes);
    const size = Buffer.byteLength(body, "utf8");
    if (total + size > limits.max_total_bytes) {
      blocks.push({
        label: source.label,
        body: `[OMITTED by POLARIS: context ceiling reached before this block]`,
        authoritative: source.ingress.instruction_authority === "USER",
      });
      continue;
    }
    total += size;
    blocks.push({ label: source.label, body, authoritative: source.ingress.instruction_authority === "USER" });
  }
  return blocks;
}
