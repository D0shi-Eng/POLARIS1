// أدوات W6. طبقة رقيقة فوق أدوات W4 و W5، ولا تستنسخ منطقًا من أي منهما.
//
// قاعدة W6: ما يُقاس هو المسار المُركَّب نفسه. لذلك لا يوجد هنا بديل عن مكوّن
// إنتاجي واحد — لا بوابة، ولا سياسة، ولا نقطة فرض، ولا مُصدِر موافقة، ولا دفتر.
// كل ما هنا قراءة على ما وقع، أو نموذج حتمي، أو طرف مالك — وكلاهما يقع حيث
// سيقع المزوّد والواجهة في المنتج: خارج مسار النموذج.

import { verifyChain } from "../src/audit/ledger/verify.js";
import { ScriptedModel } from "../src/model/fixture-model.js";
import type { MissionResult } from "../src/agent/types.js";
import type { CompletionProof } from "../src/proof/types.js";
import type { PolarisRuntime } from "../src/runtime.js";
import type { Doc } from "../src/policy/types.js";
import { makeWorkspace, startMission, type Workspace } from "./w4-helpers.js";
import { buildW5Runtime, readThenWriteThenFinish, requireArtefact } from "./w5-helpers.js";

export {
  buildW5Runtime as buildDogfoodRuntime,
  ownerAnswers,
  readThenWriteThenFinish,
  requireArtefact,
  writeThenFinish,
} from "./w5-helpers.js";
export { makeWorkspace, startMission, writeWorkspaceFile } from "./w4-helpers.js";
export type { Workspace } from "./w4-helpers.js";

/** أحداث سلسلة الارتباط، بالترتيب الذي سُجّلت به. */
export function missionEvents(runtime: PolarisRuntime, correlationId: string): readonly Doc[] {
  return runtime.audit.forCorrelation(correlationId);
}

/** أنواع الأحداث وحدها. تُستعمل حيث يكون الادعاء عن وجود قوس، لا عن محتواه. */
export function eventTypes(events: readonly Doc[]): readonly string[] {
  return events.map((event) => String(event["event_type"]));
}

/** الدفتر يتحقق، ولا سجل مرفوض. الاثنان معًا شرط واحد لا شرطان. */
export function ledgerIsSound(runtime: PolarisRuntime): { readonly ok: boolean; readonly detail: string } {
  const rejected = runtime.audit.rejected();
  if (rejected.length > 0) return { ok: false, detail: `rejected records: ${JSON.stringify(rejected)}` };
  const chain = verifyChain(runtime.audit.chain.records(), { expected_ledger_id: runtime.audit.chain.ledgerId });
  return chain.ok ? { ok: true, detail: "" } : { ok: false, detail: JSON.stringify(chain.defects) };
}

/** لا أثر شبكي في أي حدث. الفحص على الآثار المُعلنة، لا على نصّ الحدث. */
export function networkEffects(events: readonly Doc[]): readonly string[] {
  const found: string[] = [];
  for (const event of events) {
    for (const effect of (event["effects"] ?? []) as readonly Doc[]) {
      const action = String(effect["action"]);
      if (action.startsWith("network.")) found.push(action);
    }
  }
  return found;
}

/** وسوم التلوّث المسجَّلة على كل اقتراح وصل البوابة. */
export function proposalTaints(events: readonly Doc[]): readonly string[] {
  return events
    .filter((event) => event["event_type"] === "CAPABILITY_PROPOSED")
    .map((event) => String((event["metadata"] as Record<string, string> | undefined)?.["taint_labels"] ?? ""));
}

/** القدرات التي اقتُرحت فعلًا على البوابة، بأسمائها. */
export function proposedCapabilities(events: readonly Doc[]): readonly string[] {
  return events
    .filter((event) => event["event_type"] === "CAPABILITY_PROPOSED")
    .map((event) => String((event["metadata"] as Record<string, string> | undefined)?.["proposed_capability"] ?? ""));
}

