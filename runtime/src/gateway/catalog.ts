// فهرس القدرات. سطح القدرات في W4 اثنتان فقط: قراءة ملف وكتابة ملف.
//
// كل قدرة قالب ثابت (الآثار، مستوى الخطورة، متطلبات التنفيذ، دلالة التكرار)
// يُجسَّد بمورد محدد عند كل استدعاء. المتغير الوحيد هو المورد؛ كل ما عداه
// مُعلن مسبقًا ولا يستطيع مقترح النموذج تغييره.

import type { EffectAction } from "../effects.js";
import type { Doc } from "../policy/types.js";
import type { GrantOperation } from "../pep/grant.js";

export interface CapabilityTemplate {
  readonly capability_id: string;
  readonly capability_version: string;
  readonly display_name: string;
  readonly description: string;
  readonly effects: readonly EffectAction[];
  readonly risk_class: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly operation: GrantOperation;
  /** الوسيطات المسموح بها. أي وسيطة أخرى في مقترح النموذج ترفض الاقتراح. */
  readonly allowed_arguments: readonly string[];
  readonly required_arguments: readonly string[];
  readonly max_wall_clock_ms: number;
  readonly max_output_bytes: number;
}

export const READ_FILE: CapabilityTemplate = {
  capability_id: "polaris.fs.read_file",
  capability_version: "1.0.0",
  display_name: "Read a file",
  description: "Reads a single file from an explicitly granted path.",
  effects: ["read.filesystem"],
  risk_class: "LOW",
  operation: "READ_FILE",
  allowed_arguments: ["path", "encoding"],
  required_arguments: ["path"],
  max_wall_clock_ms: 5000,
  max_output_bytes: 262144,
};

export const WRITE_FILE: CapabilityTemplate = {
  capability_id: "polaris.fs.write_file",
  capability_version: "1.0.0",
  display_name: "Write a file",
  description: "Creates or replaces a single file inside an explicitly granted write scope.",
  // create.filesystem و write.filesystem معًا: الإنشاء والتعديل أثران مختلفان،
  // والقدرة تعلن كليهما لأنها قد تفعل أيًا منهما حسب وجود الهدف.
  effects: ["create.filesystem", "write.filesystem"],
  risk_class: "MEDIUM",
  operation: "WRITE_FILE",
  allowed_arguments: ["path", "content", "encoding", "overwrite"],
  required_arguments: ["path", "content"],
  max_wall_clock_ms: 5000,
  max_output_bytes: 262144,
};

const TEMPLATES: readonly CapabilityTemplate[] = [READ_FILE, WRITE_FILE];

export function findCapability(capabilityId: string): CapabilityTemplate | undefined {
  return TEMPLATES.find((template) => template.capability_id === capabilityId);
}

export function capabilityIds(): readonly string[] {
  return TEMPLATES.map((t) => t.capability_id);
}

function resourceRef(locator: string): Doc {
  return { kind: "FILESYSTEM_PATH", locator, scope: "EXACT" };
}

/**
 * يجسّد الواصف لمورد بعينه. الواصف يبقى "طلب صلاحية" لا شهادة أمان،
 * كما ينص العقد نفسه عبر effect_declaration_semantics.
 */
export function materializeDescriptor(template: CapabilityTemplate, locator: string): Doc {
  const resource = resourceRef(locator);
  return {
    contract_version: "1.0",
    capability_id: template.capability_id,
    capability_version: template.capability_version,
    display_name: template.display_name,
    description: template.description,
    source: { origin: "BUILT_IN", publisher_id: "polaris.core" },
    input_schema_ref: `capabilities/fs/${template.operation.toLowerCase()}.input.v1.json`,
    output_schema_ref: `capabilities/fs/${template.operation.toLowerCase()}.output.v1.json`,
    effect_declaration_semantics: "REQUESTED_PRIVILEGE",
    requested_effects: template.effects.map((action) => ({
      action,
      resource: { ...resource },
      data_classification: "INTERNAL",
    })),
    risk_class: template.risk_class,
    execution_requirements: executionRequirements(template, locator),
    idempotency: {
      semantics: "AT_MOST_ONCE_LOCAL",
      retry_safe: template.operation === "READ_FILE",
      key_derivation: "ARGUMENT_DIGEST",
    },
    platform_requirements: ["ANY"],
    provenance: { signed: false },
  };
}

/**
 * متطلبات التنفيذ ثابتة لكل قدرة: حصر، نطاق ممنوح صراحة، شجرة عمليات محصورة،
 * لا شبكة، وراثة مقابض صريحة فقط، وبيئة مبنية. لا يوجد مسار يخفّف أيًا منها.
 */
export function executionRequirements(template: CapabilityTemplate, locator: string): Doc {
  return {
    confinement: "CONFINED",
    filesystem_scope: "EXPLICIT_GRANT",
    process_tree: "CONFINED_KILL_ON_CLOSE",
    network: "NONE",
    handle_inheritance: "EXPLICIT_ONLY",
    environment: "EXPLICIT_ONLY",
    granted_paths: [resourceRef(locator)],
    max_wall_clock_ms: template.max_wall_clock_ms,
    max_output_bytes: template.max_output_bytes,
  };
}

export { resourceRef };
