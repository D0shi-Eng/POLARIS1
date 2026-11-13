// تفاصيل المهمّة: ترويسة تحمل الحالة والإثبات معًا، ثم ستّ ألسنة.
//
// الألسنة مبنيّة بنمط `tablist/tab/tabpanel` الكامل: تنقّل بالأسهم، وتركيز مرئي،
// وعلاقة `aria-controls` صريحة (البند 91). والترويسة لا تعرض الحالة وحدها أبدًا:
// «اكتملت» تُقرأ نجاحًا إن لم يكن الإثبات بجوارها.
//
// القراءة تحدث عند الدخول وعند فعل تحكّم وعند طلب التحديث، ولا شيء رابع. المهمّة
// تتغيّر خارج هذه الشاشة — بدء من مكان آخر، أو انتهاء تشغيل طويل — فالمعروض قد
// يكون قديمًا. وقِدَم المعروض ليس عيبًا بذاته؛ العيب أن يبدو المعروضُ حاضرًا. لذا
// زرّ تحديث صريح يعيد قراءة كل ما تعرضه الشاشة معًا، فلا يُخلط لسانٌ حديث بآخر قديم.

import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { Phase03Client } from "../../ipc/p03-client";
import type { Phase04Client } from "../../ipc/p04-client";
import { canCancel, canResume, canStart, missionStateTone, proofTone } from "../../p03/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { AgentsScreen } from "./AgentsScreen";
import { MissionActivityTab } from "./MissionActivityTab";
import { MissionClaimsTab } from "./MissionClaimsTab";
import { MissionEvidenceTab } from "./MissionEvidenceTab";
import { MissionOverviewTab } from "./MissionOverviewTab";
import { MissionTasksTab } from "./MissionTasksTab";
import { StateAndProof } from "./StatusPill";
import { MissionToolsTab } from "../p04/MissionToolsTab";
import type { Phase05Client } from "../../ipc/p05-client";
import { BrowserSessions, ComputerSessions, WindowGrants } from "../p05/BrowserComputerScreen";
import { MemoryPanel } from "../p05/MemoryScreen";
import type { Phase08Client } from "../../ipc/p08-client";
import { MissionWorkspace } from "../p08/MissionWorkspace";
import { Icon } from "../../ui/components/Icon";
import type { Phase02Client } from "../../ipc/p02-client";
import { useNavigation } from "../../app/context";
import { stateOf, useThreadStates } from "../../p08/threads";
import { ThreadMenu } from "../../ui/components/ThreadMenu";
import { useProjectsChanged } from "../../ui/components/ProjectDialogs";
import type { ProjectListResultV1 } from "../../generated/types/desktop-p02-result-v1";

/// لسان الأدوات يُضاف حين يكون عميل Phase-04 موجودًا. غيابه لا يُخفي اللسان
/// صامتًا: القائمة تُبنى من الموجود، فلا يظهر لسان لا يستطيع أن يقرأ شيئًا.
const BASE_TABS = ["overview", "tasks", "agents", "claims", "evidence", "activity"] as const;
type TabId = (typeof BASE_TABS)[number] | "tools" | "memory" | "browser" | "computer" | "work";

