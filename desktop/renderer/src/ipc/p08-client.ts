// العميل المُصنَّف لـPhase-08: ثلاث وأربعون دالّة، واحدة لكل عملية في السجل (منها سبع للمحادثة، وحذف المشروع، و«تذكّر هذا»).
//
// وما لا يوجد في هذا الملف هو الخاصيّة الأمنية: لا دالّة تشغّل أمرًا أو Python، ولا دالّة
// تتصفّح أو تكتب في مساحة مهمّة، ولا دالّة تقرأ رمز OAuth أو ترسل رسالة. العارض يرفق ويقرأ
// ويضبط ويقرّر؛ والتنفيذ يبدأ من زمن تشغيل المهمّة الموثوق وحده، عبر بوابة الأدوات.

import type {
  AgentCatalogResultV1,
  ConversationDeleteResultV1,
  ConversationUpdateResultV1,
  ProjectDeleteResultV1,
  MemoryRememberResultV1,
  ConversationSearchResultV1,
  ArtifactGetResultV1,
  ConversationBeginResultV1,
  ConversationContinueResultV1,
  ConversationGetResultV1,
  ConversationIndexResultV1,
  MissionSpecialistSetResultV1,
  ArtifactListResultV1,
  AttachmentBindResultV1,
  AttachmentDiscardResultV1,
  AttachmentListResultV1,
  AttachmentStageResultV1,
  DeviceExportResultV1,
  DeviceImportResultV1,
  ExecutionRunsResultV1,
  ExecutionRuntimePrepareResultV1,
  ExecutionStatusResultV1,
  IntegrationSettingsSetResultV1,
  MissionModelSetResultV1,
  OauthConnectResultV1,
  OauthDisconnectResultV1,
  OauthListResultV1,
  PublishDecideResultV1,
  PublishListResultV1,
  PublishProposeResultV1,
  ScheduleDeleteResultV1,
  ScheduleEnableResultV1,
  ScheduleListResultV1,
  ScheduleRunNowResultV1,
  ScheduleSaveResultV1,
  ShareListResultV1,
  ShareSetResultV1,
  SkillPackageImportResultV1,
  SkillPackageListResultV1,
  VoiceTranscribeResultV1,
  WorkspaceExportResultV1,
  WorkspaceListResultV1,
  WorkspacePreviewResultV1,
  MissionTraceResultV1,
  McpAcceptRedefinitionResultV1,
  WebSearchStatusResultV1,
  WebSearchTestResultV1,
  MemorySemanticStatusResultV1,
  MemorySemanticTestResultV1,
  MissionRatingResultV1,
  MissionNoteResultV1,
  ToolApprovalGrantsResultV1,
  ToolApprovalGrantRevokeResultV1,
  GitHubStatusResultV1,
} from "../generated/types/desktop-p08-result-v1";
import type { IntegrationSettingKey, MemorySemanticSetRequestV1, ScheduleSaveRequestV1 } from "../generated/types/desktop-p08-request-v1";
import { callOperation, type CallContext, type CallResult } from "./call";
import type { IdFactory, SessionIdentity } from "./envelope";
import type { Phase08Operation } from "./operations";
import type { Transport } from "./transport";

const READ_TIMEOUT_MS = 8_000;
const WRITE_TIMEOUT_MS = 15_000;
// رفع ملف كبير أو تفريغ تسجيل صوتي أو إعداد نسخة Python قد يطول.
const LONG_TIMEOUT_MS = 180_000;

export interface Phase08ClientOptions {
  readonly transport: Transport;
  readonly identity: SessionIdentity;
  readonly newId?: IdFactory;
  readonly clock?: () => number;
}

function defined<T extends object>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}

export type ShareObject = "MISSION" | "ARTIFACT" | "WORKSPACE";
export type ShareRole = "OWNER" | "EDITOR" | "VIEWER";

export class Phase08Client {
  private readonly context: CallContext;

  constructor(options: Phase08ClientOptions) {
    this.context = { transport: options.transport, identity: options.identity, newId: options.newId, clock: options.clock };
  }

  // ── مساحة العمل ───────────────────────────────────────────────────────────

  listWorkspace(missionId: string, path?: string): Promise<CallResult<WorkspaceListResultV1>> {
    return this.call("workspace.list", defined({ mission_id: missionId, path }), READ_TIMEOUT_MS);
  }

