// المجموعة المحجوزة (2026-10-24): كُتبت قبل أي تعديل في ترتيب الذاكرة، وبصمتها SHA-256 مثبّتة في وثيقة النقل. لا يُضبط عليها
// ثابت ولا حدّ؛ تُقاس عليها النتيجة قبل النقل وبعده فقط. كاتبها هو كاتب الشيفرة، فهي محجوزة لا مستقلّة.
//
// تختبر ما لا تختبره مجموعة التطوير: صيغ صرفية مختلفة (جمع ومفرد، وحروف جرّ وعطف ملتصقة بالعربية، وأزمنة إنجليزية)، وكلمات
// شائعة تتكرّر في مدخلات كثيرة، وأسئلة من مشروع ثانٍ تطلب ذاكرة المشروع الأول.

use polaris_host_core::p05::memory::model::{MemoryScope as S, MemoryType as T};

use super::{entry, Case, Dataset, Kind::*};

pub const NOOR: &str = "p-noor";
pub const SAHM: &str = "p-sahm";

pub fn dataset() -> Dataset {
    let corpus = vec![
        entry("hu1", T::Preference, S::User, None, None, "tone", "Keep answers brief and skip greetings", 1),
        entry("hu2", T::Semantic, S::User, None, None, "daughter school", "ابنتي ليان تدرس في مدرسة الأندلس الابتدائية", 2),
        entry("hu3", T::Semantic, S::User, None, None, "blood type", "My blood type is O negative", 3),
        entry("hu4", T::Semantic, S::User, None, None, "phone plan", "I pay 150 riyals monthly for the mobile plan", 4),
        entry("hu5", T::Semantic, S::User, None, None, "favourite team", "أشجع نادي الاتحاد", 5),
        entry("hu6", T::Semantic, S::User, None, None, "laptop", "My work laptop is a ThinkPad X1 Carbon", 6),
        entry("hu7", T::Semantic, S::User, None, None, "running", "أركض خمسة كيلومترات كل صباح جمعة", 7),
        entry("n1", T::Semantic, S::Project, None, Some(NOOR), "noor payments", "Noor processes payments through the Moyasar gateway", 10),
        entry("n2", T::Semantic, S::Project, None, Some(NOOR), "noor reminders", "The Noor app sends appointment reminders by SMS 24 hours before", 11),
        entry("n3", T::Semantic, S::Project, None, Some(NOOR), "noor doctors", "عدد الأطباء المسجلين في تطبيق نور 42 طبيبًا", 12),
        entry("n4", T::Semantic, S::Project, None, Some(NOOR), "noor deadline", "تسليم النسخة الأولى من نور نهاية شهر نوفمبر", 13),
        entry("n5", T::Semantic, S::Project, None, Some(NOOR), "noor deadline", "The first Noor release is due on 10 December", 14),
        entry("n6", T::Semantic, S::Project, None, Some(NOOR), "noor storage", "Patient records are stored in an encrypted SQLite file on each device", 15),
        entry("n7", T::Semantic, S::Project, None, Some(NOOR), "noor bugs", "Testers found that booking fails when the clinic has no working hours set", 16),
        entry("n8", T::Semantic, S::Project, None, Some(NOOR), "noor languages", "The interface supports Arabic and English", 17),
        entry("n9", T::Semantic, S::Project, None, Some(NOOR), "noor meeting", "Weekly sync with the clinic owners happens on Tuesdays", 18),
        entry("s1", T::Semantic, S::Project, None, Some(SAHM), "sahm fleet", "Sahm operates 30 delivery trucks in Dammam", 20),
        entry("s2", T::Semantic, S::Project, None, Some(SAHM), "sahm payroll", "Sahm drivers are paid every two weeks by bank transfer", 21),
        entry("s3", T::Semantic, S::Project, None, Some(SAHM), "sahm database", "Sahm tracking data lives in MongoDB Atlas", 22),
        entry("s4", T::Semantic, S::Project, None, Some(SAHM), "sahm client", "أكبر عميل لشركة سهم هو سلسلة أسواق التميمي", 23),
        entry("s5", T::Semantic, S::Project, None, Some(SAHM), "sahm deadline", "Route optimisation must ship before the end of Q1", 24),
        entry("mh1", T::Episodic, S::Mission, Some("mh1"), Some(NOOR), "decision", "قررنا تأجيل ميزة الدفع بالتقسيط إلى ما بعد الإطلاق", 30),
        entry("mh0", T::Working, S::Mission, Some("mh0"), Some(NOOR), "draft", "The privacy policy draft still needs the data retention section", 31),
        entry("mx", T::Episodic, S::Mission, Some("mx"), Some(NOOR), "refund", "Refund 8812 was approved for the Al-Shifa clinic", 32),
        entry("sy1", T::Semantic, S::System, None, None, "backups", "Backups are created automatically every night at 2 AM", 40),
        entry("sy2", T::Semantic, S::System, None, None, "logs", "Diagnostic logs are kept for 14 days", 41),
    ];
    const TH: &[&str] = &["mh0"];
    const NONE: &[&str] = &[];
    let c = |label, kind, project, mission, thread, text, relevant, conflict| Case { label, kind, project, mission, thread, text, relevant, conflict };
    let cases = vec![
        c("payments_exact", Lexical, NOOR, "mh1", TH, "how are payments processed in Noor", &["n1"][..], false),
        c("payment_singular", Lexical, NOOR, "mh1", TH, "which gateway handles the payment", &["n1"][..], false),
        c("reminder_plural", Lexical, NOOR, "mh1", TH, "reminder messages for appointments", &["n2"][..], false),
        c("doctors_ar_morph", Lexical, NOOR, "mh1", TH, "كم طبيب مسجل في نور", &["n3"][..], false),
        c("deadline_en", Lexical, NOOR, "mh1", TH, "when is the Noor release deadline", &["n4", "n5"][..], true),
        c("deadline_ar", Lexical, NOOR, "mh1", TH, "موعد تسليم نور", &["n4", "n5"][..], true),
        c("records_exact", Lexical, NOOR, "mh1", TH, "where are patient records kept", &["n6"][..], false),
        c("booking_failures", Lexical, NOOR, "mh1", TH, "booking failures reported by testers", &["n7"][..], false),
        c("languages_exact", Lexical, NOOR, "mh1", TH, "what languages does the interface support", &["n8"][..], false),
        c("meeting_ar_to_en", Paraphrase, NOOR, "mh1", TH, "متى الاجتماع الأسبوعي مع ملاك العيادات", &["n9"][..], false),
        c("installments_en_to_ar", Paraphrase, NOOR, "mh1", TH, "what did we decide about installment payments", &["mh1"][..], false),
        c("installments_ar_morph", Lexical, NOOR, "mh1", TH, "ما الذي قررناه بشأن التقسيط", &["mh1"][..], false),
        c("thread_draft", Lexical, NOOR, "mh1", TH, "privacy policy draft", &["mh0"][..], false),
        c("other_thread_refund", Leak, NOOR, "mh1", TH, "Refund 8812", &[][..], false),
        c("other_project_trucks", Leak, NOOR, "mh1", TH, "how many trucks does Sahm have", &[][..], false),
        c("blood_exact", Lexical, NOOR, "mh1", TH, "what is my blood type", &["hu3"][..], false),
        c("school_en_to_ar", Paraphrase, NOOR, "mh1", TH, "which school does my daughter attend", &["hu2"][..], false),
        c("school_ar", Lexical, NOOR, "mh1", TH, "مدرسة ابنتي", &["hu2"][..], false),
        c("phone_bill", Lexical, NOOR, "mh1", TH, "how much is my phone bill", &["hu4"][..], false),
        c("work_computer", Lexical, NOOR, "mh1", TH, "what computer do I use for work", &["hu6"][..], false),
        c("club_en_to_ar", Paraphrase, NOOR, "mh1", TH, "which football club do I support", &["hu5"][..], false),
        c("running_en_to_ar", Paraphrase, NOOR, "mh1", TH, "how often do I go running", &["hu7"][..], false),
        c("backups_exact", Lexical, NOOR, "mh1", TH, "when do backups run", &["sy1"][..], false),
        c("logs_retained", Lexical, NOOR, "mh1", TH, "how long are logs retained", &["sy2"][..], false),
        c("bilingual_paraphrase", Paraphrase, NOOR, "mh1", TH, "is the app bilingual", &["n8"][..], false),
        c("opening_hours", Lexical, NOOR, "mh1", TH, "does booking work without opening hours", &["n7"][..], false),
        c("sms_appointments", Lexical, NOOR, "mh1", TH, "SMS notifications before appointments", &["n2"][..], false),
        c("tracking_db", Lexical, SAHM, "ms", NONE, "what database stores tracking data", &["s3"][..], false),
        c("client_ar_prefix", Lexical, SAHM, "ms", NONE, "من أكبر عميل لسهم", &["s4"][..], false),
        c("noor_from_sahm", Leak, SAHM, "ms", NONE, "how do Noor payments work", &[][..], false),
        c("drivers_paid", Lexical, SAHM, "ms", NONE, "how are drivers paid", &["s2"][..], false),
        c("route_optimization", Lexical, SAHM, "ms", NONE, "route optimization deadline", &["s5"][..], false),
        c("doctors_from_sahm", Leak, SAHM, "ms", NONE, "تطبيق نور كم طبيب", &[][..], false),
        c("trucks_ar_to_en", Paraphrase, SAHM, "ms", NONE, "كم شاحنة لدينا في الأسطول", &["s1"][..], false),
    ];
    Dataset { name: "heldout", corpus, cases }
}
