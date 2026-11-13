// ملاحظات الحالة: خطأ مصنَّف، أو نتيجة فعل. نصّ من مفتاح، ورمز لا تفصيل.

import type { ActionState } from "../../app/useHostQuery";
import { useTranslator } from "../../app/context";
import type { DisplayError } from "../../ipc/errors";

export function ErrorNote({ error, onRetry }: { readonly error: DisplayError; readonly onRetry?: () => void }) {
  const translator = useTranslator();
  return (
    <div className="alert" role="alert">
      <p>{translator.t(error.displayKey)}</p>
      <p className="state__code">{translator.t("bootstrap.error.code", { code: error.code })}</p>
      {onRetry === undefined || !error.retryable ? null : (
        <button type="button" className="button button--secondary" onClick={onRetry}>
          {translator.t("state.retry")}
        </button>
      )}
    </div>
  );
}

export function ActionNote({ state }: { readonly state: ActionState }) {
  const translator = useTranslator();
  if (state.phase === "IDLE") return null;
  if (state.phase === "RUNNING") {
    return (
      <p className="note" role="status" aria-live="polite">
        {translator.t("p02.action.running")}
      </p>
    );
  }
  if (state.phase === "FAILED") return <ErrorNote error={state.error} />;
  return (
    <p className="success" role="status" aria-live="polite">
      {translator.t(state.messageKey, state.values)}
    </p>
  );
}
