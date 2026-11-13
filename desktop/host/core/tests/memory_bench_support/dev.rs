// مجموعة التطوير: مجموعة PHASE-08 نفسها (22 سؤالًا، 23 مدخلًا)، منقولة كما هي من `cp08_memory_retrieval.rs`. عليها اختير حدّ
// التشابه 0.6، فلا تصلح دليلًا مستقلًّا على تحسين.

use polaris_host_core::p05::memory::model::{MemoryScope as S, MemoryType as T};

use super::{entry, Case, Dataset, Kind::*};

pub const ALPHA: &str = "p-alpha";
pub const BETA: &str = "p-beta";

pub fn dataset() -> Dataset {
    let corpus = vec![
        entry("u1", T::Preference, S::User, None, None, "language", "أفضّل أن تكون الردود باللغة العربية الفصحى", 1),
        entry("u2", T::Semantic, S::User, None, None, "home city", "أعيش في مدينة جدة", 2),
        entry("u3", T::Semantic, S::User, None, None, "allergy", "I am allergic to peanuts", 3),
        entry("u4", T::Preference, S::User, None, None, "report format", "I like reports as short bullet lists", 4),
        entry("u5", T::Semantic, S::User, None, None, "car", "I drive a 2019 Toyota Camry", 5),
        entry("u6", T::Semantic, S::User, None, None, "work hours", "دوامي يبدأ الساعة السابعة صباحًا", 6),
        entry("u7", T::Semantic, S::User, None, None, "coffee", "أحب القهوة العربية بالهيل", 7),
        entry("u8", T::Semantic, S::User, None, None, "gym", "I go to the gym on Mondays and Thursdays", 8),
        entry("a1", T::Semantic, S::Project, None, Some(ALPHA), "falcon launch date", "Falcon app launches on 15 December", 10),
        entry("a2", T::Semantic, S::Project, None, Some(ALPHA), "falcon backend", "The Falcon backend runs on PostgreSQL 16", 11),
        entry("a3", T::Semantic, S::Project, None, Some(ALPHA), "falcon budget", "ميزانية مشروع فالكون 120 ألف ريال", 12),
        entry("a4", T::Semantic, S::Project, None, Some(ALPHA), "falcon designer", "Sara is the lead designer of Falcon", 13),
        entry("a5", T::Semantic, S::Project, None, Some(ALPHA), "falcon hosting", "The Falcon servers are hosted in the Riyadh region", 14),
        entry("a6", T::Semantic, S::Project, None, Some(ALPHA), "falcon testing", "Beta testers report crashes on Android 12", 15),
        entry("a7", T::Semantic, S::Project, None, Some(ALPHA), "falcon launch date", "Falcon app launches on 1 January", 16),
        entry("b1", T::Semantic, S::Project, None, Some(BETA), "oasis budget", "ميزانية مشروع الواحة 80 ألف ريال", 20),
        entry("b2", T::Semantic, S::Project, None, Some(BETA), "oasis backend", "The Oasis site uses MySQL 8", 21),
        entry("b3", T::Semantic, S::Project, None, Some(BETA), "oasis client", "The Oasis client is the Ministry of Tourism", 22),
        entry("b4", T::Semantic, S::Project, None, Some(BETA), "oasis deadline", "Oasis must go live before Ramadan", 23),
        entry("t0", T::Episodic, S::Mission, Some("m0"), Some(ALPHA), "meeting notes", "In the last meeting we agreed to drop the dark mode feature", 30),
        entry("t1", T::Working, S::Mission, Some("m1"), Some(ALPHA), "draft status", "The release notes draft is half written", 31),
        entry("x1", T::Episodic, S::Mission, Some("m-other"), Some(ALPHA), "invoice", "Invoice 4471 was paid on Sunday", 32),
        entry("s1", T::Semantic, S::System, None, None, "export folder", "Exports are written to the exports folder in the data directory", 40),
    ];
    const M1: &[&str] = &["m0"];
    const NONE: &[&str] = &[];
    let c = |label, kind, project, mission, thread, text, relevant, conflict| Case { label, kind, project, mission, thread, text, relevant, conflict };
    let cases = vec![
        c("db_lexical", Lexical, ALPHA, "m1", M1, "what database does the Falcon backend use", &["a2"][..], false),
        c("db_paraphrase", Paraphrase, ALPHA, "m1", M1, "which SQL engine stores our data", &["a2"][..], false),
        c("launch_ar_to_en", Paraphrase, ALPHA, "m1", M1, "متى موعد إطلاق تطبيق فالكون", &["a1", "a7"][..], true),
        c("launch_lexical", Lexical, ALPHA, "m1", M1, "Falcon launch date", &["a1", "a7"][..], true),
        c("budget_ar", Lexical, ALPHA, "m1", M1, "ما ميزانية مشروع فالكون", &["a3"][..], false),
        c("budget_en_to_ar", Paraphrase, ALPHA, "m1", M1, "how much money do we have for this project", &["a3"][..], false),
        c("designer_lexical", Lexical, ALPHA, "m1", M1, "who is the lead designer", &["a4"][..], false),
        c("designer_paraphrase", Paraphrase, ALPHA, "m1", M1, "who draws the screens and interface", &["a4"][..], false),
        c("hosting_paraphrase", Paraphrase, ALPHA, "m1", M1, "where are the machines located geographically", &["a5"][..], false),
        c("thread_meeting", Lexical, ALPHA, "m1", M1, "what did we agree in the last meeting", &["t0"][..], false),
        c("other_conversation", Leak, ALPHA, "m1", M1, "Invoice 4471", &[][..], false),
        c("other_project_client", Leak, ALPHA, "m1", M1, "who is the Oasis client", &[][..], false),
        c("allergy_lexical", Lexical, ALPHA, "m1", M1, "what food am I allergic to", &["u3"][..], false),
        c("allergy_paraphrase", Paraphrase, ALPHA, "m1", M1, "can I eat a satay sauce snack", &["u3"][..], false),
        c("city_ar", Lexical, ALPHA, "m1", M1, "في أي مدينة أعيش", &["u2"][..], false),
        c("work_en_to_ar", Paraphrase, ALPHA, "m1", M1, "what time do I start work in the morning", &["u6"][..], false),
        c("car_paraphrase", Paraphrase, ALPHA, "m1", M1, "what vehicle do I own", &["u5"][..], false),
        c("crash_lexical", Lexical, ALPHA, "m1", M1, "Android crashes reported by beta testers", &["a6"][..], false),
        c("crash_paraphrase", Paraphrase, ALPHA, "m1", M1, "is the mobile build stable", &["a6"][..], false),
        c("export_system", Lexical, ALPHA, "m1", M1, "where are exports saved", &["s1"][..], false),
        c("beta_budget_ar", Lexical, BETA, "mb", NONE, "ما ميزانية مشروع الواحة", &["b1"][..], false),
        c("beta_asks_falcon", Leak, BETA, "mb", NONE, "what is the budget of Falcon", &[][..], false),
    ];
    Dataset { name: "dev", corpus, cases }
}
