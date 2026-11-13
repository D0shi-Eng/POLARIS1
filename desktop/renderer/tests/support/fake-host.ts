// بديل اختبار للمضيف.
//
// ما يُثبته هذا البديل هو سلوك العارض، لا سلوك المضيف: المضيف يُختبَر في مساره
// الخاص بـ`cargo test` فوق مُحقِّق JSON Schema حقيقي. ولذلك يبقى الفهرس هنا
// صغيرًا عمدًا ولا يحاول محاكاة فهرس الإعدادات كاملًا — نسخة ثانية من الفهرس
// كانت ستنجرف، وكانت ستجعل الاختبار يقيس نسخته بدل أن يقيس المنتج.

import { validateAgainstSchemaReference } from "../../src/ipc/validator";
import type { Transport } from "../../src/ipc/transport";

const SESSION = "7a5a2c22-1cbb-4a41-9a8f-7b1c2d3e4f50";
const PRINCIPAL = "1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60";

export const SNAPSHOT = {
  app_version: "0.1.0",
  build_channel: "DEV",
  platform: "WINDOWS",
  architecture: "X64",
  locale: "en",
  direction: "LTR",
  appearance: "SYSTEM",
  runtime_status: {
    reachability: "NOT_ATTACHED",
    availability: { state: "UNAVAILABLE", reason: "PHASE_NOT_IMPLEMENTED" },
  },
  enabled_capabilities: ["polaris.desktop.home", "polaris.desktop.settings"],
  unavailable_capabilities: [
    { capability_id: "polaris.desktop.projects", availability: { state: "UNAVAILABLE", reason: "PHASE_NOT_IMPLEMENTED" } },
    { capability_id: "polaris.desktop.models", availability: { state: "UNAVAILABLE", reason: "PROVIDER_NOT_CONFIGURED" } },
  ],
  settings_schema_version: "1.0",
  ipc_protocol_version: "1.1",
} as const;

const AVAILABLE = new Set(["polaris.desktop.home", "polaris.desktop.settings"]);

const SECTIONS = [
  {
    section_id: "general.appearance",
    label_key: "settings.section.general.appearance",
    mode: "READ_ONLY",
    availability_reason: "PHASE_NOT_IMPLEMENTED",
    settings: [
      {
        setting_id: "appearance",
        value_kind: "APPEARANCE",
        mode: "READ_ONLY",
        label_key: "settings.general.appearance.appearance",
        availability_reason: "PHASE_NOT_IMPLEMENTED",
      },
    ],
  },
  {
    section_id: "ai.models",
    label_key: "settings.section.ai.models",
    mode: "UNAVAILABLE_THIS_PHASE",
    availability_reason: "PROVIDER_NOT_CONFIGURED",
    settings: [
      {
        setting_id: "configured-model-count",
        value_kind: "INTEGER",
        mode: "READ_ONLY",
        label_key: "settings.ai.models.configured-model-count",
        availability_reason: "PHASE_NOT_IMPLEMENTED",
      },
    ],
  },
  {
    section_id: "security.sandboxing",
    label_key: "settings.section.security.sandboxing",
    mode: "READ_ONLY",
    availability_reason: "PHASE_NOT_IMPLEMENTED",
    settings: [
      {
        setting_id: "desktop-host-confined",
        value_kind: "BOOLEAN",
        mode: "READ_ONLY",
        label_key: "settings.security.sandboxing.desktop-host-confined",
        availability_reason: "PHASE_NOT_IMPLEMENTED",
      },
    ],
  },
];

function reply(request: Record<string, unknown>, body: Record<string, unknown>): Record<string, unknown> {
  return {
    contract_version: "1.1",
    protocol_version: "1.1",
    message_type: "RESPONSE",
    message_id: "9e8d7c6b-5a49-4382-b170-6f5e4d3c2b1a",
    request_id: request["message_id"],
    causation_id: request["message_id"],
    correlation_id: request["correlation_id"],
    session_id: SESSION,
    caller_identity: {
      caller_type: "CORE_UI",
      principal_id: PRINCIPAL,
      trust_tier: "TIER_2_UNTRUSTED",
      session_id: SESSION,
    },
    timestamp: "2026-09-15T00:00:00Z",
    ...body,
  };
}

