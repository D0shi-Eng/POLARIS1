// المُنشئ (على نمط مانوس): مربع واحد، وتحته صفّ أدوات — في البداية «+» والموصلات والحاسوب/المجلد، وفي
// النهاية الميكروفون وزرّ الإرسال الدائري (أو «أوقف» ما دامت المهمّة تعمل). Enter يرسل، وShift+Enter سطر جديد.
//
// من الرئيسية: «أرسل» ينشئ مهمّة Phase-03 عادية، ويربط بها المرفقات (تصير في inputs/ بياناتٍ غير موثوقة)،
// ويحفظ اختيار النموذج، ويعلنها محادثةً (فتنتهي بردّ على المستخدم بلغته)، ثم يفتحها ويبدؤها.
// من داخل مهمّة: الرسالة دورٌ تالٍ في المحادثة نفسها (conversation.continue)، يرث النموذج والمشروع ومساحة
// الملفات، ثم يُبدأ. لا شيء هنا ينفّذ أداة.

import { useEffect, useRef, useState, type ClipboardEvent } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { ModelListResultV1, ProjectListResultV1 } from "../../generated/types/desktop-p02-result-v1";
import type { MissionListResultV1 } from "../../generated/types/desktop-p03-result-v1";
import type { ConnectorListResultV1 } from "../../generated/types/desktop-p06-result-v1";
import type { ArtifactListResultV1, ArtifactV1, AttachmentV1 } from "../../generated/types/desktop-p08-result-v1";
import type { Phase02Client } from "../../ipc/p02-client";
import type { Phase03Client } from "../../ipc/p03-client";
import type { Phase06Client } from "../../ipc/p06-client";
import type { Phase08Client } from "../../ipc/p08-client";
import { missionPath } from "../../routes/registry";
import { clipboardFiles, displayName, MAX_ATTACHMENTS, MAX_THUMBNAIL_BYTES, pastedName, PREVIEWABLE_IMAGES, readPicked } from "../../p08/files";
import { formatBytes, titleFromPrompt } from "../../p08/present";
import { visionOf } from "../../p08/vision";
import { Icon, type IconName } from "../../ui/components/Icon";
import { usable } from "../../ui/components/ModelPicker";
import { MenuHeading, MenuItem, MenuSeparator, Popover } from "../../ui/components/Popover";
import { VoiceButton } from "./VoiceButton";

/** خطأ يعرض معه المُنشئ زرّ «افتح الإعدادات»: لا نموذج صالحًا، فالحلّ في «الإعدادات ← المزوّدون» لا هنا. */
const NO_MODEL_KEY = "p08.composer.no_models";
/** DEF-45: نموذج مُضاف لكنه معطّل (أو مزوّده معطّل) ليس «لا نموذج»؛ الرسالة تقول ما يُصلحه. */
const MODEL_DISABLED_KEY = "p08.composer.models_disabled";

/** اسم المجلد الأخير من مسار (للعرض فقط). */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== "");
  return parts[parts.length - 1] ?? path;
}

interface Pending {
  readonly key: string;
  readonly name: string;
  readonly state: "UPLOADING" | "READY" | "FAILED";
  readonly attachment?: AttachmentV1;
  readonly errorKey?: string;
  /** مصغّرة صورة (عنوان data من بايتات الملف نفسه؛ سياسة المحتوى لا تسمح بعناوين blob). */
  readonly thumb?: string;
}

/**
 * نوع العمل المختار من «بناء» أو «إنشاء» (شريحة «موقع إلكتروني» في مانوس): يظهر شريحةً في صفّ الأدوات، وتعليمته تسبق
 * نصّ المستخدم عند الإرسال. عنوان المهمّة من نصّ المستخدم وحده.
 */
export interface ComposerMode {
  readonly icon: IconName;
  readonly label: string;
  readonly instruction: string;
  onClear(): void;
  /** عدد الشرائح (العروض): قائمة صغيرة في صفّ الأدوات كما في مانوس. */
  readonly count?: { readonly value: string; readonly label: string; readonly options: readonly { readonly value: string; readonly label: string }[]; onChange(value: string): void };
}