  previewFile(missionId: string, path: string, maxChars?: number): Promise<CallResult<WorkspacePreviewResultV1>> {
    return this.call("workspace.preview", defined({ mission_id: missionId, path, max_chars: maxChars }), READ_TIMEOUT_MS);
  }

  exportFile(missionId: string, path: string): Promise<CallResult<WorkspaceExportResultV1>> {
    return this.call("workspace.export", { mission_id: missionId, path }, WRITE_TIMEOUT_MS);
  }

  // ── المرفقات ──────────────────────────────────────────────────────────────

  stageAttachment(fileName: string, contentBase64: string): Promise<CallResult<AttachmentStageResultV1>> {
    return this.call("attachment.stage", { file_name: fileName, content_base64: contentBase64 }, LONG_TIMEOUT_MS);
  }

  /** «المكتبة» في قائمة «+»: نسخة من ملف مخرَج سابق تصير مرفقًا. المعرّف وحده؛ المضيف يعرف المسار. */
  stageArtifact(artifactId: string): Promise<CallResult<AttachmentStageResultV1>> {
    return this.call("attachment.artifact.stage", { artifact_id: artifactId }, LONG_TIMEOUT_MS);
  }

  discardAttachment(attachmentId: string): Promise<CallResult<AttachmentDiscardResultV1>> {
    return this.call("attachment.discard", { attachment_id: attachmentId }, WRITE_TIMEOUT_MS);
  }

  listAttachments(missionId?: string): Promise<CallResult<AttachmentListResultV1>> {
    return this.call("attachment.list", defined({ mission_id: missionId }), READ_TIMEOUT_MS);
  }

  bindAttachments(missionId: string, attachmentIds: readonly string[]): Promise<CallResult<AttachmentBindResultV1>> {
    return this.call("attachment.bind", { mission_id: missionId, attachment_ids: [...attachmentIds] }, WRITE_TIMEOUT_MS);
  }

  // ── المخرجات ──────────────────────────────────────────────────────────────

  listArtifacts(missionId?: string): Promise<CallResult<ArtifactListResultV1>> {
    return this.call("artifact.list", defined({ mission_id: missionId }), READ_TIMEOUT_MS);
  }

  getArtifact(artifactId: string): Promise<CallResult<ArtifactGetResultV1>> {
    return this.call("artifact.get", { artifact_id: artifactId }, READ_TIMEOUT_MS);
  }

  // ── بيئة التنفيذ ──────────────────────────────────────────────────────────

  executionStatus(): Promise<CallResult<ExecutionStatusResultV1>> {
    return this.call("execution.status", {}, READ_TIMEOUT_MS);
  }

  executionRuns(missionId: string): Promise<CallResult<ExecutionRunsResultV1>> {
    return this.call("execution.runs", { mission_id: missionId }, READ_TIMEOUT_MS);
  }

  preparePython(): Promise<CallResult<ExecutionRuntimePrepareResultV1>> {
    return this.call("execution.runtime.prepare", { runtime: "PYTHON" }, 600_000);
  }

  setMissionModel(missionId: string, modelId: string | null): Promise<CallResult<MissionModelSetResultV1>> {
    return this.call("mission.model.set", { mission_id: missionId, model_id: modelId }, WRITE_TIMEOUT_MS);
  }

  // ── المحادثة ──────────────────────────────────────────────────────────────

  /** يجعل مهمّة أُنشئت للتوّ الدور الأول في محادثة: تنتهي بردّ على المستخدم بلغته. */
  beginConversation(missionId: string): Promise<CallResult<ConversationBeginResultV1>> {
    return this.call("conversation.begin", { mission_id: missionId }, WRITE_TIMEOUT_MS);
  }

  /** رسالة متابعة في المحادثة نفسها: ينشئ مهمّة الدور التالي (ولا يبدؤها). */
  continueConversation(missionId: string, message: string): Promise<CallResult<ConversationContinueResultV1>> {
    return this.call("conversation.continue", { mission_id: missionId, message }, WRITE_TIMEOUT_MS);
  }

  getConversation(missionId: string): Promise<CallResult<ConversationGetResultV1>> {
    return this.call("conversation.get", { mission_id: missionId }, READ_TIMEOUT_MS);
  }

  conversationIndex(): Promise<CallResult<ConversationIndexResultV1>> {
    return this.call("conversation.index", {}, READ_TIMEOUT_MS);
  }

