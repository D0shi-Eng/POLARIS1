// أقسام إعدادات الإغلاق الوظيفي (ADR-042، 2026-10-19): بحث الويب، وGitHub، والإشعارات.
//
// كل قسم يعرض ما قاسه المضيف ويكتب عبر عملياته المسمّاة. المفتاح والرمز يُكتبان في حقل كلمة مرور ويذهبان إلى مخزن اعتماد النظام؛
// لا يعودان إلى الواجهة أبدًا، فلا حقل يُعاد ملؤه بهما. ولا قسم يدّعي ما لم يحدث: «جاهز» من حالة المضيف، و«نجح» من نتيجة الاختبار.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { Phase08Client } from "../../ipc/p08-client";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";

type Provider = "SEARXNG" | "BRAVE";

export function WebSearchPanel({ client }: { readonly client: Phase08Client }) {
  const translator = useTranslator();
  const action = useAction();
  const status = useHostQuery(() => client.webSearchStatus(), [client, action.state]);
  const settings = useHostQuery(() => client.executionStatus(), [client, action.state]);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [test, setTest] = useState<{ readonly outcome: string; readonly results: number; readonly ms: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const runTest = async () => {
    setTesting(true);
    setTest(null);
    const result = await client.testWebSearch();
    setTesting(false);
    setTest(result.ok ? { outcome: result.value.outcome, results: result.value.results, ms: result.value.duration_ms } : { outcome: "FAILED", results: 0, ms: 0 });
  };
  const s = status.value;
  const provider: Provider | "NONE" = s?.provider ?? "NONE";
  const currentEndpoint = (settings.value?.settings["web.search_endpoint"] as string | undefined) ?? "";
  const choose = (next: Provider) => void action.run(() => client.setIntegrationSetting("web.search_provider", next), () => ({ phase: "DONE", messageKey: "p08.saved" }));
  return (
    <div className="card">
      {status.error !== null ? <ErrorNote error={status.error} onRetry={status.reload} /> : null}
      <fieldset className="form-grid">
        <legend>{translator.t("p08.search.provider")}</legend>
        {(["BRAVE", "SEARXNG"] as const).map((option) => (
          <label className="check" key={option} htmlFor={`search-provider-${option}`}>
            <input id={`search-provider-${option}`} type="radio" name="search-provider" checked={provider === option} onChange={() => choose(option)} />
            {translator.t(`p08.search.provider.${option}`)}
          </label>
        ))}
      </fieldset>
      <p className="note" role="status">
        {s === null ? translator.t("state.loading") : translator.t(s.ready ? "p08.search.ready" : "p08.search.not_ready", { provider: translator.t(`p08.search.provider.${provider}`) })}
      </p>
      {provider === "BRAVE" ? (
        <div className="form-grid">
          <label htmlFor="search-brave-key">{translator.t("p08.search.brave_key")}</label>
          <input id="search-brave-key" type="password" dir="ltr" autoComplete="off" placeholder={translator.t(s?.brave_key_configured === true ? "p08.search.key_stored" : "p08.search.key_missing")} value={key} onChange={(e) => setKey(e.target.value)} />
          <p className="note">{translator.t("p08.search.brave_note")}</p>
          <div className="toolbar">
            <button
              type="button"
              className="button"
              disabled={key.trim().length < 8}
              onClick={() =>
                void action.run(
                  () => client.putWebSearchKey(key.trim()),
                  () => {
                    setKey("");
                    return { phase: "DONE", messageKey: "p08.search.key_saved" };
                  },
                )
              }
            >
              {translator.t("p08.save")}
            </button>
            <button type="button" className="button" disabled={s?.brave_key_configured !== true} onClick={() => void action.run(() => client.putWebSearchKey(null), () => ({ phase: "DONE", messageKey: "p08.search.key_removed" }))}>
              {translator.t("p08.search.key_remove")}
            </button>
          </div>
        </div>
      ) : null}
      {provider === "SEARXNG" ? (
        <div className="form-grid">
          <label htmlFor="search-endpoint">{translator.t("p08.search.endpoint")}</label>
          <input id="search-endpoint" dir="ltr" placeholder={translator.t("p08.search.endpoint_hint")} value={endpoint ?? currentEndpoint} onChange={(e) => setEndpoint(e.target.value)} />
          <p className="note">{translator.t("p08.search.searxng_note")}</p>
          <div className="toolbar">
            <button
              type="button"
              className="button"
              onClick={() => void action.run(() => client.setIntegrationSetting("web.search_endpoint", (endpoint ?? currentEndpoint).trim() === "" ? null : (endpoint ?? currentEndpoint).trim()), () => ({ phase: "DONE", messageKey: "p08.saved" }))}
            >
              {translator.t("p08.save")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="toolbar">
        <button
          type="button"
          className="button"
          disabled={provider === "NONE" || testing}
          onClick={() => void runTest()}
        >
          {translator.t(testing ? "p08.search.testing" : "p08.search.test")}
        </button>
      </div>
      {test === null ? null : (
        <p className={test.outcome === "OK" ? "success" : "note tone-bad"} role="status" aria-live="polite">
          {translator.t(`p08.search.test.${test.outcome}`, { count: test.results, ms: test.ms })}
        </p>
      )}
      <ActionNote state={action.state} />
    </div>
  );
}

export function GitHubPanel({ client }: { readonly client: Phase08Client }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const action = useAction();
  const status = useHostQuery(() => client.githubStatus(), [client, action.state]);
  const [token, setToken] = useState("");
  const s = status.value;
  return (
    <div className="card">
      {status.error !== null ? <ErrorNote error={status.error} onRetry={status.reload} /> : null}
      <p className="note">{translator.t("p08.github.note")}</p>
      {s?.connected === true ? (
        <>
          <dl className="facts">
            <dt>{translator.t("p08.github.account")}</dt>
            <dd dir="ltr">{s.login ?? "—"}</dd>
            <dt>{translator.t("p08.github.kind")}</dt>
            <dd>{translator.t(`p08.github.kind.${s.grant_kind ?? "UNKNOWN"}`)}</dd>
            <dt>{translator.t("p08.github.checked")}</dt>
            <dd>{s.checked_at === undefined ? "—" : formatInstant(locale, s.checked_at)}</dd>
          </dl>
          {s.grant_kind === "CLASSIC" ? <p className="note tone-bad">{translator.t("p08.github.classic_warning")}</p> : null}
          <div className="toolbar">
            <button type="button" className="button" onClick={() => void action.run(() => client.disconnectGitHub(), () => ({ phase: "DONE", messageKey: "p08.github.disconnected" }))}>
              {translator.t("p08.github.disconnect")}
            </button>
          </div>
        </>
      ) : (
        <div className="form-grid">
          <label htmlFor="github-token">{translator.t("p08.github.token")}</label>
          <input id="github-token" type="password" dir="ltr" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
          <div className="toolbar">
            <button
              type="button"
              className="button"
              disabled={token.trim().length < 20 || action.state.phase === "RUNNING"}
              onClick={() =>
                void action.run(
                  () => client.connectGitHub(token.trim()),
                  (result) => {
                    setToken("");
                    return { phase: "DONE", messageKey: "p08.github.connected", values: { login: result.login ?? "" } };
                  },
                )
              }
            >
              {translator.t("p08.github.connect")}
            </button>
          </div>
        </div>
      )}
      <ActionNote state={action.state} />
    </div>
  );
}

export function NotificationsPanel({ client }: { readonly client: Phase08Client }) {
  const translator = useTranslator();
  const action = useAction();
  const status = useHostQuery(() => client.executionStatus(), [client, action.state]);
  const settings = status.value?.settings;
  // مفعّلة ما لم يطفئها المستخدم، وصوتها مطفأ ما لم يشغّله (كما يقرّرها المضيف).
  const enabled = settings?.["notifications.enabled"] !== false;
  const sound = settings?.["notifications.sound"] === true;
  const toggle = (key: "notifications.enabled" | "notifications.sound", value: boolean) => void action.run(() => client.setIntegrationSetting(key, value), () => ({ phase: "DONE", messageKey: "p08.saved" }));
  return (
    <div className="card">
      <div className="row">
        <label className="check" htmlFor="notify-enabled">
          <input id="notify-enabled" type="checkbox" checked={enabled} onChange={(e) => toggle("notifications.enabled", e.target.checked)} />
          {translator.t("p08.notify.enabled")}
        </label>
      </div>
      <div className="row">
        <label className="check" htmlFor="notify-sound">
          <input id="notify-sound" type="checkbox" checked={sound} disabled={!enabled} onChange={(e) => toggle("notifications.sound", e.target.checked)} />
          {translator.t("p08.notify.sound")}
        </label>
      </div>
      <p className="note">{translator.t("p08.notify.note")}</p>
      <ActionNote state={action.state} />
    </div>
  );
}
