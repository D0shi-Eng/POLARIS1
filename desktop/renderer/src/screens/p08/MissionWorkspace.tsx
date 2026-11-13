// المهمّة محادثة (على نمط مانوس، كما قيس في تطبيقه 2026-10-01): كل رسالة من المستخدم فقاعة، وتحتها كتلة
// POLARIS — «يعمل منذ …» حيًّا، ثم ما كتبه الوكيل للمستخدم عن خطّته وخطواته فقرةً فقرة بوقتها، ومجموعات
// الأفعال بعدّادها وفعلها الجاري، و«يفكّر» ما دام نداء نموذج جاريًا. عند الانتهاء يُطوى ذلك كله تحت
// «عمل لمدة …›»، ثم الردّ منسّقًا، ثم الملف المكتوب معروضًا، ثم «تم إكمال المهمّة» والتقييم.
// المتابعة دورٌ تالٍ في المحادثة نفسها (conversation.continue)، لا مهمّة جديدة يُلصق فيها السياق.
//
// كل ما يُعرض حقيقة قالها المضيف: أدوار المحادثة وحالاتها وأجوبتها (conversation.get)، وسرد زمن التشغيل كما
// سُجّل، والموافقات، والمخرجات، وملفات outputs/. السرد يظهر جملةً جملة بالقراءة الدورية (كل 1.2 ثانية)،
// لا حرفًا حرفًا: المضيف لا يبثّ نصّ النموذج أثناء توليده.

import { RememberDialog } from "../../ui/components/RememberDialog";
import { useEffect, useMemo, useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { ArtifactV1, ConversationEntryV1, ConversationTurnV1, ConversationV1, ExecutionRunsResultV1, WorkspaceListResultV1, WorkspacePreviewResultV1 } from "../../generated/types/desktop-p08-result-v1";
import type { Phase02Client } from "../../ipc/p02-client";
import type { Phase03Client } from "../../ipc/p03-client";
import type { Phase04Client } from "../../ipc/p04-client";
import type { Phase05Client } from "../../ipc/p05-client";
import type { Phase08Client } from "../../ipc/p08-client";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { activityKey, formatBytes, formatDuration } from "../../p08/present";
import { MissionTrace } from "./MissionTrace";
import { StepTree, stepCounter, useMissionSteps } from "./StepTree";
import { specialistName, useAgentCatalog } from "../../p08/specialists";
import { Icon, type IconName } from "../../ui/components/Icon";
import { Markdown } from "../../ui/components/Markdown";
import { ModelPicker } from "../../ui/components/ModelPicker";
import { BrowserSessions } from "../p05/BrowserComputerScreen";
import { Composer } from "./Composer";
import { FilesPanel } from "./FilesPanel";
import { TurnAttachments } from "./TurnAttachments";

const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED", "STOPPED"];
/** حالات يعمل فيها التشغيل الآن. */
const RUNNING = ["PLANNING", "READY", "RUNNING", "VERIFYING"];

type Side = "terminal" | "files" | "browser";

/** ما يجعل للحاسوب معنى: أداة تعمل على «شاشة» الوكيل — طرفية، أو Python، أو متصفّح، أو سطح المكتب.
 *  مهمّة كتبت ملفًّا فقط لا تفتح حاسوبًا (قيس 2026-10-01: اللوح فُتح على شجرة ملفات لا يضيف شيئًا). */
export function computerSideOf(toolId: string): Side | null {
  if (toolId === "polaris.execution.command" || toolId === "polaris.execution.python") return "terminal";
  if (toolId.startsWith("polaris.browser.") || toolId.startsWith("polaris.web.") || toolId.startsWith("polaris.desktop.")) return "browser";
  // قراءة ملفات المساحة وكتابتها وإنشاء المستندات عملٌ على «محرّر» الوكيل: يُفتح الحاسوب على لسان الملفات.
  if (toolId.startsWith("polaris.workspace.") || toolId.startsWith("polaris.artifact.")) return "files";
  return null;
}

function usePulse(active: boolean, ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return tick;
}

/** عائلة الفعل: أيقونته، وأيّ عدّاد يزيد في سطر المجموعة. */
function kindOf(toolId: string): { readonly icon: IconName; readonly bucket: "wrote" | "ran" | "browsed" | "read" | "other" } {
  if (toolId.startsWith("polaris.execution.")) return { icon: "code", bucket: "ran" };
  if (toolId.startsWith("polaris.browser.") || toolId.startsWith("polaris.web.")) return { icon: "globe", bucket: "browsed" };
  if (toolId === "polaris.workspace.write" || toolId.startsWith("polaris.artifact.") || toolId === "polaris.package.zip") return { icon: "edit", bucket: "wrote" };
  if (toolId === "polaris.workspace.read" || toolId === "polaris.workspace.list") return { icon: "search", bucket: "read" };
  return { icon: "sparkle", bucket: "other" };
}

/** اسم الفعل في سطره كما يكتبه مانوس («تحرير الملفات»، «تشغيل أمر»)، والعامّ لما لا اسم له. */
function rowVerbKey(toolId: string): string {
  const key = `ui.act.${toolId.replace(/^polaris\./, "").replace(/\./g, "_")}`;
  return key;
}

/** أيقونة سطر الفعل كما في مانوس: ملف للملفات، وطرفية للأوامر، وكرة للويب. */
function rowIcon(toolId: string, target: string): IconName {
  if (toolId.startsWith("polaris.execution.")) return "terminal";
  if (toolId.startsWith("polaris.provider.")) return "schedule";
  if (toolId.startsWith("polaris.browser.") || toolId.startsWith("polaris.web.")) return "globe";
  if (toolId.startsWith("polaris.workspace.") || toolId.startsWith("polaris.artifact.")) return target === "" ? "file" : fileIcon(target);
  return kindOf(toolId).icon;
}

/** ما يُفتح في لوح الحاسوب عند نقر سطر فعل (كما في مانوس): الملف نفسه، أو الأمر في الطرفية، أو المتصفّح. */
export type ComputerFocus = { readonly side: "files"; readonly path: string } | { readonly side: "terminal"; readonly command: string; readonly missionId: string } | { readonly side: "browser" };

function focusOf(entry: ConversationEntryV1): ComputerFocus | null {
  const { toolId, target } = parseAction(entry);
  const side = computerSideOf(toolId);
  if (side === "files") return target === "" ? null : { side, path: target };
  if (side === "terminal") return { side, command: target, missionId: entry.mission_id };
  if (side === "browser") return { side };
  return null;
}

/** أيقونة الملف من امتداده. */
export function fileIcon(path: string): IconName {
  if (/\.(md|markdown|txt|docx?|pdf)$/i.test(path)) return "report";
  if (/\.(csv|xlsx?|json)$/i.test(path)) return "data";
  if (/\.(pptx?)$/i.test(path)) return "slides";
  if (/\.(html?)$/i.test(path)) return "web";
  if (/\.(py|js|ts|sh|ps1|rs)$/i.test(path)) return "code";
  return "file";
}

const baseName = (path: string) => path.split("/").pop() ?? path;
const previewable = (path: string) => /\.(md|markdown|txt|html?)$/i.test(path);

/** سطر الفعل: معرّف الأداة، وأبرز حججها (مسار، رابط، أمر) إن أمكن قراءتها. */
function parseAction(entry: ConversationEntryV1): { readonly toolId: string; readonly target: string } {
  const space = entry.text.indexOf(" ");
  const toolId = space < 0 ? entry.text : entry.text.slice(0, space);
  const rest = space < 0 ? "" : entry.text.slice(space + 1).trim();
  let target = "";
  try {
    const args = JSON.parse(rest.replace(/…$/, "")) as Record<string, unknown>;
    for (const key of ["path", "url", "command", "file_name", "title", "query", "script"]) {
      const value = args[key];
      if (typeof value === "string" && value.trim() !== "") {
        target = value.split("\n")[0] ?? value;
        break;
      }
    }
    // انتظار حدّ المزوّد (سطر يسجّله المضيف عند 429): المدّة بالثواني.
    if (target === "" && typeof args["seconds"] === "number") target = `${args["seconds"]}s`;
  } catch {
    const m = rest.match(/"(?:path|url|command|title)"\s*:\s*"([^"]{1,160})/);
    target = m?.[1] ?? "";
  }
  return { toolId, target };
}