export interface ComposerProps {
  readonly phase02?: Phase02Client | undefined;
  readonly phase03: Phase03Client;
  readonly phase06?: Phase06Client | undefined;
  readonly phase08?: Phase08Client | undefined;
  /** نصّ يُملأ به المُنشئ من اختصار سريع. العدّاد يجعل الضغطة الثانية على الاختصار نفسه تعيد الملء. */
  readonly seed?: { readonly text: string; readonly n: number } | undefined;
  readonly voiceConfigured?: boolean;
  /** النموذج المختار في أعلى الصفحة ("" = الافتراضي). */
  readonly modelId?: string;
  /**
   * رسالة متابعة داخل مهمّة: دور تالٍ في المحادثة نفسها. `missionId` أيّ دور فيها؛ `onSent` يُستدعى بمعرّف
   * مهمّة الدور الجديد بعد بدئها.
   */
  readonly followUp?: { readonly missionId: string; readonly projectName?: string | undefined; onSent?(missionId: string): void } | undefined;
  /** وكيل متخصّص ثبّته المستخدم من صفحة الوكلاء لهذه المهمّة؛ يُحفظ لها عند إنشائها. */
  readonly specialist?: { readonly id: string; readonly name: string; onClear(): void } | undefined;
  /** صفحة مشروع: كل مهمّة تُنشأ من هنا في هذا المشروع، ولا يُزال اختياره (كما في مانوس). */
  readonly fixedProject?: { readonly id: string; readonly name: string } | undefined;
  /**
   * صفّ السياق فوق المربع (الرئيسية، مانوس 2.0): «هذا الكمبيوتر» (التنفيذ محلي)، والمشروع، ومجلد المشروع. يأخذ
   * مكان زرّ الحاسوب/المجلد في صفّ الأدوات.
   */
  readonly contextBar?: boolean;
  /** عدّاد يفتح منتقي الملفات (بطاقة «البدء من ملف محلي» في الرئيسية). */
  readonly pickRequest?: number;
  /** ملفات أُفلتت خارج المُنشئ (على البطاقة نفسها)؛ العدّاد يجعل كل إفلات جديدًا. */
  readonly dropped?: { readonly files: readonly File[]; readonly n: number } | undefined;
  /** نوع العمل المختار في الرئيسية (بناء/إنشاء). */
  readonly mode?: ComposerMode | undefined;
  /** المهمّة تعمل: زرّ الإرسال يصير «أوقف» (مربّع)، والكتابة معطّلة حتى تنتهي. */
  /**
   * الدور يعمل. `onNote` (ADR-042): الحقل يبقى مفتوحًا وما يُكتب يصير رسالة يقرؤها الوكيل عند خطوته التالية، بجانب زرّ الإيقاف.
   * يعيد هل حفظها المضيف؛ الواجهة لا تقول «أُرسلت» قبل ذلك.
   */
  readonly busy?: { readonly stopping: boolean; readonly canStop: boolean; onStop(): void; readonly onNote?: ((text: string) => Promise<boolean>) | undefined } | undefined;
}