  /**
   * قائمة «⋯»: يغيّر ما يُذكر فقط ويطبّقه على المحادثة كلّها. `project_id: null` يخرجها من مشروعها، والعنوان
   * الذي يسمّيه المستخدم لا يستبدله عنوان يقترحه المخطّط.
   */
  updateConversation(threadId: string, changes: { readonly title?: string; readonly pinned?: boolean; readonly favorite?: boolean; readonly archived?: boolean; readonly project_id?: string | null }): Promise<CallResult<ConversationUpdateResultV1>> {
    return this.call("conversation.update", { thread_id: threadId, ...changes }, WRITE_TIMEOUT_MS);
  }

  /** يحذف المحادثة نهائيًّا بأدوارها وملفاتها. يرفضه المضيف ما دام دورٌ منها يعمل. */
  deleteConversation(threadId: string): Promise<CallResult<ConversationDeleteResultV1>> {
    return this.call("conversation.delete", { thread_id: threadId }, WRITE_TIMEOUT_MS);
  }

  /** يحذف مشروعًا بتعليماته ومصادره. محادثاته تبقى وتخرج منه. */
  deleteProject(projectId: string): Promise<CallResult<ProjectDeleteResultV1>> {
    return this.call("project.delete", { project_id: projectId }, WRITE_TIMEOUT_MS);
  }

  /** البحث في المحادثات: العنوان والرسائل والأجوبة، بلا اعتبار لفروق الإملاء العربي. فارغًا: أحدث المحادثات. */
  searchConversations(query: string, limit = 30): Promise<CallResult<ConversationSearchResultV1>> {
    return this.call("conversation.search", { ...(query.trim() === "" ? {} : { query: query.trim().slice(0, 200) }), limit }, READ_TIMEOUT_MS);
  }

  /** «تذكّر هذا»: نصّ كتبه المستخدم عنه أو عن مشروع. يقرّر المضيف حفظه أو رفضه بسياسة الذاكرة نفسها. */
  rememberMemory(input: { readonly text: string; readonly topic?: string; readonly scope: "USER" | "PROJECT"; readonly project_id?: string; readonly mission_id?: string }): Promise<CallResult<MemoryRememberResultV1>> {
    return this.call("memory.remember", { ...input }, WRITE_TIMEOUT_MS);
  }

  // ── الوكلاء المتخصّصون ────────────────────────────────────────────────────

  /** كتالوج الوكلاء المضمَّن: المجالات والوكلاء بأسمائهم ووصفهم (بلا تعليمات عملهم). */
  agentCatalog(): Promise<CallResult<AgentCatalogResultV1>> {
    return this.call("agent.catalog", {}, READ_TIMEOUT_MS);
  }

  /** يثبّت وكيلًا متخصّصًا للمهمّة ومتابعاتها، أو يزيله بـ`null`. */
  setMissionSpecialist(missionId: string, specialistId: string | null): Promise<CallResult<MissionSpecialistSetResultV1>> {
    return this.call("mission.specialist.set", { mission_id: missionId, specialist_id: specialistId }, WRITE_TIMEOUT_MS);
  }

  // ── المجدول ───────────────────────────────────────────────────────────────

  listSchedules(): Promise<CallResult<ScheduleListResultV1>> {
    return this.call("schedule.list", {}, READ_TIMEOUT_MS);
  }

  saveSchedule(input: ScheduleSaveRequestV1): Promise<CallResult<ScheduleSaveResultV1>> {
    return this.call("schedule.save", defined(input), WRITE_TIMEOUT_MS);
  }

  enableSchedule(scheduleId: string, enabled: boolean): Promise<CallResult<ScheduleEnableResultV1>> {
    return this.call("schedule.enable", { schedule_id: scheduleId, enabled }, WRITE_TIMEOUT_MS);
  }

  deleteSchedule(scheduleId: string): Promise<CallResult<ScheduleDeleteResultV1>> {
    return this.call("schedule.delete", { schedule_id: scheduleId }, WRITE_TIMEOUT_MS);
  }

  runScheduleNow(scheduleId: string): Promise<CallResult<ScheduleRunNowResultV1>> {
    return this.call("schedule.run_now", { schedule_id: scheduleId }, WRITE_TIMEOUT_MS);
  }

  // ── OAuth ─────────────────────────────────────────────────────────────────

  listOAuth(): Promise<CallResult<OauthListResultV1>> {
    return this.call("oauth.list", {}, READ_TIMEOUT_MS);
  }

