// أقسام إعدادات Phase-08: بيئة التنفيذ، والمتصفّح الحقيقي، والصوت، والحسابات المتصلة (OAuth)،
// والنشر، وحزم المهارات، والأجهزة وقابلية النقل، والمشاركة. كل قسم يعرض ما قاسه المضيف ويكتب
// عبر عملياته المسمّاة؛ لا قيمة سرّ تُعرض ولا تُكتب هنا.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { Phase06Client } from "../../ipc/p06-client";
import type { Phase08Client } from "../../ipc/p08-client";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { readPicked } from "../../p08/files";
import { WORK_PROFILE } from "../../p08/workProfile";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { GitHubPanel, NotificationsPanel, WebSearchPanel } from "./ClosurePanels";

export const P08_SETTINGS_SECTIONS = ["EXECUTION", "BROWSER_ENGINE", "WEB_SEARCH", "VOICE", "NOTIFICATIONS", "ACCOUNTS", "GITHUB", "PUBLISHING", "PACKAGES", "DEVICES", "SCHEDULES"] as const;
export type P08Section = (typeof P08_SETTINGS_SECTIONS)[number];

function Fact({ labelKey, value }: { readonly labelKey: string; readonly value: string }) {
  const translator = useTranslator();
  return (
    <>
      <dt>{translator.t(labelKey)}</dt>
      <dd>{value}</dd>
    </>
  );
}

function ExecutionPanel({ client }: { readonly client: Phase08Client }) {
  const translator = useTranslator();
  const action = useAction();
  const status = useHostQuery(() => client.executionStatus(), [client, action.state]);
  const s = status.value;
  const yes = (v: boolean) => translator.t(v ? "p08.yes" : "p08.no");
  return (
    <div className="card">
      {status.error !== null ? <ErrorNote error={status.error} onRetry={status.reload} /> : null}
      {s === null ? null : (
        <dl className="facts">
          <Fact labelKey="p08.exec.isolation" value={s.isolation} />
          <Fact labelKey="p08.exec.powershell" value={s.powershell.available ? translator.t("p08.available") : s.powershell.detail} />
          <Fact labelKey="p08.exec.python" value={s.python.available ? translator.t("p08.exec.python_ready", { version: s.python_version ?? "?" }) : s.python.detail} />
          <Fact labelKey="p08.exec.python_source" value={yes(s.python_source_found)} />
          <Fact labelKey="p08.exec.pdf_font" value={yes(s.pdf_font_available)} />
          <Fact labelKey="p08.exec.export_folder" value={yes(s.export_folder_configured)} />
        </dl>
      )}
      <p className="note">{translator.t("p08.exec.note")}</p>
      <div className="toolbar">
        <button
          type="button"
          className="button"
          disabled={s === null || !s.python_source_found || s.python.available}
          onClick={() => void action.run(() => client.preparePython(), (v) => ({ phase: "DONE", messageKey: "p08.exec.prepared", values: { version: v.version, files: v.files } }))}
        >
          {translator.t("p08.exec.prepare_python")}
        </button>
      </div>
      <ActionNote state={action.state} />
    </div>
  );
}

function SettingToggle({ client, keyName, labelKey, noteKey }: { readonly client: Phase08Client; readonly keyName: "browser.engine_enabled"; readonly labelKey: string; readonly noteKey: string }) {
  const translator = useTranslator();
  const action = useAction();
  const status = useHostQuery(() => client.executionStatus(), [client, action.state]);
  const value = status.value?.settings[keyName];
  const enabled = value !== false;
  return (
    <div className="card">
      <div className="row">
        <label className="check" htmlFor={`p08-${keyName}`}>
          <input
            id={`p08-${keyName}`}
            type="checkbox"
            checked={enabled}
            onChange={(e) => void action.run(() => client.setIntegrationSetting(keyName, e.target.checked), () => ({ phase: "DONE", messageKey: "p08.saved" }))}
          />
          {translator.t(labelKey)}
        </label>
      </div>
      <p className="note">{translator.t(noteKey)}</p>
      <ActionNote state={action.state} />
    </div>
  );
}

function VoicePanel({ client }: { readonly client: Phase08Client }) {
  const translator = useTranslator();
  const action = useAction();
  const status = useHostQuery(() => client.executionStatus(), [client, action.state]);
  const current = (status.value?.settings["voice.transcription_endpoint"] as string | undefined) ?? "";
  const currentModel = (status.value?.settings["voice.transcription_model"] as string | undefined) ?? "";
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  return (
    <div className="card form-grid">
      <label htmlFor="voice-endpoint">{translator.t("p08.voice.endpoint")}</label>
      <input id="voice-endpoint" dir="ltr" placeholder={translator.t("p08.voice.endpoint_hint")} value={endpoint ?? current} onChange={(e) => setEndpoint(e.target.value)} />
      <label htmlFor="voice-model">{translator.t("p08.voice.model")}</label>
      <input id="voice-model" dir="ltr" value={model ?? currentModel} onChange={(e) => setModel(e.target.value)} />
      <p className="note">{translator.t("p08.voice.note")}</p>
      <div className="toolbar">
        <button
          type="button"
          className="button"
          onClick={() =>
            void action.run(
              async () => {
                const first = await client.setIntegrationSetting("voice.transcription_endpoint", (endpoint ?? current).trim() === "" ? null : (endpoint ?? current).trim());
                if (!first.ok) return first;
                return client.setIntegrationSetting("voice.transcription_model", (model ?? currentModel).trim() === "" ? null : (model ?? currentModel).trim());
              },
              () => ({ phase: "DONE", messageKey: "p08.saved" }),
            )
          }
        >
          {translator.t("p08.save")}
        </button>
      </div>
      <ActionNote state={action.state} />
    </div>
  );
}