export function Composer({ phase02, phase03, phase06, phase08, seed, voiceConfigured = false, modelId = "", followUp, busy, specialist, fixedProject, contextBar = false, pickRequest = 0, dropped, mode }: ComposerProps) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<readonly Pending[]>([]);
  const [projectId, setProjectId] = useState(fixedProject?.id ?? "");
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (seed !== undefined) {
      // نصّ فارغ («عرض تقديمي فارغ جديد») يفرغ المربع ويضع المؤشّر فيه.
      setText(seed.text.endsWith(":") ? `${seed.text} ` : seed.text);
      area.current?.focus();
    }
  }, [seed]);

  useEffect(() => {
    if (pickRequest > 0) picker.current?.click();
  }, [pickRequest]);

  useEffect(() => {
    if (dropped !== undefined && dropped.files.length > 0) void addFiles(dropped.files);
    // الإفلات حدث واحد يحمله العدّاد؛ addFiles تُبنى في كل رسم.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropped]);

  // ارتفاع المربع يتبع النصّ حتى حدّ، كما في مانوس.
  useEffect(() => {
    const el = area.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const projects = useHostQuery<ProjectListResultV1 | null>(() => (phase02 === undefined || followUp !== undefined ? Promise.resolve({ ok: true as const, value: null }) : phase02.listProjects()), [phase02, followUp === undefined]);
  const connectors = useHostQuery<ConnectorListResultV1 | null>(() => (phase06 === undefined ? Promise.resolve({ ok: true as const, value: null }) : phase06.listConnectors()), [phase06]);
  const recent = useHostQuery<MissionListResultV1 | null>(() => phase03.listMissions(), [phase03]);
  // «المكتبة» (مكافأة Manus 2026-10-20): أحدث ملفات المخرجات. المجلد (موقع أو مشروع شيفرة) لا يُرفق ملفًّا واحدًا.
  const library = useHostQuery<ArtifactListResultV1 | null>(() => (phase08 === undefined ? Promise.resolve({ ok: true as const, value: null }) : phase08.listArtifacts()), [phase08]);
  const project = (projects.value?.projects ?? []).find((p) => p.project_id === projectId);
  // صورة جاهزة ونموذج لا يعلن الرؤية: يُقال قبل الإرسال إن الصورة لن تصله (المضيف لا يرسلها إليه).
  const hasImage = files.some((f) => f.attachment?.model_access === "IMAGE_INPUT");
  const models = useHostQuery<ModelListResultV1 | null>(() => (phase02 === undefined || !hasImage ? Promise.resolve({ ok: true as const, value: null }) : phase02.listModels({})), [phase02, hasImage]);
  const vision = hasImage ? visionOf(models.value, modelId) : undefined;
  const connectorList = connectors.value?.connectors ?? [];

  /** `rename` يعطي الملف اسمه عند الإرسال (اللصق يسمّي صورة الحافظة)؛ غيابه يُبقي اسم الملف. */
  async function addFiles(list: FileList | readonly File[], rename?: (file: File, index: number) => string): Promise<void> {
    if (phase08 === undefined) return;
    const incoming = Array.from(list).slice(0, Math.max(0, MAX_ATTACHMENTS - files.length));
    for (const [index, file] of incoming.entries()) {
      const name = displayName(rename === undefined ? file.name : rename(file, index));
      const key = `${name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setFiles((current) => [...current, { key, name, state: "UPLOADING" }]);
      const picked = await readPicked(file);
      if (picked === "TOO_LARGE") {
        setFiles((current) => current.map((f) => (f.key === key ? { ...f, state: "FAILED", errorKey: "p08.attach.too_large" } : f)));
        continue;
      }
      const thumb = PREVIEWABLE_IMAGES.has(file.type) && file.size <= MAX_THUMBNAIL_BYTES ? `data:${file.type};base64,${picked.base64}` : undefined;
      const staged = await phase08.stageAttachment(name, picked.base64);
      setFiles((current) =>
        current.map((f) =>
          f.key === key ? (staged.ok ? { ...f, state: "READY", attachment: staged.value.attachment, ...(thumb === undefined ? {} : { thumb }) } : { ...f, state: "FAILED", errorKey: "p08.attach.refused" }) : f,
        ),
      );
    }
  }

  /**
   * لصق في المُنشئ (Ctrl+V): ما في الحافظة من ملفات — صورة لقطة شاشة أو صورة منسوخة من متصفح أو ملفات منسوخة من
   * المستكشف — يصير مرفقات بالمسار نفسه الذي يسلكه المنتقي. النصّ وحده يُلصق كما هو. لصقة فيها ملف ونصّ (صورة من
   * متصفح) تُرفق الملف ولا تُلصق وصف HTML بدله. أثناء دور يعمل لا مرفقات (الملاحظة نصّ فقط).
   */
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (phase08 === undefined || busy !== undefined) return;
    const pasted = clipboardFiles(event.clipboardData);
    if (pasted.length === 0) return;
    event.preventDefault();
    const at = new Date();
    void addFiles(pasted, (file, index) => pastedName(file, at, index));
  }

  /** مخرَج من «المكتبة» يصير مرفقًا بالمسار نفسه الذي يسلكه ملف محلي: شريحة «يُرفع» ثم «جاهز» أو «رُفض». */
  async function attachArtifact(artifact: ArtifactV1): Promise<void> {
    if (phase08 === undefined || files.length >= MAX_ATTACHMENTS) return;
    const name = displayName(artifact.file_ref.split("/").pop() ?? artifact.title);
    const key = `${artifact.artifact_id}-${Math.random().toString(36).slice(2)}`;
    setFiles((current) => [...current, { key, name, state: "UPLOADING" }]);
    const staged = await phase08.stageArtifact(artifact.artifact_id);
    setFiles((current) => current.map((f) => (f.key === key ? (staged.ok ? { ...f, state: "READY", attachment: staged.value.attachment } : { ...f, state: "FAILED", errorKey: "p08.attach.refused" }) : f)));
  }

  async function remove(pending: Pending): Promise<void> {
    setFiles((current) => current.filter((f) => f.key !== pending.key));
    if (pending.attachment !== undefined && phase08 !== undefined) await phase08.discardAttachment(pending.attachment.attachment_id);
  }

  /** سياق مهمّة سابقة يُدرج نصًّا في الرسالة (طلبها وجوابها)، ظاهرًا للمستخدم قبل الإرسال. */
  async function insertRecent(id: string, title: string): Promise<void> {
    const got = await phase03.getMission(id);
    const answer = got.ok ? (got.value.mission.result_summary ?? "") : "";
    const block = translator.t("ui.plus.recent_block", { title, answer: answer.slice(0, 1500) });
    setText((current) => (current.trim() === "" ? block : `${current}\n\n${block}`));
    area.current?.focus();
  }

  /** مرفقات جاهزة بلا نصّ (كما في Manus): الطلب جملة ثابتة تقول إن المطلوب هو الملفات نفسها. */
  const readyCount = files.filter((f) => f.state === "READY").length;

  async function send(): Promise<void> {
    const typed = text.trim();
    const prompt = typed !== "" || busy !== undefined || readyCount === 0 ? typed : translator.t("p08.composer.attachments_only");
    // دور يعمل: ما يُكتب رسالة للوكيل لا دور جديد، ولا مرفقات معها.
    if (busy?.onNote !== undefined) {
      if (prompt === "" || sending) return;
      setSending(true);
      setErrorKey(null);
      const queued = await busy.onNote(prompt);
      setSending(false);
      if (queued) setText("");
      else setErrorKey("ui.note.failed");
      return;
    }
    if (prompt === "" || sending || busy !== undefined || files.some((f) => f.state === "UPLOADING")) return;
    setSending(true);
    setErrorKey(null);
    const ready = files.flatMap((f) => (f.state === "READY" && f.attachment !== undefined ? [f.attachment.attachment_id] : []));

    if (followUp !== undefined && phase08 !== undefined) {
      const next = await phase08.continueConversation(followUp.missionId, prompt);
      if (!next.ok) {
        setSending(false);
        setErrorKey(next.error.code === "CONFLICT" ? "ui.followup.busy" : "p08.composer.create_failed");
        return;
      }
      const turn = next.value.mission_id;
      if (ready.length > 0) await phase08.bindAttachments(turn, ready);
      if (modelId !== "") await phase08.setMissionModel(turn, modelId);
      setText("");
      setFiles([]);
      setSending(false);
      // البدء طويل؛ شاشة المحادثة تتابع الدور الجديد بالقراءة الدورية.
      void phase03.startMission(turn);
      followUp.onSent?.(turn);
      return;
    }

    // قرار المالك (2026-10-20): إعداد النموذج في «الإعدادات» وحدها، لا بطاقة في الرئيسية. بلا أيّ نموذج محادثة صالح
    // يرفض التوجيه في المضيف كل مهمّة قبل الاستدلال؛ فلا تُنشأ مهمّة محكوم عليها بالفشل، ويُقال للمستخدم أين يُصلح ذلك.
    // المضيف يبقى صاحب القرار: هذا الفحص لا يقبل شيئًا يرفضه التوجيه، بل يمنع حالة الرفض المؤكَّد وحدها.
    if (phase02 !== undefined) {
      const listed = await phase02.listModels({});
      if (listed.ok && !listed.value.models.some(usable)) {
        setSending(false);
        const chat = listed.value.models.filter((m) => m.kind !== "EMBEDDING");
        setErrorKey(chat.some((m) => !m.enabled || !m.provider_enabled) ? MODEL_DISABLED_KEY : NO_MODEL_KEY);
        return;
      }
    }

    const objective = mode === undefined ? prompt : `${mode.instruction}\n\n${prompt}`;
    const created = await phase03.createMission({
      title: titleFromPrompt(prompt),
      objective,
      budget_preset: "EXTENDED",
      ...(projectId !== "" ? { project_id: projectId } : {}),
    });
    if (!created.ok) {
      setSending(false);
      setErrorKey("p08.composer.create_failed");
      return;
    }
    const missionId = created.value.mission_id;
    if (phase08 !== undefined && ready.length > 0) await phase08.bindAttachments(missionId, ready);
    if (phase08 !== undefined && modelId !== "") await phase08.setMissionModel(missionId, modelId);
    // الوكيل المثبَّت يُحفظ للمهمّة قبل بدء المحادثة، فترثه متابعاتها؛ ويُستهلك اختياره.
    if (phase08 !== undefined && specialist !== undefined) {
      await phase08.setMissionSpecialist(missionId, specialist.id);
      specialist.onClear();
    }
    // محادثة: تنتهي المهمّة بردّ موجَّه إلى المستخدم بلغته، ويُسجَّل سردها الحيّ.
    if (phase08 !== undefined) await phase08.beginConversation(missionId);
    setText("");
    setFiles([]);
    setSending(false);
    mode?.onClear();
    navigation.navigate(missionPath(missionId));
    void phase03.startMission(missionId);
  }

  const canSend = (text.trim() !== "" || readyCount > 0) && !sending && !files.some((f) => f.state === "UPLOADING");
  const recentMissions = [...(recent.value?.missions ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
  const libraryFiles = (library.value?.artifacts ?? []).filter((a) => a.type !== "WEB_SITE" && a.type !== "CODE_PROJECT").slice(0, 6);

  return (
    <div className="composer-wrap">
      <section
        className={`composer${followUp === undefined ? "" : " composer--followup"}${dragging ? " is-dragging" : ""}${busy !== undefined ? " is-busy" : ""}`}
        aria-label={translator.t("p08.composer.label")}
        onDragOver={(event) => {
          if (phase08 === undefined) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void addFiles(event.dataTransfer.files);
        }}
      >
        {contextBar && followUp === undefined && fixedProject === undefined ? (
          <div className="composer__strip">
            <Popover label={translator.t("ui.strip.computer")} placement="up" triggerClassName="composer__strip-item" trigger={<><Icon name="laptop" size={15} /><span>{translator.t("ui.strip.computer")}</span></>}>
              <MenuHeading>{translator.t("ui.folder.devices")}</MenuHeading>
              <MenuItem icon={<Icon name="laptop" size={16} />} label={translator.t("ui.folder.this_device")} detail={translator.t("ui.folder.this_device_detail")} trailing={<Icon name="check" size={15} />} onSelect={() => navigation.navigate("/browser-computer")} />
            </Popover>
            <Popover label={translator.t("ui.strip.project")} placement="up" triggerClassName={project === undefined ? "composer__strip-item" : "composer__strip-item is-set"} trigger={<><Icon name="box" size={15} /><span dir="auto">{project?.name ?? translator.t("ui.strip.project")}</span></>}>
              <MenuHeading>{translator.t("ui.folder.projects")}</MenuHeading>
              {(projects.value?.projects ?? []).slice(0, 12).map((p) => (
                <MenuItem key={p.project_id} icon={<Icon name="projects" size={16} />} label={p.name} trailing={p.project_id === projectId ? <Icon name="check" size={15} /> : undefined} onSelect={() => setProjectId(p.project_id === projectId ? "" : p.project_id)} />
              ))}
              {(projects.value?.projects ?? []).length === 0 ? <p className="menu-note">{translator.t("ui.strip.no_projects")}</p> : null}
              <MenuSeparator />
              <MenuItem icon={<Icon name="plus" size={16} />} label={translator.t("ui.folder.add")} onSelect={() => navigation.navigate("/projects")} />
            </Popover>
            <Popover label={translator.t("ui.strip.folder")} placement="up" triggerClassName="composer__strip-item" trigger={<><Icon name="folder" size={15} /><span dir="auto">{project?.workspace_root === undefined || project.workspace_root === null ? translator.t("ui.strip.folder") : folderName(project.workspace_root)}</span></>}>
              <MenuHeading>{translator.t("ui.strip.folders")}</MenuHeading>
              {/* المجلد في POLARIS مجلد مشروع: اختياره يربط الرسالة بمشروعه، ويقرأ الوكيل ملفاته سياقًا. */}
              {(projects.value?.projects ?? [])
                .filter((p) => typeof p.workspace_root === "string" && p.workspace_root !== "")
                .slice(0, 12)
                .map((p) => (
                  <MenuItem key={p.project_id} icon={<Icon name="folder" size={16} />} label={folderName(p.workspace_root as string)} detail={p.workspace_root as string} trailing={p.project_id === projectId ? <Icon name="check" size={15} /> : undefined} onSelect={() => setProjectId(p.project_id === projectId ? "" : p.project_id)} />
                ))}
              <MenuSeparator />
              <MenuItem icon={<Icon name="plus" size={16} />} label={translator.t("ui.strip.link_folder")} onSelect={() => navigation.navigate("/projects")} />
            </Popover>
          </div>
        ) : null}
        {(project !== undefined && fixedProject === undefined && !contextBar) || followUp?.projectName !== undefined || specialist !== undefined ? (
          <div className="composer__context">
            {specialist === undefined ? null : (
              <span className="chip chip--agent">
                <Icon name="user" size={14} />
                <span dir="auto">{translator.t("ui.agents.with", { name: specialist.name })}</span>
                <button type="button" className="chip__remove" aria-label={translator.t("ui.agents.with_clear")} title={translator.t("ui.agents.with_clear")} onClick={specialist.onClear}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            )}
            {(project === undefined || fixedProject !== undefined || contextBar) && followUp?.projectName === undefined ? null : (
              <span className="chip chip--project">
                <Icon name="projects" size={14} />
                <span dir="auto">{project?.name ?? followUp?.projectName}</span>
                {project === undefined ? null : (
                  <button type="button" className="chip__remove" aria-label={translator.t("ui.composer.project_clear")} onClick={() => setProjectId("")}>
                    ×
                  </button>
                )}
              </span>
            )}
          </div>
        ) : null}
        <label className="visually-hidden" htmlFor="composer-input">
          {translator.t("p08.composer.label")}
        </label>
        <textarea
          id="composer-input"
          ref={area}
          className="composer__input"
          rows={followUp === undefined ? 2 : 1}
          maxLength={followUp === undefined ? 8_000 : 6_000}
          placeholder={translator.t(busy?.onNote !== undefined ? "ui.note.placeholder" : busy !== undefined ? "ui.composer.busy" : followUp !== undefined ? "ui.followup.placeholder" : fixedProject !== undefined ? "ui.project.composer" : "p08.composer.placeholder")}
          disabled={busy !== undefined && busy.onNote === undefined}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={onPaste}
          onKeyDown={(event) => {
            // Enter يرسل (كما في مانوس)، وShift+Enter سطر جديد.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {files.length === 0 ? null : (
          <ul className="composer__files" aria-label={translator.t("p08.attach.list")}>
            {files.map((f) => (
              <li key={f.key} className={`chip chip--file is-${f.state.toLowerCase()}${f.thumb === undefined ? "" : " chip--image"}`}>
                {f.thumb === undefined ? <Icon name="file" size={14} /> : <img className="chip__thumb" src={f.thumb} alt={translator.t("p08.preview.image_alt", { name: f.name })} />}
                <span className="chip__name">{f.name}</span>
                <span className="chip__meta">
                  {f.state === "READY" && f.attachment !== undefined
                    ? f.attachment.model_access === "STORE_ONLY"
                      ? `${formatBytes(f.attachment.size_bytes)} · ${translator.t("p08.attach.store_only")}`
                      : formatBytes(f.attachment.size_bytes)
                    : translator.t(f.errorKey ?? (f.state === "UPLOADING" ? "p08.attach.uploading" : "p08.attach.failed"))}
                </span>
                <button type="button" className="chip__remove" aria-label={translator.t("p08.attach.remove", { name: f.name })} onClick={() => void remove(f)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {vision !== undefined && !vision.sees ? (
          <p className="composer__note" role="status">
            {translator.t("p08.attach.vision_unsupported", { model: vision.modelName })}
          </p>
        ) : null}
        <div className="composer__bar">
          <div className="composer__tools">
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files !== null) void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <Popover label={translator.t("ui.plus.label")} placement="up" trigger={<Icon name="plus" size={18} />} triggerClassName="icon-button composer__tool" disabled={busy !== undefined}>
              <MenuItem icon={<Icon name="paperclip" size={16} />} label={translator.t("ui.plus.local")} disabled={phase08 === undefined} onSelect={() => picker.current?.click()} />
              {recentMissions.length === 0 ? null : (
                <>
                  <MenuSeparator />
                  <MenuHeading>{translator.t("ui.plus.recent")}</MenuHeading>
                  {recentMissions.map((m) => (
                    <MenuItem key={m.mission_id} icon={<Icon name="missions" size={16} />} label={m.title} onSelect={() => void insertRecent(m.mission_id, m.title)} />
                  ))}
                </>
              )}
              {phase08 === undefined ? null : (
                <>
                  <MenuSeparator />
                  <MenuHeading>{translator.t("ui.plus.library")}</MenuHeading>
                  {libraryFiles.map((a) => (
                    <MenuItem key={a.artifact_id} icon={<Icon name="file" size={16} />} label={a.title} detail={a.file_ref.split("/").pop() === a.title ? undefined : a.file_ref.split("/").pop()} disabled={files.length >= MAX_ATTACHMENTS} onSelect={() => void attachArtifact(a)} />
                  ))}
                  {libraryFiles.length === 0 ? <p className="menu-note">{translator.t("ui.plus.library_empty")}</p> : null}
                  <MenuItem icon={<Icon name="library" size={16} />} label={translator.t("ui.plus.library_all")} onSelect={() => navigation.navigate("/artifacts")} />
                </>
              )}
            </Popover>
            <Popover
              label={translator.t("ui.connectors.label")}
              placement="up"
              triggerClassName="composer__pill"
              trigger={
                <span className="composer__pill-icons" aria-hidden="true">
                  <Icon name="connectors" size={15} />
                  <Icon name="globe" size={15} />
                  <Icon name="database" size={15} />
                </span>
              }
            >
              <MenuHeading>{translator.t("ui.connectors.label")}</MenuHeading>
              {/* قِيس 2026-10-01: القائمة بدت اختيارًا للمهمة وهي ليست كذلك. تقول الآن ما تفعله فعلًا. */}
              <p className="menu-note">{translator.t("ui.connectors.how")}</p>
              {connectorList.slice(0, 8).map((c) => (
                <MenuItem
                  key={c.descriptor.connector_id}
                  icon={<Icon name="connectors" size={16} />}
                  label={c.descriptor.display_name}
                  trailing={c.health.state === "HEALTHY" ? <Icon name="check" size={15} /> : <span className="menu-item__action">{translator.t("ui.connectors.connect")}</span>}
                  onSelect={() => navigation.navigate("/connectors")}
                />
              ))}
              {connectorList.length === 0 ? <p className="menu-note">{translator.t("ui.connectors.none")}</p> : null}
              <MenuSeparator />
              <MenuItem icon={<Icon name="plus" size={16} />} label={translator.t("ui.connectors.add")} onSelect={() => navigation.navigate("/connectors")} />
            </Popover>
            {fixedProject !== undefined ? (
              <span className="composer__pill composer__project" title={fixedProject.name}>
                <Icon name="projects" size={15} />
                <span dir="auto">{fixedProject.name}</span>
              </span>
            ) : null}
            {followUp === undefined && fixedProject === undefined && !contextBar ? (
              <Popover label={translator.t("ui.folder.label")} placement="up" trigger={<Icon name="browser" size={17} />} triggerClassName="icon-button composer__tool">
                <MenuHeading>{translator.t("ui.folder.devices")}</MenuHeading>
                <MenuItem icon={<Icon name="browser" size={16} />} label={translator.t("ui.folder.this_device")} detail={translator.t("ui.folder.this_device_detail")} onSelect={() => navigation.navigate("/browser-computer")} />
                <MenuSeparator />
                <MenuHeading>{translator.t("ui.folder.projects")}</MenuHeading>
                {(projects.value?.projects ?? []).slice(0, 8).map((p) => (
                  <MenuItem
                    key={p.project_id}
                    icon={<Icon name="projects" size={16} />}
                    label={p.name}
                    detail={p.workspace_root}
                    trailing={p.project_id === projectId ? <Icon name="check" size={15} /> : undefined}
                    onSelect={() => setProjectId(p.project_id === projectId ? "" : p.project_id)}
                  />
                ))}
                <MenuItem icon={<Icon name="plus" size={16} />} label={translator.t("ui.folder.add")} onSelect={() => navigation.navigate("/projects")} />
                <MenuSeparator />
                <MenuItem icon={<Icon name="settings" size={16} />} label={translator.t("ui.folder.manage")} onSelect={() => navigation.navigate("/browser-computer")} />
              </Popover>
            ) : null}
          </div>
          {mode === undefined ? null : (
            <div className="composer__mode">
              {mode.count === undefined ? null : (
                <Popover label={mode.count.label} placement="up" triggerClassName="composer__pill composer__count" trigger={<><Icon name="slides" size={14} /><span>{mode.count.options.find((o) => o.value === mode.count?.value)?.label}</span></>}>
                  {mode.count.options.map((o) => (
                    <MenuItem key={o.value} label={o.label} trailing={o.value === mode.count?.value ? <Icon name="check" size={15} /> : undefined} onSelect={() => mode.count?.onChange(o.value)} />
                  ))}
                </Popover>
              )}
              <button type="button" className="composer__kind" aria-label={translator.t("ui.kind.clear", { name: mode.label })} title={translator.t("ui.kind.clear", { name: mode.label })} onClick={mode.onClear}>
                <Icon name={mode.icon} size={14} />
                <span>{mode.label}</span>
              </button>
            </div>
          )}
          <div className="composer__end">
            <VoiceButton phase08={phase08} configured={voiceConfigured} onText={(spoken) => setText((current) => (current === "" ? spoken : `${current} ${spoken}`))} />
            {busy?.onNote !== undefined ? (
              <button type="button" className="composer__send" disabled={text.trim() === "" || sending} aria-label={translator.t("ui.note.send")} title={translator.t("ui.note.send")} onClick={() => void send()}>
                <Icon name="arrow-up" size={16} />
                <span className="visually-hidden">{translator.t("ui.note.send")}</span>
              </button>
            ) : null}
            {busy !== undefined ? (
              <button type="button" className="composer__send composer__stop" disabled={!busy.canStop || busy.stopping} aria-busy={busy.stopping} aria-label={translator.t(busy.stopping ? "p08.phase.cancelling" : "p08.working.stop")} title={translator.t(busy.stopping ? "p08.phase.cancelling" : "p08.working.stop")} onClick={busy.onStop}>
                <Icon name="stop" size={12} />
                <span className="visually-hidden">{translator.t(busy.stopping ? "p08.phase.cancelling" : "p08.working.stop")}</span>
              </button>
            ) : (
              <button type="button" className="composer__send" disabled={!canSend} aria-label={translator.t(sending ? "p08.composer.sending" : "p08.composer.send")} title={translator.t(sending ? "p08.composer.sending" : "p08.composer.send")} onClick={() => void send()}>
                <Icon name="arrow-up" size={16} />
                <span className="visually-hidden">{translator.t(sending ? "p08.composer.sending" : "p08.composer.send")}</span>
              </button>
            )}
          </div>
        </div>
        {errorKey === null ? null : (
          <p className="alert" role="alert">
            {translator.t(errorKey)}
            {errorKey === NO_MODEL_KEY || errorKey === MODEL_DISABLED_KEY ? (
              <button type="button" className="button button--secondary composer__settings" onClick={() => navigation.navigate("/providers")}>
                {translator.t("p08.composer.open_settings")}
              </button>
            ) : null}
          </p>
        )}
      </section>
    </div>
  );
}