  connectOAuth(providerId: string, clientId: string, scopes?: readonly string[]): Promise<CallResult<OauthConnectResultV1>> {
    return this.call("oauth.connect", defined({ provider_id: providerId, client_id: clientId, scopes: scopes === undefined ? undefined : [...scopes] }), WRITE_TIMEOUT_MS);
  }

  disconnectOAuth(connectionId: string): Promise<CallResult<OauthDisconnectResultV1>> {
    return this.call("oauth.disconnect", { connection_id: connectionId }, WRITE_TIMEOUT_MS);
  }

  // ── الصوت ─────────────────────────────────────────────────────────────────

  transcribe(audioBase64: string, language?: string): Promise<CallResult<VoiceTranscribeResultV1>> {
    return this.call("voice.transcribe", defined({ audio_base64: audioBase64, language }), LONG_TIMEOUT_MS);
  }

  // ── المشاركة والنشر ───────────────────────────────────────────────────────

  listShares(objectType: ShareObject, objectId: string): Promise<CallResult<ShareListResultV1>> {
    return this.call("share.list", { object_type: objectType, object_id: objectId }, READ_TIMEOUT_MS);
  }

  setShare(objectType: ShareObject, objectId: string, member: string, role: ShareRole | null): Promise<CallResult<ShareSetResultV1>> {
    return this.call("share.set", { object_type: objectType, object_id: objectId, member, role }, WRITE_TIMEOUT_MS);
  }

  listPublications(): Promise<CallResult<PublishListResultV1>> {
    return this.call("publish.list", {}, READ_TIMEOUT_MS);
  }

  proposePublication(artifactId: string, publisherId: string): Promise<CallResult<PublishProposeResultV1>> {
    return this.call("publish.propose", { artifact_id: artifactId, publisher_id: publisherId }, WRITE_TIMEOUT_MS);
  }

  decidePublication(publicationId: string, decision: "GRANT" | "DENY"): Promise<CallResult<PublishDecideResultV1>> {
    return this.call("publish.decide", { publication_id: publicationId, decision }, WRITE_TIMEOUT_MS);
  }

  // ── حزم المهارات والأجهزة والإعدادات ─────────────────────────────────────

  listSkillPackages(): Promise<CallResult<SkillPackageListResultV1>> {
    return this.call("skill.package.list", {}, READ_TIMEOUT_MS);
  }

  importSkillPackage(manifestJson: string): Promise<CallResult<SkillPackageImportResultV1>> {
    return this.call("skill.package.import", { manifest_json: manifestJson }, WRITE_TIMEOUT_MS);
  }

  exportWorkspace(missionId: string): Promise<CallResult<DeviceExportResultV1>> {
    return this.call("device.export", { mission_id: missionId }, LONG_TIMEOUT_MS);
  }

  importWorkspace(bundleBase64: string): Promise<CallResult<DeviceImportResultV1>> {
    return this.call("device.import", { bundle_base64: bundleBase64 }, LONG_TIMEOUT_MS);
  }

  setIntegrationSetting(key: IntegrationSettingKey, value: string | boolean | null): Promise<CallResult<IntegrationSettingsSetResultV1>> {
    return this.call("integration.settings.set", { key, value }, WRITE_TIMEOUT_MS);
  }

  /** تتبّع مهمّة (R-11): الامتدادات وأحداث الأمن وحالة سلسلة سجلّ الجلسة. قراءة فقط؛ OTLP عند الطلب ولا يُرسل إلى أيّ مكان. */
  /** صفحة من التتبّع (CP-10-1): `after` امتدادًا تُتخطّى؛ المجاميع في النتيجة تشمل المهمّة كلها. */
  missionTrace(missionId: string, includeOtlp = false, after?: number): Promise<CallResult<MissionTraceResultV1>> {
    return this.call(
      "mission.trace",
      { mission_id: missionId, ...(includeOtlp ? { include_otlp: true } : {}), ...(after === undefined || after === 0 ? {} : { after }) },
      READ_TIMEOUT_MS,
    );
  }

  /** يقبل التعريف الجديد لأداة MCP أُعيد تعريفها بعد اكتشافها (R-11). حتى القبول تبقى معطّلة. */
  acceptToolRedefinition(toolId: string): Promise<CallResult<McpAcceptRedefinitionResultV1>> {
    return this.call("mcp.tool.accept_redefinition", { tool_id: toolId }, WRITE_TIMEOUT_MS);
  }