/** كتلة في سرد الدور: فقرة كتبها الوكيل، أو مجموعة أفعال تحت خطوة. */
type Block =
  | { readonly kind: "said"; readonly entry: ConversationEntryV1 }
  | { readonly kind: "group"; readonly title: string | null; readonly specialist: string | null; readonly actions: ConversationEntryV1[]; readonly at: string };

function blocksOf(entries: readonly ConversationEntryV1[]): Block[] {
  const out: Block[] = [];
  let group: { kind: "group"; title: string | null; specialist: string | null; actions: ConversationEntryV1[]; at: string } | null = null;
  for (const e of entries) {
    // أسئلة المتابعة ليست سردًا للعمل: تُعرض تحت الردّ وحدها.
    if (e.kind === "SUGGESTION") continue;
    if (e.kind === "PLAN" || e.kind === "NOTE") {
      group = null;
      out.push({ kind: "said", entry: e });
    } else if (e.kind === "STEP") {
      // تفصيل سطر الخطوة معرّف الوكيل المتخصّص الذي عمل عليها، إن اختير.
      group = { kind: "group", title: e.text, specialist: e.detail ?? null, actions: [], at: e.created_at };
      out.push(group);
    } else {
      if (group === null) {
        group = { kind: "group", title: null, specialist: null, actions: [], at: e.created_at };
        out.push(group);
      }
      group.actions.push(e);
    }
  }
  return out;
}

export interface MissionWorkspaceProps {
  readonly missionId: string;
  readonly phase02?: Phase02Client | undefined;
  readonly phase03: Phase03Client;
  readonly phase04?: Phase04Client | undefined;
  readonly phase05?: Phase05Client | undefined;
  readonly phase08: Phase08Client;
  /** يُستدعى بمعرّف الدور الأخير (المهمّة الجارية أو آخر ما انتهى) وحالته، لتقرأه الترويسة. */
  onStateChange?(state: string, activeMissionId: string): void;
}