export function MissionDetailScreen({
  client,
  phase02,
  phase04,
  phase05,
  missionId,
  phase08,
}: {
  readonly client: Phase03Client;
  /// عميل Phase-02: محدّد النموذج في أعلى المحادثة.
  readonly phase02?: Phase02Client | undefined;
  /// عميل Phase-08: يضيف مساحة المهمّة (النشاط، والملفات، والمخرجات، والطرفيّة، والمتصفّح) لسانًا أول.
  readonly phase08?: Phase08Client | undefined;
  /// عميل Phase-04. غيابه يعني أن لسان الأدوات لا يُعرض.
  readonly phase04?: Phase04Client | undefined;
  /// عميل Phase-05. غيابه يعني أن ألسنة الذاكرة والمتصفّح والحاسوب لا تُعرض.
  readonly phase05?: Phase05Client | undefined;
  readonly missionId: string;
}) {
  const translator = useTranslator();
  const action = useAction();
  const [tab, setTab] = useState<TabId>(phase08 === undefined ? "overview" : "work");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const navigation = useNavigation();
  const [showDetails, setShowDetails] = useState(false);
  // قائمة «⋯» كما في مانوس: حالة المحادثة من المضيف، والمشاريع لبند «نقل إلى المشروع».
  const threadStates = useThreadStates(phase08);
  const [projects, setProjects] = useState<ProjectListResultV1["projects"]>([]);
  const [projectsTick, setProjectsTick] = useState(0);
  useProjectsChanged(useCallback(() => setProjectsTick((t) => t + 1), []));
  useEffect(() => {
    if (phase02 === undefined || phase08 === undefined) return;
    let alive = true;
    void phase02.listProjects().then((result) => {
      if (alive && result.ok) setProjects(result.value.projects);
    });
    return () => {
      alive = false;
    };
  }, [phase02, phase08, projectsTick]);

  const tabs: readonly TabId[] = [
    ...(phase08 === undefined ? [] : (["work"] as const)),
    ...BASE_TABS.slice(0, 5),
    ...(phase04 === undefined ? [] : (["tools"] as const)),
    ...(phase05 === undefined ? [] : (["memory", "browser", "computer"] as const)),
    BASE_TABS[5] as TabId,
  ];

  // في المحادثة تتبع الترويسة وأفعالها الدورَ الأخير (المتابعة مهمّة Phase-03 مستقلّة بحالتها وإثباتها).
  const [activeId, setActiveId] = useState(missionId);
  const detailQuery = useHostQuery(() => client.getMission(activeId), [client, activeId, action.state]);
  const tasksQuery = useHostQuery(() => client.listTasks(activeId), [client, activeId, action.state]);
  const claimsQuery = useHostQuery(() => client.listClaims(activeId), [client, activeId, action.state]);
  const evidenceQuery = useHostQuery(() => client.listEvidence(activeId), [client, activeId, action.state]);

  /// إعادة قراءة كل ما تعرضه الشاشة معًا. جزئيًّا تعني ترويسة من لحظة وألسنة من أخرى.
  function refresh(): void {
    detailQuery.reload();
    tasksQuery.reload();
    claimsQuery.reload();
    evidenceQuery.reload();
  }

  const detail = detailQuery.value;
  const state = detail?.mission.state ?? "CREATED";
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    if (cancelling && ["CANCELLED", "COMPLETED", "FAILED"].includes(state)) setCancelling(false);
  }, [cancelling, state]);
  // أثناء الإلغاء تُعاد قراءة الحالة حتى تصل الحالة النهائية، فلا يبقى «جارٍ الإلغاء…» معلّقًا.
  useEffect(() => {
    if (!cancelling) return;
    const id = setInterval(() => detailQuery.reload(), 1500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelling]);

  /// تنقّل لوحة المفاتيح بين الألسنة: أسهم، وبداية، ونهاية.
  function onTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = tabs.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next] as TabId;
    setTab(target);
    tabRefs.current[target]?.focus();
  }

  // مع مساحة العمل (Phase-08) المحادثة هي الصفحة؛ الألسنة التفصيلية (العقد والأدلّة والتدقيق) خلف «التفاصيل».
  const conversation = phase08 !== undefined;
  return (
    <div className={conversation ? "mission-page is-conversation" : "mission-page"}>
      <div className="task-bar">
      <h1 className={conversation ? "page-title task-bar__title visually-hidden-title" : "page-title task-bar__title"} dir="auto">{detail?.mission.title ?? translator.t("mission.detail.title")}</h1>
      {detail === null ? null : (
        <p className={conversation ? "page-subtitle task-bar__state visually-hidden-title" : "page-subtitle task-bar__state"}>
          <StateAndProof
            state={detail.mission.state}
            proof={detail.completion_proof.status}
            stateTone={missionStateTone(detail.mission.state)}
            proofToneValue={proofTone(detail.completion_proof.status)}
          />
        </p>
      )}

      {conversation ? (
        <div className="task-bar__tools">
          {/* مانوس 2.0: أدوات الترويسة أيقونات بتلميح، لا نصوص. الاسم يبقى مقروءًا لقارئ الشاشة. */}
          <button type="button" className="icon-button task-bar__details" aria-expanded={showDetails} title={translator.t(showDetails ? "ui.details.hide" : "ui.details.show")} onClick={() => setShowDetails((open) => !open)}>
            <Icon name={showDetails ? "missions" : "list"} size={16} />
            <span className="visually-hidden">{translator.t(showDetails ? "ui.details.hide" : "ui.details.show")}</span>
          </button>
          {phase08 === undefined || detail === null ? null : (
            <ThreadMenu
              thread={stateOf(threadStates, missionId, detail.mission.title, detail.mission.project_id)}
              phase08={phase08}
              phase02={phase02}
              projects={projects}
              moveAs="inline"
              align="end"
              onDeleted={() => navigation.navigate("/")}
            />
          )}
        </div>
      ) : null}
      {/* في المحادثة أفعال التشغيل التقنية (بدء، إيقاف، استئناف، تحديث) تظهر مع «التفاصيل»، وتبقى في المستند
          مخفية حين تُطوى لقارئ الشاشة والاختبارات. قائمة «⋯» لإدارة المحادثة كما في مانوس. */}
      <div className={conversation ? "toolbar task-bar__actions task-menu" : "toolbar task-bar__actions"} hidden={conversation && !showDetails}>
        <button
          type="button"
          className="button button--secondary"
          disabled={!canStart(state) || action.state.phase === "RUNNING"}
          onClick={() =>
            void action.run(
              () => client.startMission(activeId),
              () => ({ phase: "DONE", messageKey: "mission.action.started" }),
            )
          }
        >
          {translator.t("mission.action.start")}
        </button>
        <button
          type="button"
          className="button button--secondary"
          // الإيقاف متاح أثناء تشغيل بدأ من هذه الشاشة نفسها، ولا يُضغط مرتين (Phase-08).
          disabled={!canCancel(state) || cancelling}
          aria-busy={cancelling}
          onClick={() => {
            if (cancelling) return;
            setCancelling(true);
            void client.cancelMission(activeId).then(() => refresh());
          }}
        >
          {translator.t(cancelling && state !== "CANCELLED" ? "mission.action.cancelling" : "mission.action.cancel")}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={!canResume(state) || action.state.phase === "RUNNING"}
          onClick={() =>
            void action.run(
              () => client.resumeMission(activeId),
              (value) => ({
                phase: "DONE",
                messageKey: "mission.action.resumed",
                values: { count: value.tasks_interrupted },
              }),
            )
          }
        >
          {translator.t("mission.action.resume")}
        </button>
        <button type="button" className="button button--secondary" onClick={refresh} disabled={detailQuery.loading}>
          {translator.t("mission.action.refresh")}
        </button>
      </div>
      </div>
      <ActionNote state={action.state} />

      {detailQuery.loading ? <StateBlock kind="loading" /> : null}
      {detailQuery.error !== null ? <ErrorNote error={detailQuery.error} onRetry={detailQuery.reload} /> : null}

      <div className="tabs" role="tablist" aria-label={translator.t("mission.detail.title")} hidden={conversation && !showDetails}>
        {tabs.map((id, index) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`mission-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`mission-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className="tabs__tab"
            ref={(element) => {
              tabRefs.current[id] = element;
            }}
            onClick={() => setTab(id)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            {translator.t(`mission.tab.${id}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`mission-panel-${tab}`} aria-labelledby={`mission-tab-${tab}`} tabIndex={0}>
        {tab === "work" && phase08 !== undefined ? <MissionWorkspace
            missionId={missionId}
            phase02={phase02}
            phase03={client}
            phase04={phase04}
            phase05={phase05}
            phase08={phase08}
            onStateChange={(_, active) => {
              if (active !== activeId) setActiveId(active);
              else refresh();
            }}
          /> : null}
        {tab === "overview" && detail !== null ? <MissionOverviewTab detail={detail} /> : null}
        {tab === "tasks" && tasksQuery.value !== null ? <MissionTasksTab tasks={tasksQuery.value} /> : null}
        {tab === "agents" ? <AgentsScreen client={client} missionId={missionId} /> : null}
        {tab === "claims" && claimsQuery.value !== null ? <MissionClaimsTab claims={claimsQuery.value} /> : null}
        {tab === "evidence" && evidenceQuery.value !== null ? (
          <MissionEvidenceTab evidence={evidenceQuery.value} />
        ) : null}
        {tab === "tools" && phase04 !== undefined ? <MissionToolsTab client={phase04} missionId={missionId} /> : null}
        {tab === "memory" && phase05 !== undefined ? <MemoryPanel client={phase05} missionId={missionId} /> : null}
        {tab === "browser" && phase05 !== undefined ? <BrowserSessions client={phase05} missionId={missionId} /> : null}
        {tab === "computer" && phase05 !== undefined ? (
          <>
            <ComputerSessions client={phase05} missionId={missionId} />
            <WindowGrants client={phase05} missionId={missionId} />
          </>
        ) : null}
        {tab === "activity" && detail !== null && tasksQuery.value !== null ? (
          <MissionActivityTab detail={detail} tasks={tasksQuery.value} />
        ) : null}
      </div>
      {/* لوحات التبويبات غير المختارة موجودة مخفية فارغة، فيبقى مرجع aria-controls لكل تبويب سليمًا. */}
      {tabs
        .filter((id) => id !== tab)
        .map((id) => (
          <div key={id} role="tabpanel" id={`mission-panel-${id}`} aria-labelledby={`mission-tab-${id}`} hidden />
        ))}
    </div>
  );
}