function AccountsPanel({ client }: { readonly client: Phase08Client }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const action = useAction();
  const list = useHostQuery(() => client.listOAuth(), [client, action.state]);
  const [provider, setProvider] = useState("google");
  const [clientId, setClientId] = useState("");
  const [consent, setConsent] = useState<string | null>(null);
  return (
    <div className="card">
      <p className="note">{translator.t("p08.accounts.note")}</p>
      <div className="form-grid">
        <label htmlFor="oauth-provider">{translator.t("p08.accounts.provider")}</label>
        <select id="oauth-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {(list.value?.providers ?? []).map((p) => (
            <option key={p.provider_id} value={p.provider_id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <label htmlFor="oauth-client">{translator.t("p08.accounts.client_id")}</label>
        <input id="oauth-client" dir="ltr" value={clientId} onChange={(e) => setClientId(e.target.value)} />
      </div>
      <div className="toolbar">
        <button
          type="button"
          className="button"
          disabled={clientId.trim() === ""}
          onClick={() =>
            void action.run(
              () => client.connectOAuth(provider, clientId.trim()),
              (v) => {
                setConsent(v.opened_in_browser ? null : v.consent_url);
                return { phase: "DONE", messageKey: v.opened_in_browser ? "p08.accounts.opened" : "p08.accounts.open_manually" };
              },
            )
          }
        >
          {translator.t("p08.accounts.connect")}
        </button>
      </div>
      <ActionNote state={action.state} />
      {consent === null ? null : (
        <p className="note mono" dir="ltr">
          {consent}
        </p>
      )}
      <ul className="list">
        {(list.value?.connections ?? []).map((c) => (
          <li key={c.connection_id} className="list__row">
            <span className="list__title">{c.display_name}</span>
            <span className="badge">{translator.t(`p08.accounts.status.${c.status}`)}</span>
            <span className="list__meta">{formatInstant(locale, c.updated_at)}</span>
            <button type="button" className="link-button" onClick={() => void action.run(() => client.disconnectOAuth(c.connection_id), () => ({ phase: "DONE", messageKey: "p08.accounts.disconnected" }))}>
              {translator.t("p08.accounts.disconnect")}
            </button>
          </li>
        ))}
      </ul>
      {list.error !== null ? <ErrorNote error={list.error} onRetry={list.reload} /> : null}
    </div>
  );
}

function PublishingPanel({ client }: { readonly client: Phase08Client }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const action = useAction();
  const list = useHostQuery(() => client.listPublications(), [client, action.state]);
  return (
    <div className="card">
      <p className="note">{translator.t("p08.publish.note")}</p>
      <ul className="list">
        {(list.value?.publications ?? []).map((p) => (
          <li key={p.publication_id} className="list__row">
            <span className="list__title">{p.publisher}</span>
            <span className="badge">{translator.t(`p08.publish.status.${p.status}`)}</span>
            <span className="list__meta">{formatInstant(locale, p.created_at)}</span>
            {p.status !== "AWAITING_APPROVAL" ? null : (
              <>
                <button type="button" className="button" onClick={() => void action.run(() => client.decidePublication(p.publication_id, "GRANT"), () => ({ phase: "DONE", messageKey: "p08.publish.granted" }))}>
                  {translator.t("p08.approval.grant")}
                </button>
                <button type="button" className="button button--secondary" onClick={() => void action.run(() => client.decidePublication(p.publication_id, "DENY"), () => ({ phase: "DONE", messageKey: "p08.publish.denied" }))}>
                  {translator.t("p08.approval.deny")}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {(list.value?.publications ?? []).length === 0 ? <p className="panel__empty">{translator.t("p08.publish.empty")}</p> : null}
      <ActionNote state={action.state} />
    </div>
  );
}

function PackagesPanel({ client }: { readonly client: Phase08Client }) {
  const translator = useTranslator();
  const action = useAction();
  const list = useHostQuery(() => client.listSkillPackages(), [client, action.state]);
  return (
    <div className="card">
      <p className="note">{translator.t("p08.packages.note")}</p>
      <label className="button button--secondary file-button" htmlFor="pkg-file">
        {translator.t("p08.packages.import")}
      </label>
      <input
        id="pkg-file"
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file === undefined) return;
          void action.run(
            async () => client.importSkillPackage(await file.text()),
            (v) => ({ phase: "DONE", messageKey: "p08.packages.imported", values: { state: v.package.trust_state } }),
          );
        }}
      />
      <ActionNote state={action.state} />
      <ul className="list">
        {(list.value?.packages ?? []).map((p) => (
          <li key={`${p.package_id}-${p.imported_at}`} className="list__row">
            <span className="list__title">{p.name === "" ? p.package_id : p.name}</span>
            <span className="list__meta">{p.version}</span>
            <span className="badge">{p.trust_state}</span>
            <span className="badge">{p.signature_state}</span>
            {/* T-6 (تدقيق 2026-10-19): مستورد لا يعني مفعّلًا ولا منفّذًا. الحزمة وصف لا شيفرة، ولا تمنح شيئًا. */}
            <span className="badge">{translator.t("p08.packages.inert")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DevicesPanel({ client }: { readonly client: Phase08Client }) {
  const translator = useTranslator();
  const action = useAction();
  const status = useHostQuery(() => client.executionStatus(), [client]);
  return (
    <div className="card">
      <dl className="facts">
        <Fact labelKey="p08.devices.id" value={status.value?.device_id ?? ""} />
      </dl>
      <p className="note">{translator.t("p08.devices.note")}</p>
      <label className="button button--secondary file-button" htmlFor="bundle-file">
        {translator.t("p08.devices.import")}
      </label>
      <input
        id="bundle-file"
        type="file"
        accept=".zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file === undefined) return;
          void action.run(
            async () => {
              const picked = await readPicked(file);
              if (picked === "TOO_LARGE") return client.importWorkspace("");
              return client.importWorkspace(picked.base64);
            },
            (v) => ({ phase: "DONE", messageKey: "p08.devices.imported", values: { count: v.files } }),
          );
        }}
      />
      <ActionNote state={action.state} />
    </div>
  );
}

/** ملف العمل: فعل صريح من المستخدم يكتب حدوده هو (طبقة USER)؛ لا يوسّع مهمّة بعينها ولا يمنح موافقة. */
function WorkProfileCard({ config }: { readonly config: Phase06Client }) {
  const translator = useTranslator();
  const action = useAction();
  return (
    <div className="card">
      <h3 className="card__title">{translator.t("p08.work.title")}</h3>
      <p className="section__hint">{translator.t("p08.work.hint")}</p>
      <button
        type="button"
        className="button"
        id="p08-work-profile"
        onClick={() =>
          void action.run(
            async () => {
              const refused: string[] = [];
              for (const [key, value] of WORK_PROFILE) {
                const r = await config.setConfig({ layer: "USER" }, key, value);
                if (!r.ok) refused.push(key);
              }
              return { ok: true as const, value: refused };
            },
            (refused) => (refused.length === 0 ? { phase: "DONE", messageKey: "p08.work.applied" } : { phase: "DONE", messageKey: "p08.work.partial", values: { refused: refused.join(", ") } }),
          )
        }
      >
        {translator.t("p08.work.apply")}
      </button>
      <ActionNote state={action.state} />
    </div>
  );
}

export function Phase08SettingsSection({ client, section, onOpen, config }: { readonly client: Phase08Client; readonly section: P08Section; onOpen(path: string): void; readonly config?: Phase06Client | undefined }) {
  const translator = useTranslator();
  return (
    <section className="section" aria-labelledby={`p08-section-${section}`}>
      <h2 className="section__title" id={`p08-section-${section}`}>
        {translator.t(`p08.section.${section}`)}
      </h2>
      <p className="section__hint">{translator.t(`p08.section.${section}.hint`)}</p>
      {section === "EXECUTION" ? <ExecutionPanel client={client} /> : null}
      {section === "EXECUTION" && config !== undefined ? <WorkProfileCard config={config} /> : null}
      {section === "BROWSER_ENGINE" ? <SettingToggle client={client} keyName="browser.engine_enabled" labelKey="p08.browser.enabled" noteKey="p08.browser.note" /> : null}
      {section === "WEB_SEARCH" ? <WebSearchPanel client={client} /> : null}
      {section === "VOICE" ? <VoicePanel client={client} /> : null}
      {section === "NOTIFICATIONS" ? <NotificationsPanel client={client} /> : null}
      {section === "GITHUB" ? <GitHubPanel client={client} /> : null}
      {section === "ACCOUNTS" ? <AccountsPanel client={client} /> : null}
      {section === "PUBLISHING" ? <PublishingPanel client={client} /> : null}
      {section === "PACKAGES" ? <PackagesPanel client={client} /> : null}
      {section === "DEVICES" ? <DevicesPanel client={client} /> : null}
      {section === "SCHEDULES" ? (
        <div className="card">
          <button type="button" className="button" onClick={() => onOpen("/schedules")}>
            {translator.t("p08.home.manage_schedules")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
