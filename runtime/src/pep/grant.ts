// منحة التنفيذ: الشيء الوحيد الذي يقبله منفّذ الأثر.
//
// المنحة ليست "طلبًا" بل حصيلة فرض: مسار حقيقي مُثبَت، جذور مسموحة حقيقية،
// سقف بايتات، ومهلة. المنفّذ لا يرى الاستدعاء ولا القرار ولا السياسة،
// فلا يستطيع إعادة تفسير أي منها لصالحه.

export type GrantOperation = "READ_FILE" | "WRITE_FILE";

export type WriteMode = "CREATE" | "MODIFY";

/**
 * هوية كائن الهدف كما رصدها المُثبِت (نقطة الفرض أو المحوّل) على المسار المحلول.
 *
 * وجودها في المنحة هو ما يجعل «الكائن الذي أُقرّ» شيئًا يمكن للمنفّذ أن يتحقق
 * منه على مقبضه هو، بدل أن يعيد حلّ اسم المسار — انظر SAME_OBJECT_VERIFY_AND_USE.
 */
export interface TargetIdentity {
  /** معرّف وحدة التخزين. قد يبلّغه النظام صفرًا، فلا يُقارَن حينها ولا يُدّعى تطابقه. */
  readonly volume: string;
  /** معرّف الكائن داخل وحدة التخزين. صفرٌ هنا يعني «لا هوية»، وهو فشل مغلق. */
  readonly file: string;
}

export interface GrantedTarget {
  /** المسار المنطقي بصيغة POLARIS القانونية. للعرض والتدقيق. */
  readonly logical: string;
  /** المسار الحقيقي على المضيف بعد حلّ كل رابط. هو ما يُنفَّذ عليه. */
  readonly host: string;
  readonly mode: "READ" | WriteMode;
  /**
   * هوية الكائن عند القرار. مطلوبة للقراءة: بدونها لا يستطيع المنفّذ أن يثبت
   * أن ما فتحه هو ما أُقرّ، فيفشل مغلقًا بدل أن يقرأ على الثقة.
   * غائبة في إنشاء ملف جديد، لأنه لا كائن بعد.
   */
  readonly identity?: TargetIdentity;
}

export interface ExecutionGrant {
  readonly grant_id: string;
  readonly correlation_id: string;
  readonly invocation_id: string;
  readonly decision_id: string;
  readonly operation: GrantOperation;
  readonly target: GrantedTarget;
  /**
   * الجذور الحقيقية التي يجوز أن يقع الهدف تحتها.
   * تُنقل إلى المنفّذ ليعيد إثبات الاحتواء بنفسه: دفاع في العمق،
   * فلا يعتمد الأمان على صحة طرف واحد فقط.
   */
  readonly allowed_host_roots: readonly string[];
  readonly max_bytes: number;
  readonly deadline_ms: number;
  readonly encoding: "utf-8";
  /** محتوى الكتابة بترميز base64. غائب في القراءة. */
  readonly payload_base64?: string;
  /** الكتابة فوق ملف قائم مسموحة فقط حين تعلنها المنحة صراحة. */
  readonly allow_overwrite: boolean;
  /**
   * البيئة كما بناها المُطلِق بالضبط. تسافر مع المنحة ليقارن المنفّذ نفسه بها
   * بالقيمة لا بالاسم: اسم صحيح بقيمة أخرى وراثةٌ لا بناء.
   */
  readonly environment_contract?: Readonly<Record<string, string>>;
}

export type ExecutorErrorCode =
  | "TARGET_OUTSIDE_GRANT"
  /** وصلة أو رابط بين الجذر الممنوح والهدف: رُفض قبل أي فتح. */
  | "TARGET_LINK_IN_PATH"
  /** الكائن المفتوح ليس الكائن الذي تحمل المنحة هويته. */
  | "TARGET_MOVED"
  /** المنحة لا تحمل هوية هدف، فلا سبيل لإثبات أن المفتوح هو المُقرّ. */
  | "MISSING_TARGET_IDENTITY"
  /** النظام لم يعطِ هوية صالحة للكائن المفتوح. لا يُقرأ على غير إثبات. */
  | "TARGET_IDENTITY_UNAVAILABLE"
  | "NOT_A_FILE"
  | "TOO_LARGE"
  | "OVERWRITE_FORBIDDEN"
  | "MISSING_PAYLOAD"
  | "IO_ERROR"
  /** رُفض الإطلاق لأن النظام موقوف. W5: القبول مُغلق، فلا عملية تُطلق. */
  | "REFUSED_WHILE_STOPPED"
  | "MALFORMED_GRANT";

/** واصف مفتوح يشير إلى مورد في نظام الملفات داخل العملية المنفِّذة. */
export interface DescriptorFinding {
  readonly fd: number;
  /** الهدف الحقيقي للواصف كما يراه النظام. */
  readonly target: string;
  /** نوع المورد خلف الواصف. الملف والمجلد وحدهما يمكن أن يسرّبا محتوى قرص. */
  readonly kind: "FILE" | "DIRECTORY" | "CHARACTER_DEVICE" | "PIPE" | "SOCKET" | "OTHER";
  /** هل يقع الهدف داخل الجذور الممنوحة. false على ملف أو مجلد يعني تجاوزًا للحصر. */
  readonly inside_grant: boolean;
}