export interface FakeHostOptions {
  /** يجعل العمليات المذكورة تفشل بخطأ حدّ حقيقي الشكل. غياب القائمة يعني كل العمليات. */
  readonly failWith?: { readonly code: string; readonly display_message: string; readonly retryable: boolean };
  /** يحصر الفشل في عمليات بعينها، فيبقى الإقلاع ناجحًا وتفشل القراءة وحدها. */
  readonly failOperations?: readonly string[];
  /** يرفع استثناء نقل بدل الردّ. يُستعمل لإثبات شاشة فشل الإقلاع. */
  readonly throwOnSend?: Error;
}

/** بديل نقل يعيد ردودًا صالحة مقابل عقد الظرف نفسه. */
export function fakeHost(options: FakeHostOptions = {}): Transport {
  return {
    async send(envelope: unknown): Promise<unknown> {
      if (options.throwOnSend !== undefined) throw options.throwOnSend;
      const request = envelope as Record<string, unknown>;

      const operation = request["operation"];
      if (
        options.failWith !== undefined &&
        (options.failOperations === undefined || options.failOperations.includes(String(operation)))
      ) {
        return reply(request, { error: options.failWith });
      }

      const payload = (request["payload"] ?? {}) as Record<string, unknown>;

      if (operation === "desktop.bootstrap") return reply(request, { result: SNAPSHOT });
      if (operation === "desktop.runtime.status") {
        return reply(request, {
          result: { runtime_status: SNAPSHOT.runtime_status, observed_at: "2026-09-15T00:00:00Z" },
        });
      }
      if (operation === "desktop.capability.availability") {
        const ids = (payload["capability_ids"] ?? []) as string[];
        return reply(request, {
          result: {
            capabilities: ids.map((id) => ({
              capability_id: id,
              availability: AVAILABLE.has(id)
                ? { state: "AVAILABLE" }
                : { state: "UNAVAILABLE", reason: "PHASE_NOT_IMPLEMENTED" },
            })),
          },
        });
      }
      if (operation === "desktop.settings.describe") {
        return reply(request, { result: { settings_schema_version: "1.0", sections: SECTIONS } });
      }
      if (operation === "desktop.settings.read") {
        const sectionId = payload["section_id"];
        const section = SECTIONS.find((entry) => entry.section_id === sectionId);
        if (section === undefined) {
          return reply(request, {
            error: { code: "POLICY_DENIED", display_message: "desktop.error.feature_not_available", retryable: false },
          });
        }
        return reply(request, {
          result: {
            section_id: sectionId,
            settings: section.settings.map((setting) => ({
              setting_id: setting.setting_id,
              mode: setting.mode,
              availability_reason: setting.availability_reason,
              ...(setting.setting_id === "configured-model-count"
                ? { value: { kind: "INTEGER", integer_value: 0 } }
                : setting.setting_id === "appearance"
                  ? { value: { kind: "APPEARANCE", code_value: "SYSTEM" } }
                  : { value: { kind: "BOOLEAN", boolean_value: false } }),
            })),
          },
        });
      }

      return reply(request, {
        error: { code: "CONTRACT_VIOLATION", display_message: "desktop.error.unsupported_operation", retryable: false },
      });
    },
  };
}

/** يتأكد أن البديل نفسه يُنتج مستندات صالحة؛ بديلٌ غير صالح يُفسد كل اختبار فوقه. */
export function assertFakeHostIsContractValid(): void {
  const check = validateAgainstSchemaReference(
    "desktop-result.v1.schema.json#/$defs/DesktopBootstrapResultV1",
    SNAPSHOT,
  );
  if (!check.ok) {
    throw new Error(`the fake host snapshot is not contract-valid: ${JSON.stringify(check.findings)}`);
  }
}

export const IDENTITY = { principalId: PRINCIPAL, sessionId: SESSION };
