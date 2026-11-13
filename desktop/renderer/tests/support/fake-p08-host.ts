// بديل اختبار لعمليات Phase-08 (وما يلزم من Phase-04)، في الذاكرة، فوق بديل Phase-03.
//
// يثبت سلوك العارض لا المضيف: التنفيذ والصندوق والمتصفّح الحقيقي تُختبر بـ`cargo test`
// وبالتشغيل الأصلي. المقيس هنا أن الشاشات تعرض ما قاله المضيف كما قاله، وأن ما يرسله العارض
// محصور في العمليات الموجَّهة بحمولاتها المغلقة (كل طلب يمرّ بمحقّق العقد قبل إرساله).

import type { Transport } from "../../src/ipc/transport";
import { fakePhase03Host, P03_IDS } from "./fake-p03-host";

const NOW = "2026-09-25T00:00:00Z";
const SESSION = "7a5a2c22-1cbb-4a41-9a8f-7b1c2d3e4f50";
const PRINCIPAL = "1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60";
const MISSION = P03_IDS.MISSION;
const ATTACHMENT = "a8a8a8a8-a8a8-4a8a-8a8a-a8a8a8a8a8a8";
const ARTIFACT = "b8b8b8b8-b8b8-4b8b-8b8b-b8b8b8b8b8b8";
const SCHEDULE = "c8c8c8c8-c8c8-4c8c-8c8c-c8c8c8c8c8c8";
const RUN = "d8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d8";
const APPROVAL = "e8e8e8e8-e8e8-4e8e-8e8e-e8e8e8e8e8e8";
const INVOCATION = "f8f8f8f8-f8f8-4f8f-8f8f-f8f8f8f8f8f8";
const DIGEST = "a".repeat(64);
/** صفحة HTML تحاول تشغيل نصّ برمجي. تُعرض في إطار معزول بلا نصوص. */
export const HOSTILE_HTML = "<h1>Site</h1><script>window.parent.postMessage('escaped','*')</script>";

type Json = Record<string, unknown>;

export interface FakePhase08Log {
  readonly operations: string[];
  readonly payloads: Json[];
}

export interface FakePhase08Options {
  readonly pendingApproval?: boolean;
  /** جدول محفوظ مسبقًا، وتشغيل «شغّل الآن» يُسجَّل بعد أربع قراءات للقائمة كما يفعل المضيف حين تنتهي المهمّة (مكافأة Manus 2026-10-19). */
  readonly savedSchedule?: boolean;
  /** مخرَج مجلد (موقع) بجانب المستند: «المكتبة» في قائمة «+» لا تعرضه ملفًّا يُرفق (مكافأة Manus 2026-10-20). */
  readonly siteArtifact?: boolean;
  /** PHASE-14: تشغيلات سابقة كما يسجّلها المجدول الآن: متأخّر، وإعادة محاولة، وتخطٍّ لأن السابق لم ينتهِ. */
  readonly phase14Runs?: boolean;
}

/** عيّنة من كتالوج الوكلاء: مجالان وثلاثة وكلاء (TEST FIXTURE). */
export const AGENT_CATALOG = {
  domains: [
    { domain_id: "finance", name_ar: "المالية والمحاسبة", name_en: "Finance and accounting", count: 2 },
    { domain_id: "writing", name_ar: "الكتابة والمحتوى", name_en: "Writing and content", count: 1 },
  ],
  specialists: [
    { specialist_id: "finance.financial-analyst", domain_id: "finance", name_ar: "المحلل المالي", name_en: "Financial analyst", summary_ar: "يحلّل القوائم المالية والنسب والاتجاهات.", summary_en: "Analyses financial statements, ratios and trends.", task_types: ["RESEARCH", "SYNTHESIZE"] },
    { specialist_id: "finance.accountant", domain_id: "finance", name_ar: "المحاسب", name_en: "Accountant", summary_ar: "يسجّل القيود ويعدّ القوائم وفق المعايير.", summary_en: "Records entries and prepares statements under the standards.", task_types: ["BUILD", "REVIEW"] },
    { specialist_id: "writing.poet", domain_id: "writing", name_ar: "الشاعر", name_en: "Poet", summary_ar: "ينظم الشعر العربي الفصيح والنبطي والحر.", summary_en: "Composes Arabic poetry in classical, Nabati and free forms.", task_types: ["BUILD"] },
  ],
} as const;