/**
 * كل نجاح في السلسلة يعود سببيًا إلى بداية المهمة.
 *
 * منقولة كما هي من سيناريوهات W5 عمدًا: التعريف الذي يُقاس به الإغلاق السببي
 * يجب أن يكون واحدًا في W5 و W6، وإلا صار «مغلق» يعني شيئين.
 */
export function causalChainIsClosed(events: readonly Doc[], correlationId: string): boolean {
  const byId = new Map(events.map((event) => [String(event["event_id"]), event]));
  const known = new Set<string>([
    ...events.map((event) => String(event["event_id"])),
    ...events.filter((event) => event["event_type"] === "MISSION_STARTED").map((event) => String(event["mission_id"])),
    ...events.map((event) => String(event["invocation_id"])).filter((value) => value !== "undefined"),
    ...events.map((event) => String(event["decision_id"])).filter((value) => value !== "undefined"),
  ]);
  return events
    .filter(
      (event) =>
        ["EXECUTION_GRANT_ISSUED", "APPROVAL_GRANTED", "COMPLETION_PROOF_CREATED"].includes(
          String(event["event_type"]),
        ) && String(event["correlation_id"]) === correlationId,
    )
    .every((event) => {
      const cause = event["causation_id"];
      if (cause === undefined) return true;
      return known.has(String(cause)) || byId.has(String(cause));
    });
}

/** محتوى الأثر في المسار السليم. قيمة واحدة يقرأها القياس ويكتبها المنفّذ. */
export const DOGFOOD_SUMMARY = "summary of the sample project";

export interface DogfoodRun {
  readonly workspace: Workspace;
  readonly runtime: PolarisRuntime;
  readonly result: MissionResult;
  readonly proof: CompletionProof;
  readonly correlationId: string;
  readonly target: string;
  /** أحداث المهمة وحدها — قبل أن يضيف الإثبات رصدَه المؤكِّد إلى السلسلة. */
  readonly missionOnlyEvents: readonly Doc[];
}

/**
 * تشغيل كامل واحد: مساحة عمل جديدة، وقت تشغيل جديد، مهمة واحدة، ثم إثبات.
 *
 * المتطلب يُعلَن هنا — عند جذر الاستدعاء — لا في مقترح النموذج. لو أعلنه النموذج
 * لصار الإثبات تحصيل حاصل: يثبت ما ادّعاه صاحبه.
 *
 * ولقطة أحداث المهمة تُؤخذ قبل الإثبات عمدًا: الرصد المؤكِّد يمرّ بالبوابة نفسها
 * ويُصدر منحته، فخلطه بأحداث المهمة يجعل عدّ المنح يقول شيئًا غير الذي يعنيه.
 */
export async function dogfoodRun(): Promise<DogfoodRun> {
  const workspace = makeWorkspace();
  const readme = workspace.path("project", "README.md");
  const target = workspace.path("out", "summary.txt");
  const { runtime } = buildW5Runtime({
    workspace,
    writeRoots: [workspace.path("out")],
    model: new ScriptedModel(readThenWriteThenFinish(readme, target, DOGFOOD_SUMMARY) as string[]),
  });
  const mission = startMission(runtime, {
    title: "read README and create summary.txt",
    instruction: "Read the project README and write a short summary next to it.",
    authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
  });
  const result = await runtime.runMission(mission);
  const missionOnlyEvents = [...runtime.audit.forCorrelation(mission.correlation_id)];
  const proof = await runtime.prove(requireArtefact(mission.mission_id, target), mission);
  return { workspace, runtime, result, proof, correlationId: mission.correlation_id, target, missionOnlyEvents };
}

/** نموذج يقترح قدرة واحدة ثم ينهي. أقصر نص كافٍ لسيناريو أثر واحد. */
export function proposeThenFinish(capability: string, args: Record<string, unknown>): readonly string[] {
  return [
    JSON.stringify({ action: "invoke_tool", capability_id: capability, arguments: args }),
    JSON.stringify({ action: "finish", summary: "done" }),
  ];
}