export function MissionWorkspace({ missionId, phase02, phase03, phase04, phase05, phase08, onStateChange }: MissionWorkspaceProps) {
  const translator = useTranslator();
  const [computer, setComputer] = useState(false);
  const [side, setSide] = useState<Side>("files");
  const [bump, setBump] = useState(0);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  // طلب موافقة رُفضت له «لهذه المهمّة» (ADR-042).
  const [grantRefused, setGrantRefused] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [nextModel, setNextModel] = useState("");
  const [plan, setPlan] = useState(false);
  const [trace, setTrace] = useState(false);
  const [focus, setFocus] = useState<ComputerFocus | null>(null);
  /** نقر سطر فعل أو ملف: يفتح الحاسوب على ما يخصّه، كما في مانوس. */
  const openFocus = (next: ComputerFocus) => {
    setFocus(next);
    setSide(next.side);
    setComputer(true);
  };

  const conv = useHostQuery(() => phase08.getConversation(missionId), [phase08, missionId, bump]);
  const conversation: ConversationV1 | undefined = conv.value?.conversation;
  const turns = conversation?.turns ?? [];
  const last = turns[turns.length - 1];
  const state = last?.state ?? "CREATED";
  const activeId = last?.mission_id ?? missionId;
  const threadId = conversation?.thread_id ?? missionId;
  const finished = TERMINAL.includes(state);
  const live = RUNNING.includes(state);
  // يُسأل المضيف ما دام الدور الأخير لم ينتهِ — ومنه «أُنشئت»: الشاشة تُفتح قبل أن يبدأ التشغيل.
  const tick = usePulse(!finished, live ? 1200 : 2000);
  const refreshKey = `${tick}-${bump}`;
  useEffect(() => {
    if (tick > 0) conv.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  useEffect(() => {
    if (last !== undefined) onStateChange?.(state, activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, activeId]);
  useEffect(() => {
    if (stopping && TERMINAL.includes(state)) setStopping(false);
    if (starting && state !== "CREATED") setStarting(false);
  }, [stopping, starting, state]);

  // الخطة الحيّة (F1): خطوات الدور الأخير من رسم المهمّة، تُقرأ مع كل نبضة ما دام يعمل.
  const steps = useMissionSteps(phase03, activeId, refreshKey);
  const counter = stepCounter(steps);
  const approvals = useHostQuery(
    () => (phase04 === undefined || state === "CREATED" ? Promise.resolve({ ok: true as const, value: { approvals: [] } }) : phase04.listApprovals({ mission_id: activeId })),
    [phase04, activeId, state, refreshKey],
  );
  const pending = (approvals.value?.approvals ?? []).filter((a) => a.status === "PENDING");
  // منح «اسمح لهذه المهمّة» القائمة (ADR-042): تُرى وتُسحب من شريط الحالة.
  const grants = useHostQuery(() => phase08.missionGrants(activeId), [phase08, activeId, bump]);
  const grantCount = grants.value?.grants.length ?? 0;
  const artifacts = useHostQuery(() => phase08.listArtifacts(), [phase08, finished, bump]);
  const workspace = useHostQuery<WorkspaceListResultV1 | null>(() => (finished ? phase08.listWorkspace(threadId) : Promise.resolve({ ok: true as const, value: null })), [phase08, threadId, finished, bump]);
  const runsMission = focus?.side === "terminal" ? focus.missionId : activeId;
  const runs = useHostQuery<ExecutionRunsResultV1 | null>(() => (computer ? phase08.executionRuns(runsMission) : Promise.resolve({ ok: true as const, value: null })), [phase08, runsMission, computer, refreshKey]);

  const turnIds = new Set(turns.map((t) => t.mission_id));
  const threadArtifacts = (artifacts.value?.artifacts ?? []).filter((a) => turnIds.has(a.mission_id));
  const artifactPaths = new Set(threadArtifacts.map((a) => a.file_ref));
  const outputFiles = (workspace.value?.entries ?? []).filter((e) => !e.is_dir && e.path.startsWith("outputs/") && !artifactPaths.has(e.path));

  async function decide(approvalId: string, decision: "GRANT" | "DENY", scope: "ONCE" | "MISSION" = "ONCE"): Promise<void> {
    if (phase04 === undefined) return;
    setGrantRefused(null);
    const answered = await phase04.respondToApproval(approvalId, decision, undefined, scope);
    // «لهذه المهمّة» رفضها المضيف لفعل لا يقبلها: لا شيء مُنح، والطلب باقٍ ينتظر قرارًا كاملًا.
    if (!answered.ok && scope === "MISSION") setGrantRefused(approvalId);
    setBump((b) => b + 1);
    // الدور يُستأنف من حيث توقّف في الحالتين: الموافقة تسمح بالفعل والبوابة تتحقّق منها، والرفض يصل الوكيل نتيجةً فيكمل بدونه
    // (R-24). كان الاستئناف للموافقة وحدها، فتبقى المهمّة بعد الرفض «تنتظر موافقة» بلا بطاقة (DEF-36، تدقيق 2026-10-29).
    if (answered.ok) void phase03.startMission(activeId).then(() => setBump((b) => b + 1));
  }

  /** رسالة للوكيل والدور يعمل (ADR-042): تُحفظ أولًا، ثم تظهر تحت الدور بحالتها. */
  async function note(text: string): Promise<boolean> {
    const queued = await phase08.addMissionNote(activeId, text);
    setBump((b) => b + 1);
    return queued.ok;
  }

  async function revokeGrants(): Promise<void> {
    await phase08.revokeMissionGrants(activeId);
    setBump((b) => b + 1);
  }

  async function stop(): Promise<void> {
    if (stopping) return;
    setStopping(true);
    await phase03.cancelMission(activeId);
    setBump((b) => b + 1);
  }

  /** سؤال متابعة نقره المستخدم: يُرسل كما لو كتبه (كما في مانوس)، ويرث الدور الجديد النموذج والمساحة. */
  async function suggestFollowUp(text: string): Promise<void> {
    const next = await phase08.continueConversation(threadId, text);
    if (!next.ok) return;
    void phase03.startMission(next.value.mission_id);
    setBump((b) => b + 1);
  }

  function start(): void {
    if (starting) return;
    setStarting(true);
    void phase03.startMission(activeId).then(() => setBump((b) => b + 1));
    setTimeout(() => setBump((b) => b + 1), 600);
  }

  const entriesOf = (id: string) => (conversation?.entries ?? []).filter((e) => e.mission_id === id);
  const lastRun = (runs.value?.runs ?? [])[0];
  const lastAction = [...(conversation?.entries ?? [])].reverse().find((e) => e.kind === "ACTION" && e.mission_id === activeId);
  // آخر ما استعمله الوكيل من «حاسوبه» في المحادثة: يحدّد هل يظهر الزرّ، وعلى أيّ لسان يُفتح.
  const computerSides = (conversation?.entries ?? []).filter((e) => e.kind === "ACTION").map((e) => computerSideOf(parseAction(e).toolId)).filter((s): s is Side => s !== null);
  // يُفتح على آخر طرفية أو متصفّح استعمله الوكيل؛ ولسان الملفات وحده حين لم يعمل إلا على الملفات.
  const screenSides = computerSides.filter((s) => s !== "files");
  const lastComputerSide = screenSides[screenSides.length - 1] ?? computerSides[computerSides.length - 1];

  return (
    <div className={computer ? "task is-computer-open" : "task"}>
      <div className="task__main">
        <div className="topbar topbar--task">
          <ModelPicker phase02={phase02} value={nextModel !== "" ? nextModel : (last?.model_id ?? "")} onChange={setNextModel} />
          {conversation?.project_id === undefined ? null : (
            <span className="topbar__project" title={translator.t("ui.task.project")}>
              <Icon name="projects" size={16} />
            </span>
          )}
          <span className="topbar__spacer" />
          <button type="button" className="icon-button" aria-label={translator.t("ui.files.all")} title={translator.t("ui.files.all")} onClick={() => setFilesOpen(true)}>
            <Icon name="library" size={17} />
          </button>
        </div>

        <div className="thread">
          {turns.map((turn, index) => (
            <Turn
              key={turn.mission_id}
              turn={turn}
              entries={entriesOf(turn.mission_id)}
              isLast={index === turns.length - 1}
              thinking={index === turns.length - 1 && (conversation?.thinking ?? false)}
              artifacts={TERMINAL.includes(turn.state) ? threadArtifacts.filter((a) => a.mission_id === turn.mission_id) : []}
              outputFiles={index === turns.length - 1 && finished ? outputFiles : []}
              threadId={threadId}
              projectId={conversation?.project_id}
              phase08={phase08}
              pending={index === turns.length - 1 ? pending : []}
              onDecide={(id, d, scope) => void decide(id, d, scope)}
              grantRefused={grantRefused}
              onOpenFile={(path) => openFocus({ side: "files", path })}
              onOpenAction={(entry) => {
                const next = focusOf(entry);
                if (next !== null) openFocus(next);
              }}
              onExport={(path) => phase08.exportFile(threadId, path)}
              onAllFiles={() => setFilesOpen(true)}
              onStart={start}
              starting={starting}
              onSuggest={index === turns.length - 1 ? (text) => void suggestFollowUp(text) : undefined}
            />
          ))}
          {conv.loading && conversation === undefined ? <p className="agent__muted">{translator.t("state.loading")}</p> : null}
        </div>

        <div className="task__dock">
          {plan && counter !== null ? <StepTree steps={steps} phase04={phase04} missionId={activeId} refreshKey={refreshKey} onClose={() => setPlan(false)} /> : null}
          {trace && state !== "CREATED" ? <MissionTrace phase08={phase08} missionId={activeId} refreshKey={refreshKey} onClose={() => setTrace(false)} /> : null}
          <div className={live ? "dock__status working" : finished && state === "COMPLETED" ? "dock__status is-done" : "dock__status"} role="status" aria-live="polite">
            {live ? <span className="working__pulse" aria-hidden="true" /> : <Icon name={finished ? (state === "COMPLETED" ? "check" : "shield") : "schedule"} size={15} />}
            <span className="dock__text">
              <span className="working__phase">
                {live ? translator.t(stopping ? "p08.phase.cancelling" : "ui.work.working") : finished ? (state === "COMPLETED" ? translator.t("ui.done.completed") : translator.t(`p03.mission_state.${state}`)) : state === "CREATED" ? translator.t("ui.dock.not_started") : translator.t(`p03.mission_state.${state}`)}
              </span>
              {live && lastAction !== undefined ? (
                <span className="working__step" dir="auto">
                  {translator.t(activityKey(parseAction(lastAction).toolId), { tool: parseAction(lastAction).toolId })}
                </span>
              ) : null}
            </span>
            {counter === null ? null : (
              <button type="button" className={plan ? "dock__steps is-open" : "dock__steps"} aria-expanded={plan} title={translator.t("p08.steps.title")} onClick={() => setPlan((open) => !open)}>
                <Icon name="list" size={13} />
                <span>{translator.t("p08.steps.count", { current: counter.current, total: counter.total })}</span>
              </button>
            )}
            {state === "CREATED" ? null : (
              <button type="button" className={trace ? "dock__steps is-open" : "dock__steps"} aria-expanded={trace} title={translator.t("p08.trace.title")} onClick={() => setTrace((open) => !open)}>
                <Icon name="activity" size={13} />
                <span>{translator.t("p08.trace.open")}</span>
              </button>
            )}
            {grantCount === 0 ? null : (
              <button type="button" className="dock__steps" title={translator.t("p08.grants.revoke_hint")} onClick={() => void revokeGrants()}>
                <Icon name="shield" size={13} />
                <span>{translator.t("p08.grants.active", { count: grantCount })}</span>
              </button>
            )}
            {lastComputerSide === undefined ? null : (
              <button
                type="button"
                className={live ? "dock__computer is-live" : "dock__computer"}
                aria-pressed={computer}
                title={translator.t("ui.computer.title")}
                onClick={() => {
                  // يُفتح على آخر ما استعمله الوكيل: الطرفية أو المتصفّح.
                  if (!computer) {
                    setSide(lastComputerSide);
                    setFocus(null);
                  }
                  setComputer((open) => !open);
                }}
              >
                <span className="dock__thumb" aria-hidden="true">
                  <Icon name={lastComputerSide === "terminal" ? "code" : lastComputerSide === "files" ? "file" : "browser"} size={14} />
                </span>
                <span className="dock__computer-label">{translator.t("ui.computer.title")}</span>
              </button>
            )}
          </div>
          {last === undefined ? null : (
            <Composer
              phase02={phase02}
              phase03={phase03}
              phase08={phase08}
              modelId={nextModel}
              followUp={{ missionId: threadId, onSent: () => setBump((b) => b + 1) }}
              busy={finished || state === "BLOCKED" || state === "CREATED" ? undefined : { stopping, canStop: live || state === "WAITING_FOR_APPROVAL", onStop: () => void stop(), onNote: stopping ? undefined : note }}
            />
          )}
        </div>
      </div>

      {computer ? (
        <ComputerPanel
          missionId={activeId}
          threadId={threadId}
          focus={focus}
          side={side}
          onSide={(next) => {
            setSide(next);
            setFocus(null);
          }}
          live={live}
          runs={runs.value?.runs ?? []}
          lastRun={lastRun}
          lastAction={lastAction}
          phase05={phase05}
          phase08={phase08}
          refreshKey={refreshKey}
          onClose={() => setComputer(false)}
        />
      ) : null}

      {filesOpen ? (
        <FilesDialog
          artifacts={threadArtifacts}
          outputFiles={outputFiles.map((f) => ({ path: f.path, size: f.size_bytes }))}
          onOpen={(path) => {
            setFilesOpen(false);
            setViewer(path);
          }}
          onExport={(path) => void phase08.exportFile(threadId, path)}
          onClose={() => setFilesOpen(false)}
        />
      ) : null}
      {viewer !== null ? <DocumentViewer missionId={threadId} path={viewer} phase08={phase08} onClose={() => setViewer(null)} /> : null}
    </div>
  );
}

/** دور واحد: فقاعة المستخدم، ثم كتلة POLARIS. */
function Turn({
  turn,
  entries,
  isLast,
  thinking,
  artifacts,
  outputFiles,
  threadId,
  projectId,
  phase08,
  pending,
  onDecide,
  grantRefused = null,
  onOpenFile,
  onOpenAction,
  onExport,
  onAllFiles,
  onStart,
  starting,
  onSuggest,
}: {
  readonly turn: ConversationTurnV1;
  readonly entries: readonly ConversationEntryV1[];
  readonly isLast: boolean;
  readonly thinking: boolean;
  readonly artifacts: readonly ArtifactV1[];
  readonly outputFiles: readonly { readonly path: string; readonly size_bytes: number }[];
  readonly threadId: string;
  /** مشروع المحادثة: «تذكّر هذا» يعرض الحفظ عنه بجانب الحفظ عن المستخدم. */
  readonly projectId?: string | undefined;
  readonly phase08: Phase08Client;
  readonly pending: readonly { readonly approval_id: string; readonly tool_id: string; readonly arguments_preview?: string; readonly context?: { readonly expected_effect: string; readonly target: string; readonly risk: string } }[];
  onDecide(approvalId: string, decision: "GRANT" | "DENY", scope?: "ONCE" | "MISSION"): void;
  /** طلب رُفضت له «لهذه المهمّة» (فعل لا يقبلها). */
  readonly grantRefused?: string | null;
  onOpenFile(path: string): void;
  onOpenAction(entry: ConversationEntryV1): void;
  onExport(path: string): Promise<{ readonly ok: boolean }>;
  onAllFiles(): void;
  onStart(): void;
  readonly starting: boolean;
  /** نقر سؤال متابعة (للدور الأخير وحده). */
  onSuggest?: ((text: string) => void) | undefined;
}) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const state = turn.state;
  const finished = TERMINAL.includes(state);
  const live = RUNNING.includes(state);
  const [open, setOpen] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [remembering, setRemembering] = useState(false);
  const [rating, setRating] = useState<number>(turn.rating ?? 0);
  // E-5: تقييم قديم حُفظ في localStorage قبل أن يصير محفوظًا في قاعدة التطبيق يُنقل إليها مرة واحدة، ولا يضيع.
  useEffect(() => {
    if (turn.rating !== undefined || turn.state !== "COMPLETED") return;
    const legacy = readLegacyRating(turn.mission_id);
    if (legacy < 1 || legacy > 5) return;
    void phase08.rateMission(turn.mission_id, legacy).then((stored) => {
      if (stored.ok) {
        setRating(legacy);
        forgetLegacyRating(turn.mission_id);
      }
    });
  }, [phase08, turn.mission_id, turn.rating, turn.state]);
  const pulse = usePulse(live, 1000);
  const startedAt = turn.started_at;
  const workedMs = startedAt === undefined ? 0 : Math.max(0, (turn.completed_at === undefined ? Date.now() : Date.parse(turn.completed_at)) - Date.parse(startedAt));
  void pulse;
  const showWork = open ?? !finished;
  const blocks = useMemo(() => blocksOf(entries), [entries]);
  const suggestions = entries.filter((e) => e.kind === "SUGGESTION");
  // أسماء الوكلاء المتخصّصين الذين عملوا على خطوات هذا الدور، بلغة الواجهة.
  const agentCatalog = useAgentCatalog(phase08);
  const agentNames = useMemo(() => new Map((agentCatalog?.specialists ?? []).map((s) => [s.specialist_id, specialistName(s, translator.locale)])), [agentCatalog, translator.locale]);
  const answer = turn.answer;
  const hasAnswer = answer !== undefined && answer.trim() !== "";
  const files = [
    ...artifacts.map((a) => ({ key: a.artifact_id, path: a.file_ref, title: a.title, meta: `${a.type} · ${formatBytes(a.size)}` })),
    ...outputFiles.map((f) => ({ key: f.path, path: f.path, title: baseName(f.path), meta: formatBytes(f.size_bytes) })),
  ].filter((f) => !isInternalAgentReport(f.path));
  const featured = isLast ? (files.map((f) => f.path).find(previewable) ?? null) : null;
  // مستند Word أو عرض أو جدول لا يُعاين نصًّا خامًا: يُعرض مقتطفه الذي استخرجه المضيف حين تحقّق منه، في بطاقة
  // كبطاقة مانوس (قِيس 2026-10-05: المستند ظهر رقاقةً صغيرة وحدها).
  const excerptCard = isLast && featured === null ? artifacts.find((a) => a.verification.status === "VERIFIED" && typeof (a.preview as { excerpt?: unknown }).excerpt === "string") : undefined;
  const preview = useHostQuery<WorkspacePreviewResultV1 | null>(
    () => (featured === null ? Promise.resolve({ ok: true as const, value: null }) : phase08.previewFile(threadId, featured, 8000)),
    [phase08, threadId, featured],
  );
  const modelBadge = turn.model_id?.split(":").pop()?.split("/").pop();

  async function copyAnswer(): Promise<void> {
    if (!hasAnswer) return;
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div className="msg-user">
        <TurnAttachments phase08={phase08} missionId={turn.mission_id} />
        <div className="msg msg--user" dir="auto">
          {turn.message}
        </div>
        <div className="msg-user__tools">
          <button type="button" className="ghost-button msg-user__remember" title={translator.t("ui.memory.remember_title")} onClick={() => setRemembering(true)}>
            <Icon name="memory" size={14} />
            <span>{translator.t("ui.memory.remember")}</span>
          </button>
        </div>
      </div>
      {(turn.notes ?? []).length === 0 ? null : (
        <ul className="msg-notes" aria-label={translator.t("ui.note.list")}>
          {(turn.notes ?? []).map((n) => (
            <li key={n.note_id} className={`msg-note state-${n.state.toLowerCase()}`}>
              <span className="msg msg--user msg--note" dir="auto">
                {n.text}
              </span>
              <span className="msg-note__state">{translator.t(`ui.note.state.${n.state}`, { time: n.delivered_at === undefined ? "" : formatTime(locale, n.delivered_at) })}</span>
            </li>
          ))}
        </ul>
      )}
      {remembering ? <RememberDialog phase08={phase08} initialText={turn.message} projectId={projectId} missionId={turn.mission_id} onClose={() => setRemembering(false)} /> : null}
      <section className="msg msg--agent" aria-label={translator.t("p08.feed.label")}>
        <header className="agent__head">
          <svg className="agent__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <path d="M16 1.5 L18.9 13.1 L30.5 16 L18.9 18.9 L16 30.5 L13.1 18.9 L1.5 16 L13.1 13.1 Z" fill="currentColor" />
          </svg>
          <span className="agent__name">{translator.t("app.name")}</span>
          {modelBadge === undefined ? null : <span className="agent__badge">{modelBadge}</span>}
          {/* الوكيل المثبَّت لهذا الدور يبقى ظاهرًا بعد طيّ الخطوات. */}
          {turn.specialist_id === undefined ? null : (
            <span className="step__agent" title={translator.t("nav.agents")}>
              <Icon name="user" size={12} />
              {agentNames.get(turn.specialist_id) ?? turn.specialist_id}
            </span>
          )}
        </header>

        {state === "CREATED" && isLast ? (
          <p className="agent__muted agent__waiting">
            <span className="working__pulse" aria-hidden="true" />
            <span>{translator.t("ui.work.starting")}</span>
            <button type="button" className="link-button" disabled={starting} onClick={onStart}>
              {translator.t("ui.dock.start")}
            </button>
          </p>
        ) : null}

        {startedAt === undefined && !live ? null : finished || !live ? (
          <button type="button" className="worked__toggle" aria-expanded={showWork} onClick={() => setOpen(!showWork)}>
            <span>{workedMs < 1000 ? translator.t("ui.work.worked") : translator.t("ui.work.worked_for", { duration: workedLabel(workedMs) })}</span>
            <Icon name="chevron" size={14} className="worked__chevron" />
          </button>
        ) : (
          <p className="worked__live">{workedMs < 1000 ? translator.t("ui.work.working") : translator.t("ui.work.working_for", { duration: workedLabel(workedMs) })}</p>
        )}

        <div className="worked__body" hidden={!showWork}>
          {blocks.map((b, i) =>
            b.kind === "said" ? (
              <div key={b.entry.entry_id} className="said">
                <div className="said__text" dir="auto">
                  <Markdown source={b.entry.text} />
                </div>
              </div>
            ) : (
              <ActionGroup key={`g-${i}-${b.at}`} at={b.at} locale={locale} title={b.title} specialist={b.specialist === null ? null : (agentNames.get(b.specialist) ?? null)} actions={b.actions} expanded={live && i === blocks.length - 1} live={live} onOpen={onOpenAction} />
            ),
          )}
          {live && thinking ? (
            <p className="agent__thinking">
              <span className="working__pulse" aria-hidden="true" />
              <span className="shimmer">{translator.t("ui.work.thinking")}</span>
            </p>
          ) : null}
          {live && !thinking && blocks.length === 0 ? (
            <p className="agent__thinking">
              <span className="working__pulse" aria-hidden="true" />
              <span className="shimmer">{translator.t("ui.work.thinking")}</span>
            </p>
          ) : null}
        </div>

        {pending.map((a) => (
          <article key={a.approval_id} className="feed__message feed__message--approval" aria-label={translator.t("p08.approval.label")}>
            <h3 className="feed__who">{translator.t("p08.approval.title")}</h3>
            <p className="feed__text">{a.context?.expected_effect ?? translator.t("p08.approval.generic", { tool: a.tool_id })}</p>
            <dl className="facts facts--compact">
              <dt>{translator.t("p08.approval.tool")}</dt>
              <dd>{a.tool_id}</dd>
              {a.context === undefined ? null : (
                <>
                  <dt>{translator.t("p08.approval.target")}</dt>
                  <dd>{a.context.target}</dd>
                  <dt>{translator.t("p08.approval.risk")}</dt>
                  <dd>{a.context.risk}</dd>
                </>
              )}
              {a.arguments_preview === undefined ? null : (
                <>
                  <dt>{translator.t("p08.approval.arguments")}</dt>
                  <dd className="mono">{a.arguments_preview}</dd>
                </>
              )}
            </dl>
            <div className="toolbar">
              <button type="button" className="button" onClick={() => onDecide(a.approval_id, "GRANT")}>
                {translator.t("p08.approval.grant")}
              </button>
              <button type="button" className="button button--secondary" title={translator.t("p08.approval.grant_mission_hint")} onClick={() => onDecide(a.approval_id, "GRANT", "MISSION")}>
                {translator.t("p08.approval.grant_mission")}
              </button>
              <button type="button" className="button button--secondary" onClick={() => onDecide(a.approval_id, "DENY")}>
                {translator.t("p08.approval.deny")}
              </button>
            </div>
            {grantRefused === a.approval_id ? (
              <p className="note tone-bad" role="alert">
                {translator.t("p08.approval.grant_mission_refused")}
              </p>
            ) : null}
          </article>
        ))}

        {hasAnswer && (finished || state === "BLOCKED") ? (
          <div className="agent__answer" dir="auto">
            <Markdown source={answer} />
          </div>
        ) : null}
        {finished && !hasAnswer && state === "COMPLETED" ? <p className="agent__muted">{translator.t("ui.answer.none")}</p> : null}
        {(finished || state === "BLOCKED") && turn.failure_reason !== undefined ? <FailureNote reason={turn.failure_reason} /> : null}

        {featured !== null && preview.value !== null && preview.value !== undefined ? (
          <article className="doc-card">
            <header className="doc-card__head">
              <span className="doc-card__icon">
                <Icon name={fileIcon(featured)} size={16} />
              </span>
              <span className="doc-card__heading">
                <button type="button" className="doc-card__title link-button" dir="auto" onClick={() => onOpenFile(featured)}>
                  {files.find((f) => f.path === featured)?.title ?? baseName(featured)}
                </button>
                {/* نوع الملف وحجمه تحت اسمه، كبطاقة الملف في مانوس («نص · 8 B»). */}
                <span className="doc-card__meta">
                  {translator.t(`p08.preview.kind.${preview.value.kind}`)}
                  {` · ${formatBytes(preview.value.size_bytes)}`}
                </span>
              </span>
              {exported === null ? null : <span className="doc-card__note">{exported}</span>}
              <button
                type="button"
                className="icon-button"
                aria-label={translator.t("ui.files.export", { name: baseName(featured) })}
                title={translator.t("ui.files.export", { name: baseName(featured) })}
                onClick={() => void onExport(featured).then((r) => setExported(translator.t(r.ok ? "ui.file.exported_short" : "ui.files.export_failed")))}
              >
                <Icon name="download" size={16} />
              </button>
              <button type="button" className="icon-button" aria-label={translator.t("ui.file.open")} title={translator.t("ui.file.open")} onClick={() => onOpenFile(featured)}>
                <Icon name="more" size={16} />
              </button>
            </header>
            <div className={preview.value.kind === "HTML" ? "doc-card__body doc-card__body--frame" : "doc-card__body"}>
              {preview.value.kind === "HTML" ? (
                <iframe className="doc-card__frame" sandbox="" srcDoc={preview.value.text ?? ""} title={baseName(featured)} />
              ) : /\.(md|markdown)$/i.test(featured) ? (
                <Markdown source={preview.value.text ?? ""} />
              ) : (
                <pre className="preview__text" dir="auto">
                  {preview.value.text ?? ""}
                </pre>
              )}
            </div>
          </article>
        ) : null}

        {excerptCard === undefined ? null : (
          <article className="doc-card">
            <header className="doc-card__head">
              <span className="doc-card__icon">
                <Icon name={fileIcon(excerptCard.file_ref)} size={16} />
              </span>
              <button type="button" className="doc-card__title link-button" dir="auto" onClick={() => onOpenFile(excerptCard.file_ref)}>
                {excerptCard.title}
              </button>
              <button type="button" className="icon-button" aria-label={translator.t("ui.file.open")} title={translator.t("ui.file.open")} onClick={() => onOpenFile(excerptCard.file_ref)}>
                <Icon name="more" size={16} />
              </button>
            </header>
            <div className="doc-card__body">
              <p className="doc-card__excerpt" dir="auto">
                {String((excerptCard.preview as { excerpt?: unknown }).excerpt).slice(0, 1200)}
              </p>
            </div>
          </article>
        )}

        {files.filter((f) => f.path !== featured && f.key !== excerptCard?.artifact_id).length === 0 ? null : (
          <ul className="deliverables" aria-label={translator.t("p08.computer.artifacts")}>
            {files
              .filter((f) => f.path !== featured && f.key !== excerptCard?.artifact_id)
              .map((f) => (
                <li key={f.key}>
                  <button type="button" className="deliverable" onClick={() => onOpenFile(f.path)}>
                    <span className="artifact__icon">
                      <Icon name={fileIcon(f.path)} />
                    </span>
                    <span className="deliverable__text">
                      <span className="deliverable__title" dir="auto">
                        {f.title}
                      </span>
                      <span className="deliverable__meta">{f.meta}</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        {files.length > 1 ? (
          <button type="button" className="link-button files-all" onClick={onAllFiles}>
            <Icon name="library" size={15} />
            <span>{translator.t("ui.files.all")}</span>
          </button>
        ) : null}

        {finished ? (
          <div className="agent__done">
            <p className={`agent__status tone-${state === "COMPLETED" ? "ok" : "bad"}`}>
              <Icon name={state === "COMPLETED" ? "check" : "shield"} size={15} />
              <span>{state === "COMPLETED" ? translator.t("ui.done.completed") : translator.t(`p03.mission_state.${state}`)}</span>
            </p>
            {/* الإثبات يُذكر حين يعني شيئًا: «تحقّق POLARIS» إن أُثبت، و«لم يُتحقَّق آليًا» لمخرجات لم تُثبَت.
                ردّ محادثة بلا مخرجات لا متطلَّب فيه يُثبت، فلا تُعلَّق عليه «غير مُثبَت» (قيس 2026-10-01: مربكة). */}
            {turn.completion_proof_status === "PROVEN" ? (
              <span className="agent__proof is-proven" title={translator.t("p03.proof.hint.PROVEN")}>
                <Icon name="shield" size={13} />
                {translator.t("ui.proof.proven")}
              </span>
            ) : turn.completion_proof_status === "NOT_PROVEN" &&
              artifacts.length > 0 &&
              artifacts.every((a) => a.verification.status === "VERIFIED") &&
              outputFiles.every((f) => artifacts.some((a) => a.file_ref === f.path)) ? (
              // كل ملف أعاد المضيف فتحه وفحصه: يُقال هذا بدقّة، ولا يُقال إن المحتوى صحيح (قِيس 2026-10-05: مستند
              // اجتاز ثمانية فحوص وظهر بجانبه «لم يُتحقَّق منه آليًّا»).
              <span className="agent__proof is-files" title={translator.t("ui.proof.files_hint")}>
                <Icon name="check" size={13} />
                {translator.t("ui.proof.files_checked")}
              </span>
            ) : turn.completion_proof_status === "NOT_PROVEN" && (artifacts.length > 0 || outputFiles.length > 0) ? (
              <span className="agent__proof" title={translator.t("p03.proof.hint.NOT_PROVEN")}>
                {translator.t("ui.proof.unverified")}
              </span>
            ) : null}
            {hasAnswer ? (
              <button type="button" className="icon-button" aria-label={translator.t(copied ? "ui.copied" : "ui.copy")} title={translator.t(copied ? "ui.copied" : "ui.copy")} onClick={() => void copyAnswer()}>
                <Icon name={copied ? "check" : "copy"} size={15} />
              </button>
            ) : null}
            <span className="agent__spacer" />
            {state === "COMPLETED" ? (
              <span className="rating" role="group" aria-label={translator.t("ui.rating.label")}>
                <span className="rating__label">{translator.t("ui.rating.label")}</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={n <= rating ? "rating__star is-on" : "rating__star"}
                    aria-label={translator.t("ui.rating.star", { count: n })}
                    aria-pressed={n <= rating}
                    onClick={() => {
                      const previous = rating;
                      setRating(n);
                      // يُحفظ في قاعدة التطبيق على هذا الجهاز (E-5)؛ رفضه يعيد ما كان، فلا تُعرض نجمة لم تُحفظ.
                      void phase08.rateMission(turn.mission_id, n).then((stored) => {
                        if (!stored.ok) setRating(previous);
                      });
                    }}
                  >
                    ★
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
        {onSuggest !== undefined && finished && suggestions.length > 0 ? (
          <ul className="suggestions" aria-label={translator.t("ui.suggestions.label")}>
            {suggestions.map((s) => (
              <li key={s.entry_id}>
                <button type="button" className="suggestion" onClick={() => onSuggest(s.text)}>
                  <Icon name="chat" size={14} className="suggestion__icon" />
                  <span className="suggestion__text" dir="auto">
                    {s.text}
                  </span>
                  <Icon name="arrow-side" size={14} className="suggestion__go" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}

/**
 * سبب التوقّف بلغة المستخدم: رمز المضيف (قبل النقطتين) يُترجم جملةً، والنصّ التقني كما قاله المضيف تحت «التفاصيل»
 * (قِيس 2026-10-05: المستخدم العربي كان يرى «MODEL_OUTPUT_INVALID: …» خامًا). رمز لا ترجمة له يُعرض كما هو.
 */
/** تقرير الوكيل المفوَّض إلى المنسّق (`outputs/agents/<مجال>/<وكيل>/report.md`) عمل داخلي لا مُخرَج طلبه المستخدم (قِيس
 *  2026-11-13: طلب تلخيص رُفض فظهرت بطاقة report.md بعناوين إنجليزية). يبقى في «الملفات» ولا يُعرض بطاقةً في المحادثة. */
export function isInternalAgentReport(path: string): boolean {
  return /^outputs\/agents\/[^/]+\/[^/]+\/report\.md$/.test(path);
}

export function FailureNote({ reason }: { readonly reason: string }) {
  const translator = useTranslator();
  const code = reason.split(":")[0]?.trim() ?? "";
  // رصيد المزوّد (402، 2026-11-13): ما حدث بالأرقام، وما يفعله المستخدم، وزرّ إلى اختيار نموذج آخر.
  if (code === "PROVIDER_CREDIT_EXHAUSTED") return <CreditNote reason={reason} />;
  // سبب رفض التوجيه بعينه، إن سمّاه المضيف («invocation denied: MODEL_DISABLED»): جملة تقول ما يُغيَّر وأين (2026-10-06).
  const route = /invocation denied: ([A-Z_]+)/.exec(reason)?.[1] ?? "";
  const routeKey = `p03.route.${route}`;
  // حدّ المزوّد (429) يُقال باسمه: ما حدث وما يفعله المستخدم، لا «لم يستجب المزوّد».
  const key = reason.includes("RATE_LIMITED") ? "p03.stop.RATE_LIMITED" : route !== "" && translator.has(routeKey) ? routeKey : `p03.stop.${code}`;
  const known = /^[A-Z_]+$/.test(code) && translator.has(key);
  return (
    <div className="agent__failure" dir="auto">
      <p className="agent__failure-text">{known ? translator.t(key) : reason}</p>
      {known ? (
        <details className="agent__failure-details">
          <summary>{translator.t("ui.failure.details")}</summary>
          <code dir="ltr">{reason}</code>
        </details>
      ) : null}
    </div>
  );
}

function CreditNote({ reason }: { readonly reason: string }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const [, needed = "", afford = ""] = reason.split(":").map((x) => x.trim());
  return (
    <div className="agent__failure agent__failure--credit" dir="auto" role="alert">
      <p className="agent__failure-title">{translator.t("p03.credit.title")}</p>
      <p className="agent__failure-text">{translator.t("p03.credit.body", { needed: needed === "" ? "?" : needed, afford: afford === "" ? "0" : afford })}</p>
      <ul className="agent__failure-steps">
        <li>{translator.t("p03.credit.step.topup")}</li>
        <li>{translator.t("p03.credit.step.model")}</li>
      </ul>
      <button type="button" className="button button--secondary" onClick={() => navigation.navigate("/providers")}>
        {translator.t("p03.credit.action")}
      </button>
    </div>
  );
}

/** مجموعة أفعال: سطر عدّاد مكتوم («تم تشغيل أمر واحد · تصفّح صفحتين ›»)، وتحته الفعل الجاري أثناء العمل. */
function ActionGroup({ at, locale, title, specialist, actions, expanded, live, onOpen }: { readonly at: string; readonly locale: LocaleCode; readonly title: string | null; readonly specialist: string | null; readonly actions: readonly ConversationEntryV1[]; readonly expanded: boolean; readonly live: boolean; onOpen(entry: ConversationEntryV1): void }) {
  const translator = useTranslator();
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? false;
  const buckets = { wrote: 0, ran: 0, browsed: 0, read: 0, other: 0 };
  for (const a of actions) buckets[kindOf(parseAction(a).toolId).bucket] += 1;
  // سطر العدّ كما في مانوس: «حرّر ملفًّا واحدًا · تم تشغيل أمر واحد»، بصيغ الجمع العربية.
  const tally = (["wrote", "ran", "browsed", "read"] as const).filter((b) => buckets[b] > 0).map((b) => translator.plural(`ui.work.n.${b}`, buckets[b]));
  const current = actions[actions.length - 1];
  const row = (a: ConversationEntryV1) => {
    const { toolId, target } = parseAction(a);
    const kind = kindOf(toolId);
    const status = a.detail ?? "";
    const tone = status.startsWith("SUCCEEDED") ? "ok" : status.startsWith("DENIED") || status.startsWith("FAILED") ? "bad" : "neutral";
    const verbKey = rowVerbKey(toolId);
    const opens = focusOf(a) !== null;
    void kind;
    return (
      <button type="button" className={`actions__item tone-${tone}${opens ? " is-open-able" : ""}`} disabled={!opens} onClick={() => onOpen(a)}>
        <Icon name={rowIcon(toolId, target)} size={14} className="actions__icon" />
        <span className="actions__verb">{translator.has(verbKey) ? translator.t(verbKey) : translator.t(activityKey(toolId), { tool: toolId })}</span>
        {target === "" ? null : (
          <span className="actions__summary" dir="auto">
            {toolId.startsWith("polaris.workspace.") || toolId.startsWith("polaris.artifact.") ? baseName(target) : target}
          </span>
        )}
        {tone === "bad" ? <span className="actions__meta">{status}</span> : null}
      </button>
    );
  };
  return (
    <div className="action-group">
      {title === null ? null : (
        <p className="step__said" dir="auto">
          <span className="step__mark" aria-hidden="true" />
          <span>{title}</span>
          {specialist === null ? null : (
            <span className="step__agent" title={translator.t("nav.agents")}>
              <Icon name="user" size={12} />
              {specialist}
            </span>
          )}
        </p>
      )}
      {actions.length === 0 ? null : (
        <>
          <button type="button" className="action-group__tally" aria-expanded={shown} onClick={() => setOpen(!shown)}>
            <span>{tally.length === 0 ? translator.t("ui.plan.actions", { count: actions.length }) : tally.join(" · ")}</span>
            <Icon name="chevron" size={13} className="worked__chevron" />
            {/* وقت الخطوة في نهاية سطرها، كما في مانوس 2.0 */}
            {at === "" ? null : (
              <time className="action-group__time" dateTime={at}>
                {formatTime(locale, at)}
              </time>
            )}
          </button>
          {/* كل الأفعال في المستند (تُقرأ ويُبحث فيها)؛ المطويّ منها مخفيّ، والجاري ظاهر أثناء العمل. */}
          <ul className="actions">
            {actions.map((a) => (
              <li key={a.entry_id} className="actions__slot" hidden={!shown && !(expanded && live && a === current)}>
                {row(a)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** حاسوب POLARIS: لوح يقسم الشاشة. الطرفية تُعرض لقطةً لقطة من سجلّ التشغيلات المقيس، بشريط زمني. */
function ComputerPanel({
  missionId,
  threadId,
  focus,
  side,
  onSide,
  live,
  runs,
  lastRun,
  lastAction,
  phase05,
  phase08,
  refreshKey,
  onClose,
}: {
  readonly missionId: string;
  readonly threadId: string;
  readonly focus: ComputerFocus | null;
  readonly side: Side;
  onSide(side: Side): void;
  readonly live: boolean;
  readonly runs: ExecutionRunsResultV1["runs"];
  readonly lastRun: ExecutionRunsResultV1["runs"][number] | undefined;
  readonly lastAction: ConversationEntryV1 | undefined;
  readonly phase05?: Phase05Client | undefined;
  readonly phase08: Phase08Client;
  readonly refreshKey: string;
  onClose(): void;
}) {
  const translator = useTranslator();
  const frames = [...runs].reverse();
  const [at, setAt] = useState<number | null>(null);
  // أمر نقره المستخدم في المحادثة: تُعرض لقطته هو، لا آخر لقطة.
  const wanted = focus?.side === "terminal" && focus.command !== "" ? frames.findIndex((f) => (f.command_preview.split("\n").find((l) => l.trim() !== "") ?? "").trim().startsWith(focus.command.slice(0, 60).trim())) : -1;
  useEffect(() => {
    if (wanted >= 0) setAt(wanted >= frames.length - 1 ? null : wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, focus]);
  const filePath = focus?.side === "files" ? focus.path : null;
  const index = at === null ? frames.length - 1 : Math.min(at, frames.length - 1);
  const frame = frames[index];
  const following = at === null;
  // الملفات هنا شجرة المساحة كما يراها الوكيل أثناء العمل؛ المخرجات المسلَّمة في «كل الملفات» وفي الردّ نفسه.
  const sides: readonly Side[] = phase05 === undefined ? ["terminal", "files"] : ["terminal", "browser", "files"];
  const using = lastAction === undefined ? null : parseAction(lastAction);
  return (
    <aside className="computer" aria-label={translator.t("p08.computer.label")}>
      <header className="computer__head">
        <div className="computer__heading">
          <span className="computer__title">{translator.t("ui.computer.title")}</span>
          <span className="computer__activity" dir="auto">
            {side === "terminal" && lastRun !== undefined
              ? translator.t("ui.computer.using_terminal", { command: lastRun.command_preview.split("\n")[0] ?? "" })
              : using !== null
                ? translator.t(activityKey(using.toolId), { tool: using.toolId })
                : translator.t("ui.computer.idle")}
          </span>
        </div>
        <button type="button" className="icon-button" aria-label={translator.t("ui.computer.close")} title={translator.t("ui.computer.close")} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="segmented" role="tablist" aria-label={translator.t("p08.computer.label")}>
        {sides.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={side === s} className={`segmented__item${side === s ? " is-current" : ""}`} onClick={() => onSide(s)}>
            {translator.t(`p08.computer.${s}`)}
          </button>
        ))}
      </div>
      <div className="computer__body">
        {side === "terminal" ? (
          <div className="term" dir="ltr">
            {frame === undefined ? (
              <p className="term__empty">{translator.t("p08.terminal.empty")}</p>
            ) : (
              <>
                <pre className="term__line">
                  <span className="term__prompt">{frame.runtime === "PYTHON" ? ">>> " : "PS> "}</span>
                  {frame.command_preview}
                </pre>
                {frame.output_excerpt.trim() === "" ? null : <pre className="term__out run__output">{frame.output_excerpt}</pre>}
                <p className="term__meta">{`${translator.t(`p08.run.${frame.status}`)} · ${translator.t("p08.run.exit", { code: frame.exit_code ?? "—" })} · ${formatDuration(frame.duration_ms)}`}</p>
              </>
            )}
          </div>
        ) : null}
        {side === "files" && filePath !== null ? <FileView phase08={phase08} missionId={threadId} path={filePath} /> : null}
        {side === "files" && filePath === null ? <FilesPanel client={phase08} missionId={missionId} refreshKey={refreshKey} /> : null}
        {side === "browser" && phase05 !== undefined ? <BrowserSessions client={phase05} missionId={missionId} /> : null}
      </div>
      {side === "terminal" ? (
        <footer className="timeline">
          <button type="button" className="icon-button" aria-label={translator.t("ui.computer.previous")} disabled={frames.length === 0 || index <= 0} onClick={() => setAt(Math.max(0, index - 1))}>
            <Icon name="chevron" size={14} className="flip-prev" />
          </button>
          <button type="button" className="icon-button" aria-label={translator.t("ui.computer.next")} disabled={frames.length === 0 || index >= frames.length - 1} onClick={() => setAt(index + 1 >= frames.length - 1 ? null : index + 1)}>
            <Icon name="chevron" size={14} className="flip-next" />
          </button>
          <input
            type="range"
            className="timeline__range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={Math.max(0, index)}
            aria-label={translator.t("ui.computer.timeline")}
            disabled={frames.length < 2}
            onChange={(event) => {
              const next = Number(event.target.value);
              setAt(next >= frames.length - 1 ? null : next);
            }}
          />
          {following ? (
            <span className={live ? "timeline__live is-live" : "timeline__live"}>
              <span className="timeline__dot" aria-hidden="true" />
              {translator.t("ui.computer.live")}
            </span>
          ) : (
            <button type="button" className="button button--secondary timeline__jump" onClick={() => setAt(null)}>
              {translator.t("ui.computer.jump_live")}
            </button>
          )}
        </footer>
      ) : null}
    </aside>
  );
}

/** الملف المفتوح في لوح الحاسوب: رأس بالاسم، ثم المحتوى (Markdown منسّقًا، وHTML في إطار معزول، وغيره نصًّا). */
function FileView({ phase08, missionId, path }: { readonly phase08: Phase08Client; readonly missionId: string; readonly path: string }) {
  const translator = useTranslator();
  const preview = useHostQuery(() => phase08.previewFile(missionId, path, 40_000), [phase08, missionId, path]);
  const text = preview.value?.text ?? "";
  return (
    <div className="fileview">
      <header className="fileview__head">
        <Icon name="folder" size={15} className="fileview__folder" />
        <span className="fileview__name" dir="ltr">
          {baseName(path)}
        </span>
      </header>
      <div className="fileview__body">
        {preview.error !== null ? <p className="term__empty">{translator.t("ui.files.unreadable")}</p> : null}
        {preview.value?.kind === "HTML" ? (
          <iframe className="fileview__frame" sandbox="" srcDoc={text} title={baseName(path)} />
        ) : /\.(md|markdown)$/i.test(path) ? (
          <div className="fileview__doc" dir="auto">
            <Markdown source={text} />
          </div>
        ) : (
          <pre className="preview__text" dir="auto">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}

/** «جميع الملفات في هذه المهمّة»: حوار وسط الشاشة بألسنة (الكل، مستندات، شيفرة)، وتصدير نسخة من كل ملف. */
function FilesDialog({ artifacts, outputFiles, onOpen, onExport, onClose }: { readonly artifacts: readonly ArtifactV1[]; readonly outputFiles: readonly { readonly path: string; readonly size: number }[]; onOpen(path: string): void; onExport(path: string): void; onClose(): void }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const [tab, setTab] = useState<"all" | "docs" | "code">("all");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.document?.addEventListener("keydown", onKey);
    return () => globalThis.document?.removeEventListener("keydown", onKey);
  }, [onClose]);
  const rows = [
    ...artifacts.map((a) => ({ key: a.artifact_id, path: a.file_ref, title: a.title, meta: formatInstant(locale, a.created_at) })),
    ...outputFiles.map((f) => ({ key: f.path, path: f.path, title: baseName(f.path), meta: formatBytes(f.size) })),
  ].filter((r) => (tab === "all" ? true : tab === "code" ? fileIcon(r.path) === "code" || fileIcon(r.path) === "web" : fileIcon(r.path) !== "code"));
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog files-dialog" role="dialog" aria-modal="true" aria-label={translator.t("ui.files.all")}>
        <header className="dialog__head">
          <h2 className="dialog__title">{translator.t("ui.files.all")}</h2>
          <button type="button" className="icon-button" aria-label={translator.t("ui.close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="segmented" role="tablist">
          {(["all", "docs", "code"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`segmented__item${tab === t ? " is-current" : ""}`} onClick={() => setTab(t)}>
              {translator.t(`ui.files.tab.${t}`)}
            </button>
          ))}
        </div>
        <ul className="files-dialog__list">
          {rows.length === 0 ? <li className="panel__empty">{translator.t("ui.files.none")}</li> : null}
          {rows.map((r) => (
            <li key={r.key} className="files-dialog__row">
              <button type="button" className="files-dialog__open" onClick={() => onOpen(r.path)}>
                <span className="artifact__icon">
                  <Icon name={fileIcon(r.path)} size={16} />
                </span>
                <span className="files-dialog__name" dir="auto">
                  {r.title}
                </span>
                <span className="files-dialog__meta">{r.meta}</span>
              </button>
              <button type="button" className="icon-button" aria-label={translator.t("ui.files.export", { name: r.title })} title={translator.t("ui.files.export", { name: r.title })} onClick={() => onExport(r.path)}>
                <Icon name="arrow-up" size={15} className="flip-down" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** عارض المستند: حوار كبير يعرض الملف منسّقًا. Escape لا يغلقه (كما في مانوس)؛ زرّ الإغلاق يغلقه. */
function DocumentViewer({ missionId, path, phase08, onClose }: { readonly missionId: string; readonly path: string; readonly phase08: Phase08Client; onClose(): void }) {
  const translator = useTranslator();
  const preview = useHostQuery(() => phase08.previewFile(missionId, path, 40_000), [phase08, missionId, path]);
  const [exported, setExported] = useState<string | null>(null);
  const text = preview.value?.text ?? "";
  return (
    <div className="dialog-backdrop">
      <div className="dialog viewer" role="dialog" aria-modal="true" aria-label={baseName(path)}>
        <header className="dialog__head">
          <span className="doc-card__icon">
            <Icon name={fileIcon(path)} size={16} />
          </span>
          <div className="viewer__heading">
            <h2 className="dialog__title" dir="auto">
              {baseName(path)}
            </h2>
            <span className="viewer__meta">{preview.value === null || preview.value === undefined ? "" : `${preview.value.mime_type} · ${formatBytes(preview.value.size_bytes)}`}</span>
          </div>
          <span className="topbar__spacer" />
          {exported === null ? null : <span className="viewer__meta">{exported}</span>}
          <button
            type="button"
            className="icon-button"
            aria-label={translator.t("ui.files.export", { name: baseName(path) })}
            title={translator.t("ui.files.export", { name: baseName(path) })}
            onClick={() => void phase08.exportFile(missionId, path).then((r) => setExported(r.ok ? translator.t("ui.files.exported", { name: r.value.file_label }) : translator.t("ui.files.export_failed")))}
          >
            <Icon name="arrow-up" size={16} className="flip-down" />
          </button>
          <button type="button" className="icon-button" aria-label={translator.t("ui.close")} title={translator.t("ui.close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="viewer__body">
          {preview.value?.kind === "HTML" ? (
            <iframe className="preview__frame" sandbox="" srcDoc={text} title={baseName(path)} />
          ) : /\.(md|markdown)$/i.test(path) ? (
            <div className="viewer__doc" dir="auto">
              <Markdown source={text} />
            </div>
          ) : (
            <pre className="preview__text" dir="auto">
              {text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/** مدّة العمل كما يكتبها مانوس: «22s» و«1m 16s» و«1h 4m». */
function workedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatTime(locale: LocaleCode, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(d);
}

/** تقييم قديم من قبل E-5، حُفظ في localStorage وحده. يُقرأ لنقله مرة واحدة إلى قاعدة التطبيق. */
function readLegacyRating(missionId: string): number {
  try {
    return Number(globalThis.localStorage?.getItem(`polaris.rating.${missionId}`) ?? "0") || 0;
  } catch {
    return 0;
  }
}

function forgetLegacyRating(missionId: string): void {
  try {
    globalThis.localStorage?.removeItem(`polaris.rating.${missionId}`);
  } catch {
    // لا شيء يُحذف
  }
}
