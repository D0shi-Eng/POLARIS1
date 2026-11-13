// معاينة التصميم: العارض الحقيقي (AppRoot والشاشات والأنماط) فوق بدائل الاختبار. كل عملية تُوجَّه
// إلى بديل مرحلتها؛ وكل القدرات متاحة كي تُرى كل الشاشات. للمطوّر فقط، لا يُشحن.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppRoot } from "../src/app/AppRoot";
import { DesktopIpcClient } from "../src/ipc/client";
import { PHASE02_OPERATIONS, PHASE03_OPERATIONS, PHASE04_OPERATIONS, PHASE05_OPERATIONS, PHASE06_OPERATIONS, PHASE08_OPERATIONS } from "../src/ipc/operations";
import { Phase02Client } from "../src/ipc/p02-client";
import { Phase03Client } from "../src/ipc/p03-client";
import { Phase04Client } from "../src/ipc/p04-client";
import { Phase05Client } from "../src/ipc/p05-client";
import { Phase06Client } from "../src/ipc/p06-client";
import { Phase08Client } from "../src/ipc/p08-client";
import type { Transport } from "../src/ipc/transport";
import { IDENTITY } from "../tests/support/fake-host";
import { fakePhase02Host } from "../tests/support/fake-p02-host";
import { fakePhase04Host } from "../tests/support/fake-p04-host";
import { fakePhase05Host } from "../tests/support/fake-p05-host";
import { fakePhase06Host } from "../tests/support/fake-p06-host";
import { fakePhase08Host } from "../tests/support/fake-p08-host";
// ملف تنسيق واحد (وُحِّد من سبعة في 2026-10-01؛ tools/css/consolidate.mjs).
import "../src/ui/polaris.css";

const p08 = fakePhase08Host().transport;
const p02 = fakePhase02Host().transport;
// عمليات المزوّدين الأربع (ADR-037) مسجّلة في Phase-08، ومالكها مضيف Phase-02.
const PROVIDER_CATALOG = ["provider.catalog", "provider.credential.put", "provider.custom.save", "provider.custom.delete"].map((operation) => ({ operation }));
const routes: Array<[readonly { operation?: string; name?: string }[], Transport]> = [
  [PROVIDER_CATALOG, p02],
  [PHASE08_OPERATIONS as never, p08],
  [PHASE06_OPERATIONS as never, fakePhase06Host().transport],
  [PHASE05_OPERATIONS as never, fakePhase05Host({ missionFinished: true }).transport],
  [PHASE04_OPERATIONS as never, fakePhase04Host().transport],
  [PHASE03_OPERATIONS as never, p08],
  [PHASE02_OPERATIONS as never, p02],
];
// ?lang=ar و?theme=DARK|LIGHT تُغيّر ما يقوله الإقلاع، كي تُرى الواجهة باللغتين والسمتين.
const query = new URLSearchParams(globalThis.location.search);
const lang = query.get("lang") === "ar" ? "ar" : "en";
const theme = query.get("theme") ?? "SYSTEM";
const SAMPLE_ANSWER = [
  "## Architecture summary",
  "",
  "The selected project context describes a **local-first** desktop app with three layers:",
  "",
  "1. The renderer shows host facts and sends typed requests only.",
  "2. The host owns execution, storage and the tool gateway.",
  "3. Agents propose; policy and approvals decide.",
  "",
  "| Constraint | Where it is enforced |",
  "|---|---|",
  "| No execution from the window | IPC registry |",
  "| Every tool call is checked | Tool gateway |",
  "| Network needs a human | Approval binding |",
  "",
  "- [x] Read the context",
  "- [x] Identify three constraints",
].join(String.fromCharCode(10));
const nameOf = (r: { operation?: string; name?: string }) => r.operation ?? r.name ?? "";

const transport: Transport = {
  async send(envelope, options) {
    const op = String((envelope as Record<string, unknown>)["operation"]);
    const owner = routes.find(([ops]) => ops.some((r) => nameOf(r) === op))?.[1] ?? p08;
    const answer = (await owner.send(envelope, options)) as Record<string, unknown>;
    if (op === "desktop.bootstrap") {
      const result = answer["result"] as Record<string, unknown>;
      return { ...answer, result: { ...result, locale: lang, direction: lang === "ar" ? "RTL" : "LTR", appearance: theme } };
    }
    // المعاينة وحدها: جواب Markdown نموذجي للمهمّة المكتملة، كي يُرى عرض الجواب كما يحفظه المضيف الآن
    if (op === "mission.get" && query.get("sample") !== "0") {
      const result = answer["result"] as { mission: Record<string, unknown> } | undefined;
      if (result !== undefined && result.mission["state"] === "COMPLETED" && result.mission["result_summary"] === undefined) {
        result.mission["result_summary"] = SAMPLE_ANSWER;
        result.mission["started_at"] = "2026-09-18T03:00:00Z";
        result.mission["completed_at"] = "2026-09-18T03:01:16Z";
      }
    }
    // المعاينة وحدها: المحادثة بجواب نموذجي، أو حيّةً (?live=1) لرؤية «يعمل منذ…» والسرد و«يفكّر».
    if (op === "conversation.get") {
      const conv = (answer["result"] as { conversation: { turns: Record<string, unknown>[]; thinking: boolean } }).conversation;
      const turn = conv.turns[0];
      if (turn !== undefined && query.get("live") === "1") {
        turn["state"] = "RUNNING";
        turn["started_at"] = new Date(Date.now() - 17_000).toISOString();
        delete turn["completed_at"];
        delete turn["answer"];
        conv.thinking = true;
      } else if (turn !== undefined && query.get("sample") !== "0") {
        turn["answer"] = SAMPLE_ANSWER;
        turn["started_at"] = "2026-09-18T03:00:00Z";
        turn["completed_at"] = "2026-09-18T03:00:22Z";
      }
    }
    if (op === "desktop.capability.availability") {
      const result = answer["result"] as { capabilities: { capability_id: string }[] };
      return { ...answer, result: { capabilities: result.capabilities.map((c) => ({ capability_id: c.capability_id, availability: { state: "AVAILABLE" } })) } };
    }
    return answer;
  },
};

const client = new DesktopIpcClient({ transport, identity: IDENTITY });
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <AppRoot
      client={client}
      phase02={new Phase02Client({ transport, identity: IDENTITY })}
      phase03={new Phase03Client({ transport, identity: IDENTITY })}
      phase04={new Phase04Client({ transport, identity: IDENTITY })}
      phase05={new Phase05Client({ transport, identity: IDENTITY })}
      phase06={new Phase06Client({ transport, identity: IDENTITY })}
      phase08={new Phase08Client({ transport, identity: IDENTITY })}
    />
  </StrictMode>,
);
