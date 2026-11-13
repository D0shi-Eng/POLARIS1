// الإعلانات المشتركة لمشغّل Phase-01: المجموعات، والعلامة، وأسماء الأدلة.
//
// ملف واحد يعلن ما تقيسه المرحلة، فلا يعيد كل مستهلك تعريف القائمة. هذا ما منع
// انجراف مجموعات W5 وW6 عن مشتقّاتها، وهو السبب نفسه هنا.

/** متغيّر البيئة الذي يجعل تشغيلًا ما قانونيًا. لا يضعه إلا المشغّل الأصلي. */
export const P01_NATIVE_MARKER = "POLARIS_P01_NATIVE_RUN";

export const P01_TOOLS = Object.freeze({
  testGroups: "polaris.p01.test-groups",
  derive: "polaris.p01.derive",
  native: "polaris.p01.native",
  finalGate: "polaris.p01.final-gate",
  evidenceBytes: "polaris.p01.evidence-bytes",
  asciiDiscipline: "polaris.p01.ascii-discipline",
});

/**
 * مجموعات الاختبار.
 *
 * `lane` يقول أين يعمل: `any` يعمل على أي مضيف، و`windows` يحتاج Windows أصليًا.
 * و`runner` هو الأمر الحقيقي، مكتوبًا هنا مرة واحدة حتى يكون قابلًا لإعادة
 * التشغيل يدويًا من الوثيقة بلا قراءة سكربت.
 */
export const P01_GROUPS = Object.freeze([
  {
    id: "P01-HOST-CORE",
    title: "native host core: contracts, services, settings, model",
    lane: "any",
    kind: "cargo",
    cwd: "desktop/host",
    command: ["cargo", "test", "-p", "polaris-host-core", "--lib"],
  },
  {
    id: "P01-HOST-GATEWAY",
    title: "native host boundary: routing, denial, identity, redaction",
    lane: "any",
    kind: "cargo",
    cwd: "desktop/host",
    command: ["cargo", "test", "-p", "polaris-host-core", "--test", "gateway"],
  },
  {
    id: "P01-HOST-BINDING",
    title: "native host binding: identifiers used by the transport",
    lane: "any",
    kind: "cargo",
    cwd: "desktop/host",
    command: ["cargo", "test", "-p", "polaris-host", "--lib"],
  },
  {
    id: "P01-RENDERER-IPC",
    title: "renderer IPC client: validation both ways, error translation, timeout",
    lane: "any",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/ipc.test.js"],
  },
  {
    id: "P01-RENDERER-ROUTES",
    title: "route registry, availability model and settings grouping",
    lane: "any",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/routes.test.js"],
  },
  {
    id: "P01-RENDERER-L10N",
    title: "localization: key parity, fallback, plurals, direction, formatting",
    lane: "any",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/localization.test.js"],
  },
  {
    id: "P01-RENDERER-STRINGS",
    title: "source scan: no hard-coded user-facing string in any component",
    lane: "any",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/strings.test.js"],
  },
  {
    id: "P01-RENDERER-UI",
    title: "screens: hydration, navigation, honest states, settings, a11y, theme, direction",
    lane: "any",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/app.test.js"],
  },
  {
    id: "P01-CONTRACTS",
    title: "the frozen contract suite, re-run against this tree",
    lane: "any",
    // الأمر نفسه الذي يشغّله `npm run test` داخل contracts، بلا npm وسيطًا:
    // npm.cmd على ويندوز لا يُشغَّل بلا صدفة، والصدفة مع وسائط هي DEP0190.
    // النمط يُمرَّر لـNode كما هو، وNode يوسّعه بنفسه.
    kind: "node",
    cwd: "contracts",
    command: ["node", "--test", "dist/tests/*.test.js"],
  },
  {
    id: "P01-ASSETS",
    title: "instrument guards: the Windows resource icon, the test-summary reader, the packaged-frontend build mode, the product CSP, and the D3 derivation source",
    lane: "any",
    kind: "node",
    cwd: ".",
    command: ["node", "--test", "tools/p01-conformance/tests/app-icon.test.mjs", "tools/p01-conformance/tests/test-groups.test.mjs", "tools/p01-conformance/tests/build-mode.test.mjs", "tools/p01-conformance/tests/csp-guard.test.mjs", "tools/p01-conformance/tests/dogfood-d3.test.mjs"],
  },
  {
    id: "P01-NATIVE-E2E",
    title: "native Windows end to end: launch, window, scaling, exit",
    lane: "windows",
    kind: "probe",
    cwd: ".",
    command: ["tools/p01-conformance/run.ps1", "(native probe stage)"],
  },
  {
    id: "P01-PHASE-00",
    title: "the frozen Phase-00 canonical gate, re-run after Phase-01 changes",
    lane: "windows",
    kind: "probe",
    cwd: ".",
    command: ["tools/w6-conformance/run.ps1", "(frozen)"],
  },
]);

export function groupById(id) {
  return P01_GROUPS.find((group) => group.id === id);
}

/**
 * أسماء وثائق الدليل القانونية لهذه المرحلة، بالترتيب الذي تُكتب به.
 *
 * وثيقة البوابة النهائية ليست هنا عمدًا: بوابة البايتات تسبقها، وإدراجها كان
 * سيجعل الفحص يطلب ملفًا لم يُكتب بعد. تُفحص في تمريرة ثانية بعد كتابتها، وهذا
 * ما يفعله `--include-final-gate`.
 */
export const P01_EVIDENCE = Object.freeze([
  "phase-01-test-groups",
  "phase-01-run",
  "phase-01-ipc",
  "phase-01-localization",
  "phase-01-accessibility",
  "phase-01-security",
  "phase-01-desktop-e2e",
  "phase-01-performance",
  "phase-01-regression",
]);

/** اسم وثيقة البوابة النهائية، مفصولًا لأن ترتيب كتابتها يأتي بعد الفحص الأول. */
export const P01_FINAL_GATE = "phase-01-final-gate";

/** هل هذا تشغيل قانوني؟ العلامة وحدها تقرّر، لا نجاح القياس. */
export function isCanonicalRun(environment = process.env) {
  return environment[P01_NATIVE_MARKER] === "1";
}

/** لاحقة اسم الوثيقة. تشغيل غير قانوني يكتب باسم مختلف ويقول ذلك في متنه. */
export function evidenceSuffix(environment = process.env) {
  return isCanonicalRun(environment) ? "" : ".adhoc";
}

/** طابع زمني بصيغة عقد الأدلة. */
export function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** وسيط سطر أوامر بقيمة افتراضية. */
export function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}