export function fakePhase08Host(options: FakePhase08Options = {}): { transport: Transport; log: FakePhase08Log } {
  const { transport: base } = fakePhase03Host({ executed: true, proof: "PROVEN" });
  const log: FakePhase08Log = { operations: [], payloads: [] };
  const schedules: Json[] = [];
  let runRecordedAfter = 0;
  if (options.savedSchedule === true) {
    schedules.push({
      schedule_id: SCHEDULE,
      name: "Write hello",
      mission_template: { project_id: null, model_id: null, title: "Write hello", objective: "Write outputs/hello.txt" },
      timezone: "UTC+03:00",
      schedule: { kind: "INTERVAL", minutes: 15 },
      enabled: true,
      next_run: NOW,
      last_run: null,
      last_mission_id: null,
      last_status: null,
      budget: {},
      approval_policy: "WAIT_FOR_APPROVAL",
      end_at: null,
      run_target: "SEPARATE_TASK",
      created_at: NOW,
      updated_at: NOW,
      recent_runs:
        options.phase14Runs === true
          ? [
              { run_id: "11111111-aaaa-4aaa-8aaa-000000000001", schedule_id: SCHEDULE, mission_id: null, trigger_kind: "SCHEDULED", status: "SKIPPED_PREVIOUS_ACTIVE", detail: "the previous run's mission is still WAITING_FOR_APPROVAL", triggered_at: NOW },
              { run_id: "11111111-aaaa-4aaa-8aaa-000000000002", schedule_id: SCHEDULE, mission_id: null, trigger_kind: "RETRY", status: "START_FAILED", detail: "the provider could not be reached", triggered_at: NOW },
              { run_id: "11111111-aaaa-4aaa-8aaa-000000000003", schedule_id: SCHEDULE, mission_id: MISSION, trigger_kind: "CATCH_UP", status: "COMPLETED", detail: "Due while POLARIS was not running; 3 later occurrence(s) were not run.", triggered_at: NOW },
            ]
          : [],
    });
  }
  // قائمة «⋯»: حالة المحادثات كما يحفظها المضيف، والمحادثات المحذوفة تختفي من قائمة المهامّ.
  const threads = new Map<string, { title: string; pinned: boolean; favorite: boolean; archived: boolean; project_id?: string }>();
  const deleted = new Set<string>();
  let pending = options.pendingApproval ?? false;
  const attachment = (bound: boolean): Json => ({
    attachment_id: ATTACHMENT,
    mission_id: bound ? MISSION : null,
    file_name: "notes.txt",
    workspace_ref: bound ? "inputs/notes.txt" : "",
    file_kind: "TEXT",
    size_bytes: 5,
    sha256: DIGEST,
    classification: "USER_PROVIDED_UNTRUSTED",
    imported_at: NOW,
  });
  const artifact: Json = {
    artifact_id: ARTIFACT,
    mission_id: MISSION,
    type: "DOCX",
    title: "Quarterly summary",
    file_ref: "outputs/summary.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 4096,
    sha256: DIGEST,
    created_at: NOW,
    source_task: null,
    verification: { status: "VERIFIED", checks: [{ name: "reopens", passed: true }], facts: [["paragraphs", 3]] },
    preview: { excerpt: "Quarterly summary — revenue grew", facts: { paragraphs: 3 } },
    provenance: { producer: "polaris.artifact.document", authority: "RUNTIME_MEASURED_FILE", content_trust: "MODEL_GENERATED_UNTRUSTED" },
  };
  const status: Json = {
    isolation: "APPCONTAINER+JOB",
    powershell: { available: true, detail: "" },
    python: { available: false, detail: "the Python runtime has not been prepared" },
    python_version: null,
    python_source_found: true,
    pdf_font_available: true,
    export_folder_configured: true,
    voice_configured: false,
    device_id: MISSION,
    setting_keys: ["voice.transcription_endpoint", "voice.transcription_model", "workspace.export_folder_label", "browser.engine_enabled"],
    settings: {},
  };

  function handle(operation: unknown, payload: Json): Json | null {
    switch (operation) {
      case "workspace.list":
        return {
          result: {
            mission_id: MISSION,
            entries: [
              { path: "inputs", is_dir: true, size_bytes: 0 },
              { path: "inputs/notes.txt", is_dir: false, size_bytes: 5 },
              { path: "outputs", is_dir: true, size_bytes: 0 },
              { path: "outputs/site.html", is_dir: false, size_bytes: HOSTILE_HTML.length },
            ],
            used_bytes: 5 + HOSTILE_HTML.length,
          },
        };
      case "workspace.preview":
        return payload["path"] === "outputs/site.html"
          ? { result: { path: "outputs/site.html", kind: "HTML", mime_type: "text/html", size_bytes: HOSTILE_HTML.length, text: HOSTILE_HTML, truncated: false } }
          : { result: { path: String(payload["path"]), kind: "TEXT", mime_type: "text/plain", size_bytes: 5, text: "alpha", truncated: false } };
      case "workspace.export":
        return { result: { file_label: "site.html", size_bytes: HOSTILE_HTML.length, sha256: DIGEST } };
      case "attachment.stage":
        return { result: { attachment: attachment(false) } };
      case "attachment.discard":
        return { result: { attachment_id: ATTACHMENT, discarded: true } };
      case "attachment.list":
        return { result: { attachments: [attachment(true)] } };
      case "attachment.bind":
        return { result: { mission_id: MISSION, attachments: [attachment(true)] } };
      case "artifact.list":
        return { result: { artifacts: options.siteArtifact === true ? [{ ...artifact, artifact_id: "55555555-5555-4555-8555-555555555555", type: "WEB_SITE", title: "Landing site", file_ref: "outputs/site", mime_type: "inode/directory; profile=web-site" }, artifact] : [artifact] } };
      case "attachment.artifact.stage":
        return { result: { attachment: { ...attachment(false), file_name: "summary.docx", file_kind: "DOCX", size_bytes: 4096 } } };
      case "artifact.get":
        return { result: { artifact, publications: [] } };
      case "execution.status":
        return { result: status };
      case "execution.runs":
        return {
          result: {
            mission_id: MISSION,
            runs: [
              {
                run_id: RUN,
                task_id: "t1",
                tool_id: "polaris.execution.python",
                runtime: "PYTHON",
                command_preview: "print(sum(range(10)))",
                status: "SUCCEEDED",
                exit_code: 0,
                duration_ms: 420,
                output_truncated: false,
                network: false,
                processes_total: 1,
                survivors: 0,
                output_excerpt: "45",
                started_at: NOW,
                finished_at: NOW,
              },
            ],
          },
        };
      case "execution.runtime.prepare":
        return { result: { runtime: "PYTHON", available: true, version: "3.12", files: 4000, bytes: 60_000_000, reused: false } };
      case "conversation.begin":
        return { result: { thread_id: String(payload["mission_id"]), mission_id: String(payload["mission_id"]) } };
      case "conversation.index":
        return { result: { follow_ups: [], threads: [...threads.entries()].map(([thread_id, t]) => ({ thread_id, ...t })) } };
      case "conversation.update": {
        const id = String(payload["thread_id"]);
        const current = threads.get(id) ?? { title: "summarise the architecture", pinned: false, favorite: false, archived: false };
        const next = { ...current };
        if (typeof payload["title"] === "string") next.title = payload["title"].trim();
        for (const key of ["pinned", "favorite", "archived"] as const) if (typeof payload[key] === "boolean") next[key] = payload[key];
        if (payload["project_id"] === null) delete next.project_id;
        else if (typeof payload["project_id"] === "string") next.project_id = payload["project_id"];
        threads.set(id, next);
        return { result: { thread: { thread_id: id, ...next } } };
      }
      case "conversation.delete": {
        const id = String(payload["thread_id"]);
        threads.delete(id);
        deleted.add(id);
        return { result: { thread_id: id, deleted: true, turns: 1 } };
      }
      case "conversation.search": {
        const q = String(payload["query"] ?? "");
        const all = [{ thread_id: MISSION, title: "summarise the architecture", snippet: "…the gateway checks every tool call.", updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }];
        return { result: { results: q === "" || "summarise the architecture gateway".includes(q.toLowerCase()) ? all : [] } };
      }
      case "memory.remember": {
        // كالمضيف: ما يشبه السرّ يُرفض ولا يُحفظ.
        const secret = String(payload["text"]).includes("sk-");
        return { result: secret ? { decision: "REJECTED", memory_id: null, reason: "SECRET_LIKE_CONTENT" } : { decision: "PROMOTED", memory_id: RUN, reason: "NO_CONFLICT" } };
      }
      case "project.delete":
        return { result: { project_id: String(payload["project_id"]), deleted: true, detached_missions: 0 } };
      case "agent.catalog":
        return { result: AGENT_CATALOG };
      case "mission.specialist.set":
        return { result: { mission_id: String(payload["mission_id"]), specialist_id: (payload["specialist_id"] as string | null) ?? null } };
      case "mission.model.set":
        return { result: { mission_id: String(payload["mission_id"]), model_id: (payload["model_id"] as string | null) ?? null } };
      case "schedule.list":
        if (runRecordedAfter > 0) {
          runRecordedAfter -= 1;
          if (runRecordedAfter === 0 && schedules[0] !== undefined) {
            schedules[0] = { ...schedules[0], recent_runs: [{ run_id: RUN, schedule_id: SCHEDULE, mission_id: MISSION, trigger_kind: "RUN_NOW", status: "COMPLETED", detail: "", triggered_at: NOW }] };
          }
        }
        return { result: { schedules } };
      case "schedule.save": {
        const saved = {
          schedule_id: SCHEDULE,
          name: payload["name"],
          mission_template: { project_id: null, model_id: null, ...(payload["mission_template"] as Json) },
          timezone: payload["timezone"],
          schedule: payload["schedule"],
          enabled: true,
          next_run: NOW,
          last_run: null,
          last_mission_id: null,
          last_status: null,
          budget: {},
          approval_policy: payload["approval_policy"],
          created_at: NOW,
          updated_at: NOW,
          end_at: payload["end_at"] ?? null,
          run_target: payload["run_target"] ?? "SEPARATE_TASK",
          recent_runs: [],
        };
        schedules.splice(0, schedules.length, saved);
        return { result: { schedule: saved } };
      }
      case "schedule.run_now":
        runRecordedAfter = 4;
        return { result: { schedule_id: SCHEDULE, started: true } };
      case "schedule.enable":
        return { result: { schedule: { ...(schedules[0] ?? {}), enabled: payload["enabled"] } } };
      case "schedule.delete":
        schedules.splice(0, schedules.length);
        return { result: { schedule_id: SCHEDULE, deleted: true } };
      case "oauth.list":
        return { result: { providers: [{ provider_id: "google", display_name: "Google", default_scopes: ["openid"] }], connections: [] } };
      case "publish.list":
        return { result: { publishers: [{ publisher_id: "local-folder", leaves_device: false }], publications: [] } };
      case "skill.package.list":
        return { result: { packages: [] } };
      case "tool.activity.list":
        return {
          result: {
            mission_id: MISSION,
            invocations: [
              {
                invocation_id: INVOCATION,
                mission_id: MISSION,
                // منسوب إلى خطوته عند البوابة (A2)، كما يسجّله المضيف.
                task_id: P03_IDS.TASK_BUILD,
                tool_id: "polaris.execution.python",
                status: "SUCCEEDED",
                effects: ["SANDBOXED_EXECUTION"],
                arguments_digest: DIGEST,
                summary: "python exited 0",
                started_at: NOW,
                duration_ms: 420,
              },
            ],
          },
        };
      case "approval.list":
        return {
          result: {
            approvals: pending
              ? [
                  {
                    approval_id: APPROVAL,
                    mission_id: MISSION,
                    tool_id: "polaris.browser.permit_write",
                    effects: ["EXTERNAL_SIDE_EFFECT"],
                    arguments_digest: DIGEST,
                    arguments_preview: "{\"origin\":\"https://shop.test\"}",
                    status: "PENDING",
                    requested_at: NOW,
                    expires_at: NOW,
                    context: { agent_id: MISSION, action: "WEB_PERMIT_WRITE", target: "https://shop.test", expected_effect: "The browser may send data to this site.", risk: "HIGH", arguments_summary: "origin" },
                  },
                ]
              : [],
          },
        };
      case "tool.approval.respond":
        pending = false;
        return {
          result: {
            approval: {
              approval_id: APPROVAL,
              mission_id: MISSION,
              tool_id: "polaris.browser.permit_write",
              effects: ["EXTERNAL_SIDE_EFFECT"],
              arguments_digest: DIGEST,
              status: payload["decision"] === "GRANT" ? "GRANTED" : "DENIED",
              requested_at: NOW,
              decided_at: NOW,
              expires_at: NOW,
            },
          },
        };
      default:
        return null;
    }
  }

  const transport: Transport = {
    async send(envelope: unknown): Promise<unknown> {
      const request = envelope as Json;
      const operation = String(request["operation"]);
      log.operations.push(operation);
      const payload = (request["payload"] ?? {}) as Json;
      log.payloads.push(payload);
      // المحادثة تُبنى من المهمّة كما يعيدها بديل Phase-03، كما يبنيها المضيف من مستودع المهامّ.
      if (operation === "conversation.get" || operation === "conversation.continue") {
        const got = (await base.send({ ...request, operation: "mission.get", payload: { mission_id: MISSION } })) as Json;
        const mission = ((got["result"] as Json | undefined)?.["mission"] ?? {}) as Json;
        const proof = (((got["result"] as Json | undefined)?.["completion_proof"] ?? {}) as Json)["status"] ?? "NOT_EVALUATED";
        const turn: Json = {
          mission_id: MISSION,
          seq: 0,
          message: String(mission["objective"] ?? "summarise the architecture"),
          created_at: NOW,
          state: mission["state"] ?? "CREATED",
          completion_proof_status: proof,
          ...(mission["started_at"] === undefined ? {} : { started_at: mission["started_at"] }),
          ...(mission["completed_at"] === undefined ? {} : { completed_at: mission["completed_at"] }),
          ...(mission["result_summary"] === undefined ? {} : { answer: mission["result_summary"] }),
        };
        const entries: Json[] = [
          { entry_id: 1, mission_id: MISSION, kind: "PLAN", text: "I will read the project context, then summarise it.", created_at: NOW },
          { entry_id: 2, mission_id: MISSION, kind: "STEP", text: "do the work", created_at: NOW },
          { entry_id: 3, mission_id: MISSION, kind: "ACTION", text: 'polaris.execution.python {"script":"print(sum(range(10)))"}', detail: "SUCCEEDED", created_at: NOW },
          { entry_id: 4, mission_id: MISSION, kind: "ACTION", text: 'polaris.artifact.document {"title":"Quarterly summary"}', detail: "SUCCEEDED", created_at: NOW },
          { entry_id: 5, mission_id: MISSION, kind: "NOTE", text: "The summary is written.", created_at: NOW },
          { entry_id: 6, mission_id: MISSION, kind: "SUGGESTION", text: "Summarise the risks section too", created_at: NOW },
        ];
        const result =
          operation === "conversation.get"
            ? { conversation: { thread_id: MISSION, title: String(mission["title"] ?? "summarise the architecture"), turns: [turn], entries, thinking: false } }
            : { thread_id: MISSION, mission_id: MISSION, seq: 1 };
        return {
          contract_version: "1.7",
          protocol_version: "1.7",
          message_type: "RESPONSE",
          message_id: "9e8d7c6b-5a49-4382-b170-6f5e4d3c2b1b",
          request_id: request["message_id"],
          causation_id: request["message_id"],
          correlation_id: request["correlation_id"],
          session_id: SESSION,
          caller_identity: { caller_type: "CORE_UI", principal_id: PRINCIPAL, trust_tier: "TIER_2_UNTRUSTED", session_id: SESSION },
          timestamp: NOW,
          result,
        };
      }
      const handled = handle(operation, payload);
      if (handled !== null) {
        return {
          contract_version: "1.7",
          protocol_version: "1.7",
          message_type: "RESPONSE",
          message_id: "9e8d7c6b-5a49-4382-b170-6f5e4d3c2b1a",
          request_id: request["message_id"],
          causation_id: request["message_id"],
          correlation_id: request["correlation_id"],
          session_id: SESSION,
          caller_identity: { caller_type: "CORE_UI", principal_id: PRINCIPAL, trust_tier: "TIER_2_UNTRUSTED", session_id: SESSION },
          timestamp: NOW,
          ...handled,
        };
      }
      const answer = (await base.send(envelope)) as Json;
      // كالمضيف: المحادثة المحذوفة لا تعود في قائمة المهامّ، والعنوان الجديد يظهر فيها.
      if (operation === "mission.list" && answer["result"] !== undefined) {
        const missions = ((answer["result"] as Json)["missions"] as Json[]).filter((m) => !deleted.has(String(m["mission_id"]))).map((m) => {
          const t = threads.get(String(m["mission_id"]));
          return t === undefined ? m : { ...m, title: t.title, ...(t.project_id === undefined ? {} : { project_id: t.project_id }) };
        });
        return { ...answer, result: { missions } };
      }
      return answer;
    },
  };
  return { transport, log };
}

export const P08_IDS = { MISSION, ATTACHMENT, ARTIFACT, SCHEDULE, APPROVAL };
