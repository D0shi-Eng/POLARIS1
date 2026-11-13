// تعريف مجموعات P01-W2 — مصدر واحد يقرأه المشغّل ومُشتقّ الدليل.
//
// المجموعة وحدة قياس تقابل ادعاءً واحدًا من ادعاءات W2. الملفات كلها في حزمة
// العقود لا في طبقة التشغيل: W2 لا يبني مضيفًا، فما يُقاس هنا هو سطح العقد.
//
// P01-R0 ليست مجموعة من مجموعات W2 بل انحدار Phase-00 نفسه، مُشغَّلًا بأدواته
// كما هي. وجودها هنا لأن تغيير المظروف يمسّ عقدًا مجمَّدًا، فالسؤال «هل بقي
// Phase-00 نظيفًا؟» جزء من قياس W2 لا ملحق به.

export const P01_W2_TEST_GROUP_TOOL = "polaris.p01.w2.test-group";
export const P01_W2_TEST_GROUPS_TOOL = "polaris.p01.w2.test-groups";
export const P01_W2_IPC_TOOL = "polaris.p01.w2.ipc";
export const P01_W2_NATIVE_MARKER = "POLARIS_P01_W2_NATIVE_RUN";

export const P01_W2_GROUPS = [
  {
    id: "P01-CV",
    name: "contract versioning",
    claim:
      "IPCEnvelopeV1 is supported at 1.1, 1.0 documents remain valid, an unknown or arbitrary operation is rejected, a higher minor and any other major fail closed, a malformed version is a distinct error class, and a 1.1-only operation cannot travel in a document that declares 1.0",
    files: ["p01-cv.test.js"],
    evidence: "phase-01-contract-versioning",
    claim_ids: ["P01-C1"],
  },
  {
    id: "P01-IPC",
    name: "desktop operation envelope",
    claim:
      "the five desktop operations travel in the one envelope with a payload bound per operation, a read-only operation carries no idempotency key, a desktop request cannot assert the trusted tier, and a malformed payload is refused before any routing could occur",
    files: ["p01-ipc.test.js"],
    evidence: "phase-01-ipc-envelope",
    claim_ids: ["P01-C1", "P01-C2"],
  },
  {
    id: "P01-BS",
    name: "bootstrap snapshot",
    claim:
      "the snapshot carries exactly the twelve declared shell facts, every one of them is bounded, host internals are unrepresentable rather than merely absent, and the Phase-01 reference snapshot does not claim an attached runtime",
    files: ["p01-bs.test.js"],
    evidence: "phase-01-bootstrap-contract",
    claim_ids: ["P01-C2"],
  },
  {
    id: "P01-AV",
    name: "availability model",
    claim:
      "one availability model with five states and five machine reasons, AVAILABLE without a reason, every other state with one, and no free text able to become the reason",
    files: ["p01-av.test.js"],
    evidence: "phase-01-availability",
    claim_ids: ["P01-C2"],
  },
  {
    id: "P01-ST",
    name: "settings descriptors",
    claim:
      "settings can be described structurally with a mode per setting and a reason whenever the mode is not ACTIVE, describing carries no value, and a value the host withholds is never accompanied by a value",
    files: ["p01-st.test.js"],
    evidence: "phase-01-settings-contract",
    claim_ids: ["P01-C2"],
  },
  {
    id: "P01-ER",
    name: "error mapping",
    claim:
      "every frozen error code maps to one of nine display categories, no category invents a code, no category lets internal detail cross the boundary, and the rendered view carries neither internal detail nor a stack trace",
    files: ["p01-er.test.js"],
    evidence: "phase-01-error-mapping",
    claim_ids: ["P01-C2"],
  },
  {
    id: "P01-SH",
    name: "secret hygiene",
    claim:
      "the existing secret rule, reused and not restated, rejects credential-shaped values anywhere in a desktop payload, credential-named keys are unrepresentable in the closed shapes, and no rejection echoes the credential it found",
    files: ["p01-sh.test.js"],
    evidence: "phase-01-secret-hygiene",
    claim_ids: ["P01-C2"],
  },
  {
    id: "P01-RG",
    name: "IPC registry consistency",
    claim:
      "every operation has a request schema, a response schema, one owning service, an effect, a trust boundary, a caller class, declared error categories and a routing status; every schema reference resolves; and schema validity is not routing authorisation",
    files: ["p01-rg.test.js"],
    evidence: "phase-01-ipc-registry",
    claim_ids: ["P01-C2", "P01-C3"],
  },
  {
    id: "P01-X",
    name: "architecture invariants",
    claim:
      "the operation set stays closed, no dispatcher and no shell or eval operation exists, no desktop operation grants filesystem authority, no desktop contract declares a secret-bearing field, generated types stay derived, 1.0 compatibility holds, unsupported versions fail closed and no second envelope contract exists",
    files: ["p01-x.test.js"],
    evidence: "phase-01-architecture-invariants",
    claim_ids: ["P01-C3"],
  },
  {
    id: "P01-R0",
    name: "Phase-00 contract regression",
    claim:
      "the frozen Phase-00 contract suite still passes unchanged after the additive 1.1 change to IPCEnvelopeV1",
    files: [
      "contracts.test.js",
      "canonical.test.js",
      "invariants.test.js",
      "properties.test.js",
      "package-surface.test.js",
    ],
    evidence: "phase-01-w2-phase-00-regression",
    claim_ids: [],
  },
];
