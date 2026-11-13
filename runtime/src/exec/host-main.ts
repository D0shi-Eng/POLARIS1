// نقطة دخول عملية التنفيذ. عملية منفصلة عمدًا:
//   - بيئة مبنية صراحة، لا موروثة.
//   - مجاري قياسية فقط، بلا أي مقبض إضافي.
//   - لا تعرف شيئًا عن الاستدعاء ولا القرار ولا الإعدادات.
//
// حدّ صريح: هذه ليست حاوية AppContainer. لا يوجد منع شبكة على مستوى النظام هنا.
// ما يلي تخفيف حقيقي لكنه ليس حصرًا، ويُذكر بهذه الصفة في التقرير.

import { executeGrant } from "./fs-executor.js";
import type { ExecutionGrant } from "../pep/grant.js";

function disableAmbientNetworkSurfaces(): void {
  const surfaces = ["fetch", "WebSocket", "XMLHttpRequest", "EventSource"];
  for (const name of surfaces) {
    try {
      Object.defineProperty(globalThis, name, {
        value: undefined,
        configurable: false,
        writable: false,
      });
    } catch {
      // إن تعذّر الحجب يبقى السطح موجودًا. لا يُدّعى منع لم يقع.
    }
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  disableAmbientNetworkSurfaces();
  const raw = await readStdin();
  let grant: ExecutionGrant;
  try {
    grant = JSON.parse(raw) as ExecutionGrant;
  } catch {
    process.stdout.write(JSON.stringify({ status: "FAILED", error: { code: "MALFORMED_GRANT", detail: "grant is not JSON" } }));
    return;
  }
  const outcome = executeGrant(grant);
  process.stdout.write(JSON.stringify(outcome));
}

void main().catch((error: unknown) => {
  process.stdout.write(
    JSON.stringify({
      status: "FAILED",
      error: { code: "IO_ERROR", detail: error instanceof Error ? error.message : "execution host failed" },
    }),
  );
});