  // ——— ADR-042 (2026-10-19)

  /** المزوّد المختار لبحث الويب وجاهزيته. بلا شبكة؛ المفتاح يُقال موجودًا أو غائبًا فقط. */
  webSearchStatus(): Promise<CallResult<WebSearchStatusResultV1>> {
    return this.call("web.search.status", {}, READ_TIMEOUT_MS);
  }

  /** يحفظ مفتاح Brave Search في مخزن اعتماد النظام، أو يحذفه بـ`null`. المفتاح لا يعود. */
  putWebSearchKey(apiKey: string | null): Promise<CallResult<WebSearchStatusResultV1>> {
    return this.call("web.search.credential.put", { provider: "BRAVE", api_key: apiKey }, WRITE_TIMEOUT_MS);
  }

  /** بحث اختبار واحد بنصّ ثابت عبر المزوّد المختار. أثر شبكي يطلبه المستخدم. */
  testWebSearch(): Promise<CallResult<WebSearchTestResultV1>> {
    return this.call("web.search.test", {}, LONG_TIMEOUT_MS);
  }

  // ——— PHASE-12: الاسترجاع الدلالي للذاكرة

  /** الإعداد، وهل يرتّب المضيف الذاكرة بالتشابه الآن. */
  memorySemanticStatus(): Promise<CallResult<MemorySemanticStatusResultV1>> {
    return this.call("memory.semantic.status", {}, READ_TIMEOUT_MS);
  }

  /** يحفظ خادم تضمين على هذا الجهاز ونموذجه، أو يعطّل الترتيب بالتشابه. */
  setMemorySemantic(input: MemorySemanticSetRequestV1): Promise<CallResult<MemorySemanticStatusResultV1>> {
    return this.call("memory.semantic.set", { ...input }, WRITE_TIMEOUT_MS);
  }

  /** يضمّن جملة ثابتة بالخادم المحفوظ. لا ذاكرة تُقرأ ولا تُرسل. */
  testMemorySemantic(): Promise<CallResult<MemorySemanticTestResultV1>> {
    return this.call("memory.semantic.test", {}, LONG_TIMEOUT_MS);
  }

  /** تقييم دور انتهى. يبقى على هذا الجهاز. */
  rateMission(missionId: string, rating: number): Promise<CallResult<MissionRatingResultV1>> {
    return this.call("mission.rating.set", { mission_id: missionId, rating }, WRITE_TIMEOUT_MS);
  }

  /** رسالة لدور يعمل: يقرؤها الوكيل عند الحدّ الآمن التالي. لا تقاطع التنفيذ ولا تغيّر الصلاحيات. */
  addMissionNote(missionId: string, text: string): Promise<CallResult<MissionNoteResultV1>> {
    return this.call("mission.note.add", { mission_id: missionId, text }, WRITE_TIMEOUT_MS);
  }

  /** منح «اسمح لهذه المهمّة» القائمة. */
  missionGrants(missionId: string): Promise<CallResult<ToolApprovalGrantsResultV1>> {
    return this.call("tool.approval.grants", { mission_id: missionId }, READ_TIMEOUT_MS);
  }

  /** يسحب منح المهمّة كلها، أو منحة واحدة. */
  revokeMissionGrants(missionId: string, grantId?: string): Promise<CallResult<ToolApprovalGrantRevokeResultV1>> {
    return this.call("tool.approval.grant.revoke", grantId === undefined ? { mission_id: missionId } : { mission_id: missionId, grant_id: grantId }, WRITE_TIMEOUT_MS);
  }

  githubStatus(): Promise<CallResult<GitHubStatusResultV1>> {
    return this.call("github.status", {}, READ_TIMEOUT_MS);
  }

  /** يفحص رمز GitHub عند GitHub ثم يحفظه في مخزن اعتماد النظام. الرمز لا يعود. */
  connectGitHub(token: string): Promise<CallResult<GitHubStatusResultV1>> {
    return this.call("github.connect", { token }, LONG_TIMEOUT_MS);
  }

  disconnectGitHub(): Promise<CallResult<GitHubStatusResultV1>> {
    return this.call("github.disconnect", {}, WRITE_TIMEOUT_MS);
  }

  private call<T>(operation: Phase08Operation, payload: Record<string, unknown>, timeoutMs: number): Promise<CallResult<T>> {
    return callOperation<T>(this.context, operation, payload, { timeoutMs });
  }
}
