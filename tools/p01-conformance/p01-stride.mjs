// مراجعة STRIDE المصغّرة على أسطح Phase-01 السبعة.
//
// بيانات لا نثر: الوثيقة تُبنى من هذا الملف، والبوابة تقرأ منه. مراجعة تعيش في
// Markdown وحده لا يستطيع أحد أن يقيس اكتمالها، ومراجعة بلا تصرّف مُعلَن لكل
// اكتشاف هي قائمة مخاوف لا مراجعة.
//
// `disposition` من مجموعة مغلقة: MITIGATED (مُعالَج ومقاس)، ACCEPTED (مقبول
// بحدود مُعلَنة)، OUT_OF_SCOPE (خارج نطاق المرحلة بقرار مُسجَّل)، DEFERRED
// (مؤجَّل إلى مرحلة مُسمّاة). لا يوجد "TBD" ولا "سيُنظَر لاحقًا".

export const DISPOSITIONS = Object.freeze(["MITIGATED", "ACCEPTED", "OUT_OF_SCOPE", "DEFERRED"]);

export const STRIDE_SURFACES = Object.freeze([
  {
    id: "SURFACE-1",
    surface: "renderer",
    trust: "untrusted",
    findings: [
      {
        id: "S1-E",
        category: "Elevation of privilege",
        threat: "the renderer claims a trust tier it does not have",
        disposition: "MITIGATED",
        control: "the gateway refuses TIER_0_TRUSTED on a desktop request and stamps identity from the transport",
        evidence: "P01-HOST-GATEWAY :: a_renderer_claiming_tier_zero_is_denied",
      },
      {
        id: "S1-T",
        category: "Tampering",
        threat: "the renderer sends an operation the product never intended to expose",
        disposition: "MITIGATED",
        control: "a closed operation set plus a routing decision that is separate from schema validity",
        evidence: "P01-HOST-GATEWAY :: p01_c3_no_operation_outside_the_five_reaches_a_service",
      },
      {
        id: "S1-I",
        category: "Information disclosure",
        threat: "renderer code reads host internals through a framework plugin",
        disposition: "MITIGATED",
        control: "no filesystem, shell, dialog, http or path plugin is present in the build or granted to the window",
        evidence: "fact :: no_shell_or_filesystem_permission_granted",
      },
    ],
  },
  {
    id: "SURFACE-2",
    surface: "transport",
    trust: "boundary",
    findings: [
      {
        id: "S2-S",
        category: "Spoofing",
        threat: "a message claims to come from somewhere it did not",
        disposition: "MITIGATED",
        control: "identity is written by the transport, never read from the payload",
        evidence: "P01-HOST-GATEWAY :: the_identity_on_the_response_is_stamped_by_the_transport",
      },
      {
        id: "S2-D",
        category: "Denial of service",
        threat: "a request never answers and the shell waits forever",
        disposition: "MITIGATED",
        control: "the client wraps every call in a timeout that becomes a classified, retryable error",
        evidence: "P01-RENDERER-IPC :: a_timeout_is_classified_and_retryable",
      },
      {
        id: "S2-T",
        category: "Tampering",
        threat: "a response is accepted for a request that was never sent",
        disposition: "MITIGATED",
        control: "the client refuses a response whose request_id does not match the envelope it sent",
        evidence: "P01-RENDERER-IPC :: a_response_for_another_request_is_refused",
      },
    ],
  },
  {
    id: "SURFACE-3",
    surface: "ipc gateway",
    trust: "trusted",
    findings: [
      {
        id: "S3-T",
        category: "Tampering",
        threat: "a malformed or over-wide envelope reaches a service",
        disposition: "MITIGATED",
        control: "the envelope is validated against IPCEnvelopeV1 before any field is read, and the object is closed",
        evidence: "P01-HOST-GATEWAY :: p01_s2_a_malformed_envelope_is_rejected",
      },
      {
        id: "S3-E",
        category: "Elevation of privilege",
        threat: "a schema-valid operation is treated as an authorised one",
        disposition: "MITIGATED",
        control: "routing_status in the registry is a separate decision from schema validity",
        evidence: "P01-HOST-GATEWAY :: p01_s3_a_schema_valid_but_unrouted_operation_is_refused",
      },
      {
        id: "S3-R",
        category: "Repudiation",
        threat: "a denial leaves no trace on the host side",
        disposition: "MITIGATED",
        control: "every denial is written to the host diagnostics log with its category and internal detail",
        evidence: "P01-HOST-GATEWAY :: p01_s5_internal_detail_is_retained_on_the_host_side",
      },
    ],
  },
  {
    id: "SURFACE-4",
    surface: "native services",
    trust: "trusted",
    findings: [
      {
        id: "S4-I",
        category: "Information disclosure",
        threat: "a service returns a host internal in its result",
        disposition: "MITIGATED",
        control: "every result is validated against its closed schema before it is returned",
        evidence: "P01-HOST-GATEWAY :: p01_s4_the_bootstrap_snapshot_carries_no_host_internals",
      },
      {
        id: "S4-E",
        category: "Elevation of privilege",
        threat: "one service grows into a dispatcher for the others",
        disposition: "MITIGATED",
        control: "one owning service per operation, and an exhaustive match with no generic branch",
        evidence: "fact :: every_routed_operation_has_an_owning_service",
      },
    ],
  },
  {
    id: "SURFACE-5",
    surface: "settings facade",
    trust: "trusted",
    findings: [
      {
        id: "S5-I",
        category: "Information disclosure",
        threat: "a credential-backed setting is disclosed through a read",
        disposition: "MITIGATED",
        control: "a withheld value carries no value member at all, and the payload objects are closed",
        evidence: "P01-HOST-CORE :: read_omits_the_value_when_there_is_none_instead_of_inventing_one",
      },
      {
        id: "S5-Sp",
        category: "Spoofing",
        threat: "the shell becomes a second settings resolver and answers for the host",
        disposition: "MITIGATED",
        control: "the facade reads through a resolver port; the renderer holds no resolution rule",
        evidence: "P01-RENDERER-UI :: no_control_appears_editable_while_doing_nothing",
      },
      {
        id: "S5-D",
        category: "Denial of service",
        threat: "one request becomes a full settings dump",
        disposition: "MITIGATED",
        control: "a read names exactly one section; a cross-section read is not expressible",
        evidence: "P01-HOST-CORE :: a_read_cannot_span_sections",
      },
    ],
  },
  {
    id: "SURFACE-6",
    surface: "bootstrap",
    trust: "boundary",
    findings: [
      {
        id: "S6-I",
        category: "Information disclosure",
        threat: "the startup snapshot carries a secret or a host path",
        disposition: "MITIGATED",
        control: "the snapshot is a closed object of twelve bounded facts",
        evidence: "P01-HOST-GATEWAY :: p01_s4_the_bootstrap_snapshot_carries_no_secret_like_value",
      },
      {
        id: "S6-Sp",
        category: "Spoofing",
        threat: "the shell invents its own locale, theme and capability list when the host does not answer",
        disposition: "MITIGATED",
        control: "a failed bootstrap renders an error state; no default snapshot exists in the renderer",
        evidence: "P01-RENDERER-UI :: a_failed_bootstrap_shows_an_honest_recoverable_error",
      },
    ],
  },
  {
    id: "SURFACE-7",
    surface: "diagnostics",
    trust: "trusted",
    findings: [
      {
        id: "S7-I",
        category: "Information disclosure",
        threat: "diagnostic detail crosses the boundary inside an error",
        disposition: "MITIGATED",
        control:
          "the serialised error type has no internal_detail and no stack member, so omission is not something anyone can forget",
        evidence: "fact :: no_boundary_error_type_carries_internal_detail",
      },
      {
        id: "S7-D",
        category: "Denial of service",
        threat: "an unbounded diagnostics log grows for the life of the process",
        disposition: "MITIGATED",
        control: "the log is bounded and drops its oldest record",
        evidence: "P01-HOST-CORE :: the_log_is_bounded",
      },
      {
        id: "S7-A",
        category: "Scope",
        threat: "the desktop host itself is not confined",
        disposition: "ACCEPTED",
        control:
          "Phase-00 confines the executor child, not the shell; ADR-018 states the limit and no Phase-01 surface claims otherwise",
        evidence: "settings :: security.sandboxing/desktop-host-confined reads false",
      },
    ],
  },
]);

/** الأسطح السبعة التي تطالب بها البوابة، بالاسم. */
export const REQUIRED_SURFACES = Object.freeze([
  "renderer",
  "transport",
  "ipc gateway",
  "native services",
  "settings facade",
  "bootstrap",
  "diagnostics",
]);

/** هل المراجعة مكتملة بالمعنى الذي تقيسه البوابة؟ */
export function reviewCompleteness() {
  const covered = STRIDE_SURFACES.map((surface) => surface.surface);
  const missing = REQUIRED_SURFACES.filter((name) => !covered.includes(name));
  const findings = STRIDE_SURFACES.flatMap((surface) => surface.findings);
  const undisposed = findings.filter((finding) => !DISPOSITIONS.includes(finding.disposition));
  const unevidenced = findings.filter((finding) => typeof finding.evidence !== "string" || finding.evidence.length === 0);
  return {
    surfaces_required: REQUIRED_SURFACES.length,
    surfaces_covered: covered.length,
    missing_surfaces: missing,
    findings: findings.length,
    undisposed: undisposed.map((finding) => finding.id),
    unevidenced: unevidenced.map((finding) => finding.id),
    complete: missing.length === 0 && undisposed.length === 0 && unevidenced.length === 0,
  };
}
