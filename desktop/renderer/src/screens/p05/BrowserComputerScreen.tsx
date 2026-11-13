// أجهزة الكمبيوتر كما في مانوس 2.0 (قِيس 2026-10-05 في التطبيق نفسه): صفّ الرأس وتحته شبكة بطاقات 470px بينها 18px.
// بطاقة الجهاز: لوح علوي بخلفية سطح المكتب، فيه اسم الجهاز في البداية وحالته و«⋯» في النهاية ونظامه في الأسفل، ثم
// صفّ سفلي بزرّين: «الإعدادات» و«المهام». «المهام» تفتح حوار ما فعلته المهامّ على هذا الجهاز (جلسات المتصفّح والحاسوب
// وسجلّها)، و«الإعدادات» تفتح «تفاصيل الجهاز» (النوافذ التي يمكنك منحها لمهمّة). البطاقة الثانية المنقّطة مكان «إنشاء
// جهاز سحابي» في مانوس: POLARIS يعمل على هذا الجهاز وحده، فتقول ذلك بدل أزرار لا يقف وراءها شيء.
//
// ما لا يوجد هنا مقصود: لا شريط عنوان، ولا زرّ «انقر هنا»، ولا حقل يكتب في نافذة.
// العارض لا يتنقّل ولا ينقر ولا يكتب؛ الأفعال يبدؤها زمن تشغيل المهمّة عبر البوابة.
// ما يملكه المستخدم هنا: أن يرى، وأن يمنح نافذةً لمهمّة أو يسحبها، وأن يوقف جلسة.

import { useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { Phase03Client } from "../../ipc/p03-client";
import type { Phase05Client } from "../../ipc/p05-client";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { actionStatusTone, isTerminalSession, sessionTone } from "../../p05/present";
import { shortDigest } from "../../p04/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { Icon } from "../../ui/components/Icon";
import { PageFrame, Sheet } from "../../ui/components/PageFrame";
import { MenuItem, Popover } from "../../ui/components/Popover";
import { StateBlock } from "../../ui/components/StateBlock";
import { P05Pill } from "./P05Pill";

/** خلفية لوح الجهاز: شرائط زرقاء متموّجة من رسمنا (لا صورة خلفية النظام). */
function DeviceArt() {
  return (
    <svg className="mp-device__art" viewBox="0 0 470 264" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="mp-dev-bg" cx="58%" cy="48%" r="75%">
          <stop offset="0" stopColor="#123a8c" />
          <stop offset="0.55" stopColor="#0a1d4f" />
          <stop offset="1" stopColor="#050b1f" />
        </radialGradient>
        <linearGradient id="mp-dev-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3f7bff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#0b2a8a" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="mp-dev-b" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fb0ff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#1b47c4" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect width="470" height="264" fill="url(#mp-dev-bg)" />
      <path d="M150 250C140 170 190 92 262 62c62-26 124-8 150 34-58-18-120 2-158 50-34 42-44 86-104 104z" fill="url(#mp-dev-a)" />
      <path d="M196 236c4-62 40-118 98-140 46-18 92-10 118 18-48-6-92 12-122 46-26 30-40 62-94 76z" fill="url(#mp-dev-b)" opacity="0.8" />
      <path d="M232 228c12-44 40-80 80-94 30-10 60-6 78 10-34 2-64 16-86 40-20 22-32 40-72 44z" fill="#a9c8ff" opacity="0.35" />
      <path d="M120 200c30-70 92-122 168-136" fill="none" stroke="#9cc0ff" strokeOpacity="0.35" strokeWidth="1.2" />
      <path d="M140 220c30-60 84-104 150-118" fill="none" stroke="#9cc0ff" strokeOpacity="0.25" strokeWidth="1" />
    </svg>
  );
}

export function BrowserComputerScreen({ client, missions, platform }: { readonly client: Phase05Client; readonly missions?: Phase03Client; readonly platform?: string }) {
  const translator = useTranslator();
  const t = (key: string) => translator.t(key);
  const navigation = useNavigation();
  const [view, setView] = useState<"tasks" | "settings" | null>(null);
  const os = platform === undefined ? null : t(`ui.devices.os.${platform}`);
  return (
    <PageFrame title={t("ui.rail.computers")} width={958} className="mp--devices">
      <div className="mp-devices">
        <article className="mp-device" aria-label={t("ui.devices.this")}>
          <div className="mp-device__screen">
            <DeviceArt />
            <span className="mp-device__name">
              <Icon name="laptop" size={15} />
              {t("ui.devices.this")}
            </span>
            {/* الواجهة تُرسم من المضيف المحلي نفسه: ما دامت مفتوحة فالجهاز يعمل. */}
            <span className="mp-device__status">
              <span className="mp-device__dot" aria-hidden="true" />
              {t("ui.devices.online")}
              <Popover label={t("ui.library.actions")} trigger={<Icon name="more" size={16} />} triggerClassName="icon-button mp-device__more" floating align="end">
                <MenuItem icon={<Icon name="edit" size={16} />} label={t("ui.rail.new_mission")} onSelect={() => navigation.navigate("/")} />
                <MenuItem icon={<Icon name="list" size={16} />} label={t("ui.devices.tasks")} onSelect={() => setView("tasks")} />
              </Popover>
            </span>
            {os === null ? null : (
              <span className="mp-device__os">
                <Icon name="grid" size={15} />
                {os}
              </span>
            )}
          </div>
          <div className="mp-device__actions">
            <button type="button" className="mp-device__action" data-device-view="settings" onClick={() => setView("settings")}>
              <Icon name="settings" size={16} />
              {t("ui.devices.settings")}
            </button>
            <span className="mp-device__sep" aria-hidden="true" />
            <button type="button" className="mp-device__action" data-device-view="tasks" onClick={() => setView("tasks")}>
              <Icon name="list" size={16} />
              {t("ui.devices.tasks")}
            </button>
          </div>
        </article>
        <div className="mp-device-slot">
          <Icon name="monitor" size={20} />
          <p className="mp-device-slot__title">{t("ui.devices.only_title")}</p>
          <p className="mp-device-slot__body">{t("ui.devices.only_this")}</p>
        </div>
      </div>

      {view === "tasks" ? (
        <Sheet label={t("ui.devices.tasks_title")} onClose={() => setView(null)} className="mp-sheet--wide">
          <h2 className="mp-sheet__title">{t("ui.devices.tasks_title")}</h2>
          <p className="mp-sheet__hint">{t("bc.subtitle")}</p>
          <p className="note" role="note">
            {t("bc.note.untrusted")}
          </p>
          <section className="section" aria-labelledby="bc-browser">
            <h3 className="section__title" id="bc-browser">
              {t("bc.browser.title")}
            </h3>
            <BrowserSessions client={client} />
          </section>
          <section className="section" aria-labelledby="bc-computer">
            <h3 className="section__title" id="bc-computer">
              {t("bc.computer.title")}
            </h3>
            <ComputerSessions client={client} />
          </section>
        </Sheet>
      ) : null}

      {view === "settings" ? (
        <Sheet label={t("ui.devices.details")} onClose={() => setView(null)} className="mp-sheet--wide">
          <h2 className="mp-sheet__title">{t("ui.devices.details")}</h2>
          <div className="mp-device-row">
            <span className="mp-device-row__icon" aria-hidden="true">
              <Icon name="laptop" size={18} />
            </span>
            <span className="mp-device-row__text">
              <strong>{t("ui.devices.this")}</strong>
              <span className="mp-device-row__state">
                <span className="mp-device__dot" aria-hidden="true" />
                {t("ui.devices.online")}
                {os === null ? "" : ` · ${os}`}
              </span>
            </span>
          </div>
          <section className="section" aria-labelledby="bc-windows">
            <h3 className="section__title" id="bc-windows">
              {t("bc.windows.title")}
            </h3>
            <WindowGrants client={client} missions={missions} />
          </section>
        </Sheet>
      ) : null}
    </PageFrame>
  );
}

export function BrowserSessions({ client, missionId }: { readonly client: Phase05Client; readonly missionId?: string }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(() => client.listBrowserSessions(missionId === undefined ? {} : { mission_id: missionId }), [client, missionId]);
  const action = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const sessions = query.value?.sessions ?? [];
  return (
    <>
      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      <ActionNote state={action.state} />
      {sessions.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey="bc.browser.empty" />
      ) : (
        <table className="table browser-sessions">
          <caption className="sr-only">{translator.t("bc.browser.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("bc.column.url")}</th>
              <th scope="col">{translator.t("bc.column.state")}</th>
              <th scope="col">{translator.t("bc.column.mission")}</th>
              <th scope="col">{translator.t("bc.column.agent")}</th>
              <th scope="col">{translator.t("bc.column.counts")}</th>
              <th scope="col">{translator.t("bc.column.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.session_id} data-session-id={session.session_id}>
                <th scope="row">
                  {session.current_title ?? "—"}
                  <br />
                  <code className="muted">{session.current_url ?? "—"}</code>
                  <br />
                  <span className="pill pill--WARNING">{translator.t("bc.trust.web")}</span>
                </th>
                <td>
                  <P05Pill namespace="session" member={session.state} tone={sessionTone(session.state)} />
                  {session.closed_reason === undefined ? null : <span className="muted"> {session.closed_reason}</span>}
                </td>
                <td>
                  <code>{session.mission_id}</code>
                </td>
                <td>
                  <code>{session.owner_agent_id}</code>
                </td>
                <td>{translator.t("bc.counts", { navigations: session.navigation_count, actions: session.action_count })}</td>
                <td>
                  {formatInstant(locale, session.last_activity_at)}{" "}
                  <button
                    type="button"
                    className="button button--secondary"
                    aria-expanded={open === session.session_id}
                    // السجل يُرسم حين يُفتح فقط، فالمرجع إليه يوجد معه.
                    aria-controls={open === session.session_id ? `browser-history-${session.session_id}` : undefined}
                    onClick={() => setOpen(open === session.session_id ? null : session.session_id)}
                  >
                    {translator.t("bc.action.history")}
                  </button>{" "}
                  {isTerminalSession(session.state) ? null : (
                    <button
                      type="button"
                      className="button button--primary session-stop"
                      aria-label={`${translator.t("bc.action.stop")} ${session.current_title ?? session.session_id}`}
                      onClick={() =>
                        void action.run(
                          () => client.stopBrowserSession(session.session_id),
                          () => ({ phase: "DONE", messageKey: "bc.stopped" }),
                          query.reload,
                        )
                      }
                    >
                      {translator.t("bc.action.stop")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open === null ? null : <BrowserHistory client={client} sessionId={open} />}
    </>
  );
}

function BrowserHistory({ client, sessionId }: { readonly client: Phase05Client; readonly sessionId: string }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(() => client.getBrowserSession(sessionId), [client, sessionId]);
  const actions = query.value?.actions ?? [];
  const downloads = query.value?.downloads ?? [];
  return (
    <section className="section" id={`browser-history-${sessionId}`} aria-labelledby={`browser-history-title-${sessionId}`}>
      <h3 className="section__title" id={`browser-history-title-${sessionId}`}>
        {translator.t("bc.history.title")}
      </h3>
      {query.loading ? <StateBlock kind="loading" /> : null}
      {actions.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey="bc.history.empty" />
      ) : (
        <table className="table browser-actions">
          <caption className="sr-only">{translator.t("bc.history.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("bc.column.action")}</th>
              <th scope="col">{translator.t("bc.column.target")}</th>
              <th scope="col">{translator.t("bc.column.status")}</th>
              <th scope="col">{translator.t("bc.column.outcome")}</th>
              <th scope="col">{translator.t("bc.column.when")}</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((entry) => (
              <tr key={entry.action_id}>
                <th scope="row">{translator.t(`p05.browser_action.${entry.action}`)}</th>
                <td>
                  <code>{entry.target}</code>
                  {entry.content_digest === undefined ? null : (
                    <code className="muted" title={entry.content_digest}>
                      {" "}
                      {shortDigest(entry.content_digest)}
                    </code>
                  )}
                </td>
                <td>
                  <P05Pill namespace="action_status" member={entry.status} tone={actionStatusTone(entry.status)} />
                  {entry.reason_code === undefined ? null : <code className="muted"> {entry.reason_code}</code>}
                </td>
                <td>{translator.t(`p05.outcome.${entry.outcome}`)}</td>
                <td>{formatInstant(locale, entry.occurred_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {downloads.length === 0 ? null : (
        <>
          <h4>{translator.t("bc.downloads.title")}</h4>
          <ul>
            {downloads.map((download) => (
              <li key={download.download_id}>
                <code>{download.file_name}</code> ({download.byte_count}){" "}
                {download.executable ? <span className="pill pill--WARNING">{translator.t("bc.downloads.executable")}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function ComputerSessions({ client, missionId }: { readonly client: Phase05Client; readonly missionId?: string }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(() => client.listComputerSessions(missionId === undefined ? {} : { mission_id: missionId }), [client, missionId]);
  const action = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const sessions = query.value?.sessions ?? [];
  return (
    <>
      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      <ActionNote state={action.state} />
      {sessions.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey="bc.computer.empty" />
      ) : (
        <table className="table computer-sessions">
          <caption className="sr-only">{translator.t("bc.computer.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("bc.column.window")}</th>
              <th scope="col">{translator.t("bc.column.state")}</th>
              <th scope="col">{translator.t("bc.column.last_observation")}</th>
              <th scope="col">{translator.t("bc.column.last_action")}</th>
              <th scope="col">{translator.t("bc.column.mission")}</th>
              <th scope="col">{translator.t("bc.column.counts")}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.session_id} data-session-id={session.session_id}>
                <th scope="row">
                  {session.target === undefined ? (
                    "—"
                  ) : (
                    <>
                      {session.target.title}
                      <br />
                      <code className="muted">
                        {session.target.executable} · pid {session.target.pid} · {session.target.hwnd}
                      </code>
                    </>
                  )}
                  <br />
                  <span className="pill pill--WARNING">{translator.t("bc.trust.screen")}</span>
                </th>
                <td>
                  <P05Pill namespace="session" member={session.state} tone={sessionTone(session.state)} />
                  {session.closed_reason === undefined ? null : <span className="muted"> {session.closed_reason}</span>}
                </td>
                <td>
                  {session.last_observation === undefined ? (
                    "—"
                  ) : (
                    <>
                      {formatInstant(locale, session.last_observation.observed_at)}
                      <br />
                      <code className="muted" title={session.last_observation.layout_digest}>
                        {translator.t("bc.observation.digest")} {shortDigest(session.last_observation.layout_digest)}
                      </code>
                    </>
                  )}
                </td>
                <td>
                  {session.last_action === undefined ? (
                    "—"
                  ) : (
                    <>
                      {translator.t(`p05.computer_action.${session.last_action.action}`)}{" "}
                      <P05Pill namespace="action_status" member={session.last_action.status} tone={actionStatusTone(session.last_action.status)} />
                    </>
                  )}
                </td>
                <td>
                  <code>{session.mission_id}</code>
                  <br />
                  <code className="muted">{session.agent_id}</code>
                </td>
                <td>
                  {translator.t("bc.computer.counts", {
                    actions: session.action_count,
                    clicks: session.click_count,
                    captures: session.capture_count,
                  })}{" "}
                  <button
                    type="button"
                    className="button button--secondary"
                    aria-expanded={open === session.session_id}
                    aria-controls={open === session.session_id ? `computer-history-${session.session_id}` : undefined}
                    onClick={() => setOpen(open === session.session_id ? null : session.session_id)}
                  >
                    {translator.t("bc.action.history")}
                  </button>{" "}
                  {isTerminalSession(session.state) ? null : (
                    <button
                      type="button"
                      className="button button--primary session-stop"
                      aria-label={`${translator.t("bc.action.stop")} ${session.target?.title ?? session.session_id}`}
                      onClick={() =>
                        void action.run(
                          () => client.stopComputerSession(session.session_id),
                          () => ({ phase: "DONE", messageKey: "bc.stopped" }),
                          query.reload,
                        )
                      }
                    >
                      {translator.t("bc.action.stop")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open === null ? null : <ComputerHistory client={client} sessionId={open} />}
    </>
  );
}

function ComputerHistory({ client, sessionId }: { readonly client: Phase05Client; readonly sessionId: string }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(() => client.getComputerSession(sessionId), [client, sessionId]);
  const actions = query.value?.actions ?? [];
  return (
    <section className="section" id={`computer-history-${sessionId}`} aria-labelledby={`computer-history-title-${sessionId}`}>
      <h3 className="section__title" id={`computer-history-title-${sessionId}`}>
        {translator.t("bc.history.title")}
      </h3>
      {query.loading ? <StateBlock kind="loading" /> : null}
      {actions.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey="bc.history.empty" />
      ) : (
        <table className="table computer-actions">
          <caption className="sr-only">{translator.t("bc.history.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("bc.column.action")}</th>
              <th scope="col">{translator.t("bc.column.target")}</th>
              <th scope="col">{translator.t("bc.column.status")}</th>
              <th scope="col">{translator.t("bc.column.reason")}</th>
              <th scope="col">{translator.t("bc.column.when")}</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((entry) => (
              <tr key={entry.action_id}>
                <th scope="row">{translator.t(`p05.computer_action.${entry.action}`)}</th>
                <td>
                  <code>{entry.target}</code>
                </td>
                <td>
                  <P05Pill namespace="action_status" member={entry.status} tone={actionStatusTone(entry.status)} />
                </td>
                <td>{entry.reason_code === undefined ? "—" : <code>{entry.reason_code}</code>}</td>
                <td>{formatInstant(locale, entry.occurred_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** منح نافذة لمهمّة. المستخدم يختار؛ المضيف يقرأ هويّة النافذة من النظام. */
export function WindowGrants({
  client,
  missions,
  missionId,
}: {
  readonly client: Phase05Client;
  readonly missions?: Phase03Client | undefined;
  readonly missionId?: string;
}) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const [target, setTarget] = useState<string>(missionId ?? "");
  const missionList = useHostQuery(
    () => (missions === undefined ? Promise.resolve({ ok: true as const, value: { missions: [] } }) : missions.listMissions()),
    [missions],
  );
  const query = useHostQuery(() => client.listWindows(target === "" ? {} : { mission_id: target }), [client, target]);
  const action = useAction();
  const windows = query.value?.windows ?? [];
  const grants = query.value?.grants ?? [];
  const open = (missionList.value?.missions ?? []).filter(
    (mission) => mission.state !== "COMPLETED" && mission.state !== "FAILED" && mission.state !== "CANCELLED",
  );

  return (
    <>
      <p className="note" role="note">
        {translator.t("bc.windows.note")}
      </p>
      <ActionNote state={action.state} />
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      {missionId === undefined ? (
        <label>
          {translator.t("bc.windows.mission")}{" "}
          <select id="grant-mission" value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">{translator.t("bc.windows.mission.none")}</option>
            {open.map((mission) => (
              <option key={mission.mission_id} value={mission.mission_id}>
                {mission.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {query.value !== null && !query.value.available ? (
        <StateBlock kind="empty" bodyKey="bc.windows.unavailable" />
      ) : windows.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey="bc.windows.empty" />
      ) : (
        <table className="table desktop-windows">
          <caption className="sr-only">{translator.t("bc.windows.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("bc.column.title")}</th>
              <th scope="col">{translator.t("bc.column.process")}</th>
              <th scope="col">{translator.t("bc.column.status")}</th>
            </tr>
          </thead>
          <tbody>
            {windows.map((window) => (
              <tr key={window.hwnd} data-hwnd={window.hwnd} data-pid={window.pid}>
                <th scope="row">{window.title}</th>
                <td>
                  <code>
                    {window.executable} · pid {window.pid}
                  </code>
                </td>
                <td>
                  {window.grantable ? (
                    <button
                      type="button"
                      className="button button--secondary window-grant"
                      disabled={target === ""}
                      aria-label={`${translator.t("bc.windows.action.grant")} ${window.title}`}
                      onClick={() =>
                        void action.run(
                          () => client.grantWindow(target, window.hwnd),
                          () => ({ phase: "DONE", messageKey: "bc.windows.granted" }),
                          query.reload,
                        )
                      }
                    >
                      {translator.t("bc.windows.action.grant")}
                    </button>
                  ) : (
                    <span className="pill pill--MUTED">
                      {translator.t("bc.windows.not_grantable")}
                      {window.reason === undefined ? "" : ` · ${window.reason}`}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {target === "" ? null : (
        <>
          <h3>{translator.t("bc.grants.title")}</h3>
          {grants.length === 0 ? (
            <StateBlock kind="empty" bodyKey="bc.grants.empty" />
          ) : (
            <ul className="grants">
              {grants.map((grant) => (
                <li key={grant.grant_id} data-grant-id={grant.grant_id}>
                  {grant.title} <code className="muted">{grant.executable} · pid {grant.pid} · {formatInstant(locale, grant.granted_at)}</code>{" "}
                  <button
                    type="button"
                    className="button button--secondary"
                    aria-label={`${translator.t("bc.grants.action.revoke")} ${grant.title}`}
                    onClick={() =>
                      void action.run(
                        () => client.revokeWindow(grant.grant_id),
                        () => ({ phase: "DONE", messageKey: "bc.grants.revoked" }),
                        query.reload,
                      )
                    }
                  >
                    {translator.t("bc.grants.action.revoke")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