/**
 * فحص المقابض الموروثة. أساس انحدار X03 من W1.
 *
 * السؤال الذي يجيب عنه ليس "كم واصفًا مفتوحًا" — فبيئة التشغيل نفسها تفتح
 * واصفات داخلية (epoll، eventfd، أنابيب) — بل السؤال الصحيح:
 * هل يستطيع الابن الوصول إلى مورد في نظام الملفات خارج منحته عبر مقبض موروث.
 */
export interface HandleProbe {
  readonly supported: boolean;
  readonly platform: string;
  /** الطريقة المستعملة فعلًا. NONE يعني أنه لم يُقَس شيء، ولا يُدّعى شيء. */
  readonly method: "PROC_FD_LINKS" | "NONE";
/**
   * واصفات تشير إلى ملف أو مجلد حقيقي. هذه وحدها ما يمكن أن يتجاوز الحصر،
   * وعليها وحدها يقع الحكم.
   */
  readonly filesystem_descriptors: readonly DescriptorFinding[];
  /**
   * كل واصف مفتوح آخر: أنابيب، مقابس، أجهزة محرفية، كائنات نواة.
   * يُسرد كاملًا ولا يُخفى، حتى يكون الدليل كاملًا لا منتقى.
   */
  readonly other_descriptors: readonly DescriptorFinding[];
  readonly open_descriptor_count: number;
}

/**
 * ما لاحظته العملية المنفِّذة عن بيئتها. دليل على ادعاءي البيئة الصريحة
 * وغياب أسطح الشبكة، بدل الاكتفاء بوصفهما في وثيقة.
 */
/**
 * تصنيف متغيّر بيئة داخل العملية المنفِّذة.
 * - EXPLICITLY_CONSTRUCTED: اسم وقيمة يطابقان ما بناه POLARIS.
 * - AMBIENTLY_OVERRIDDEN:   الاسم معلن لكن القيمة ليست القيمة المبنية.
 * - AMBIENTLY_INHERITED:    اسم لم يعلنه POLARIS إطلاقًا.
 */
export type EnvironmentClassification =
  | "EXPLICITLY_CONSTRUCTED"
  | "AMBIENTLY_OVERRIDDEN"
  | "AMBIENTLY_INHERITED";

export interface EnvironmentFinding {
  readonly name: string;
  readonly classification: EnvironmentClassification;
}

export interface HostDiagnostics {
  /** مفاتيح البيئة التي وصلت فعلًا إلى العملية المنفِّذة. */
  readonly environment_keys: readonly string[];
  /** التصنيف بالقيمة. غياب عقد البيئة يجعل كل شيء غير مصنَّف بصدق. */
  readonly environment_findings: readonly EnvironmentFinding[];
  /** true فقط إذا كانت البيئة مطابقة تمامًا لما بناه POLARIS. */
  readonly environment_exactly_as_constructed: boolean;
  /** هل وصل عقد بيئة أصلًا. بدونه لا يُدّعى تصنيف. */
  readonly environment_contract_present: boolean;
  /** أسطح شبكة عامة بقيت متاحة داخل العملية. الفراغ هو المتوقع. */
  readonly network_globals_present: readonly string[];
  readonly working_directory: string;
}

/**
 * ما فعله المنفّذ خطوةً خطوة عند ربط الهدف بكائنه. دليل تشخيصي كامل، لا رسالة
 * واحدة مطويّة: رمز النظام الحقيقي عند كل خطوة، وأي خطوة لم تُبلَغ أصلًا.
 * لا يحمل محتوى الملف؛ المسارات هنا مسارات عيّنة W4 وتُسجَّل عمدًا.
 */
export interface ResolutionDiagnostics {
  readonly precheck_target: string;
  readonly precheck_allowed_root: string;
  /** الابتدائية المستعملة لربط الاسم بالكائن. لا إعادة فتح باسم المسار بعد التحقق. */
  readonly path_resolution_primitive: "SINGLE_OPEN_SAME_OBJECT";
  readonly chain_scan_started: boolean;
  readonly chain_scan_entries: number;
  readonly chain_scan_clean: boolean;
  readonly chain_scan_reason: string;
  readonly chain_scan_at: string;
  readonly chain_scan_error_code: string;
  readonly open_started: boolean;
  readonly open_success: boolean;
  readonly open_error_code: string;
  readonly open_errno: number;
  readonly open_syscall: string;
  readonly fstat_success: boolean;
  readonly fstat_error_code: string;
  readonly identity_expected: TargetIdentity | undefined;
  readonly identity_observed: TargetIdentity | undefined;
  readonly identity_compare_result: "MATCH" | "MISMATCH" | "NOT_COMPARED" | "UNAVAILABLE";
  readonly identity_volume_compared: boolean;
  readonly containment_compare_result: "INSIDE" | "OUTSIDE" | "NOT_COMPARED";
  /** ثابت معماري مُصرَّح به في الدليل: لا فتح ثانٍ باسم المسار بعد التحقق. */
  readonly reopen_after_verification: false;
  readonly read_success: boolean;
  readonly read_bytes: number;
  readonly read_error_code: string;
  readonly close_success: boolean;
}

export interface ExecutionOutcome {
  readonly status: "SUCCESS" | "FAILED";
  readonly grant_id: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly content_base64?: string;
  readonly content_sha256?: string;
  readonly wrote?: WriteMode;
  readonly handle_probe: HandleProbe;
  readonly host_diagnostics: HostDiagnostics;
  readonly error?: { readonly code: ExecutorErrorCode; readonly detail: string };
  /** تشخيص ربط الهدف بكائنه. حاضر في كل قراءة، نجحت أو فشلت. */
  readonly resolution_diagnostics?: ResolutionDiagnostics;
}
