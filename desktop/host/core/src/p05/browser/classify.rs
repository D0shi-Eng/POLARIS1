// تصنيف أثر النقر: النقر ليس قراءة دائمًا (البند 23).
//
// رابط يُتبع بـGET تنقّلٌ. أمّا إرسال نموذج، أو رابط يُعلن حذفًا أو شراءً أو نشرًا،
// فأثر خارجي محتمل: الخادم قد يسجّل طلبًا أو يحذف حسابًا أو يقتطع مالًا. والقاعدة
// حين لا يمكن تحديد الأثر بأمان: أن يُعدّ خارجيًّا فيمرّ بموافقة، لا أن يُفترض بريئًا.
// ولذلك كل إرسال بـPOST خارجي مهما كان نصّ الزرّ، والكلمات تُفحص بالعربية والإنجليزية.

use url::Url;

use super::html::{resolve, ElementHit, FormField, PageForm, ParsedPage};

/// كلمات تدلّ على أثر خارجي في نصّ زرّ أو رابط أو مسار فعل.
const SIDE_EFFECT_WORDS: &[&str] = &[
    "submit", "send", "post", "publish", "delete", "remove", "destroy", "purchase", "buy", "pay", "order", "checkout", "confirm",
    "accept", "agree", "subscribe", "unsubscribe", "sign", "transfer", "register", "upload", "approve", "book", "donate",
    "إرسال", "ارسال", "أرسل", "شراء", "اشتر", "دفع", "ادفع", "حذف", "احذف", "نشر", "انشر", "تأكيد", "أكّد", "أكد", "موافق",
    "أوافق", "اشتراك", "تحويل", "حوّل", "طلب", "تسجيل",
];

/// ماذا سيفعل النقر، كما يقرّره زمن التشغيل من الصفحة المحمّلة لا من النموذج.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClickPlan {
    /// تنقّل بـGET إلى عنوان.
    Follow { url: Url, external: bool, reason: &'static str },
    /// إرسال نموذج.
    Submit { form_ref: String, method: String, url: Url, external: bool, reason: &'static str },
    /// عنصر لا فعل له في محرّك بلا سكربت، أو لا يُنقر.
    NoAction(&'static str),
}

impl ClickPlan {
    pub fn is_external(&self) -> bool {
        match self {
            Self::Follow { external, .. } | Self::Submit { external, .. } => *external,
            Self::NoAction(_) => false,
        }
    }
}

fn mentions_side_effect(text: &str) -> bool {
    let lower = text.to_lowercase();
    SIDE_EFFECT_WORDS.iter().any(|w| {
        // كلمة لاتينية تُطابق حدودًا تقريبية حتى لا يصير «postcard» إرسالًا.
        if w.is_ascii() {
            lower
                .split(|c: char| !c.is_alphanumeric())
                .any(|token| token == *w || (token.starts_with(w) && token.len() <= w.len() + 3))
        } else {
            lower.contains(w)
        }
    })
}

fn submit_plan(page_url: &Url, form: &PageForm, button: Option<&FormField>) -> ClickPlan {
    if form.method == "NONE" {
        return ClickPlan::NoAction("NO_FORM_ACTION");
    }
    let Some(url) = resolve(page_url, if form.action.is_empty() { page_url.as_str() } else { &form.action }) else {
        return ClickPlan::NoAction("FORM_ACTION_INVALID");
    };
    let label = button.map(|b| format!("{} {} {}", b.label, b.value, b.name.clone().unwrap_or_default())).unwrap_or_default();
    let (external, reason) = if form.method == "POST" {
        (true, "POST_FORM_SUBMISSION")
    } else if mentions_side_effect(&label) || mentions_side_effect(url.path()) || mentions_side_effect(&form.name.clone().unwrap_or_default()) {
        (true, "SIDE_EFFECT_WORDING")
    } else if form.fields.iter().any(FormField::is_password) || form.fields.iter().any(FormField::is_file) {
        // نموذج دخول أو رفع ملف: أثره خارج الجهاز حتى لو كان GET.
        (true, "CREDENTIAL_OR_FILE_FORM")
    } else {
        (false, "GET_FORM_NAVIGATION")
    };
    ClickPlan::Submit { form_ref: form.form_ref.clone(), method: form.method.clone(), url, external, reason }
}

/// يقرّر ما يفعله نقرٌ على هدف في صفحة محمّلة.
pub fn plan_click(page_url: &Url, page: &ParsedPage, target: &str) -> Option<ClickPlan> {
    let hit = page.find(target)?;
    Some(match hit {
        ElementHit::Link(link) => match resolve(page_url, &link.href) {
            Some(url) if url.scheme() == "http" || url.scheme() == "https" => {
                let external = mentions_side_effect(&link.text) || mentions_side_effect(url.path());
                ClickPlan::Follow { url, external, reason: if external { "SIDE_EFFECT_WORDING" } else { "LINK_NAVIGATION" } }
            }
            // javascript: وmailto: وغيرهما ليست تنقّلًا هنا.
            _ => ClickPlan::NoAction("LINK_NOT_NAVIGABLE"),
        },
        ElementHit::Field(form, field) => {
            if field.is_submit() {
                submit_plan(page_url, form, Some(field))
            } else {
                ClickPlan::NoAction("ELEMENT_NOT_CLICKABLE_WITHOUT_SCRIPT")
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::super::html::parse;
    use super::*;

    fn base() -> Url {
        Url::parse("http://127.0.0.1:4100/page").unwrap()
    }

    #[test]
    fn a_plain_link_is_navigation_and_a_delete_link_is_not() {
        let page = parse(r#"<a href="/next">Next page</a><a href="/account/delete">Delete account</a><a href="javascript:x()">run</a>"#);
        assert!(!plan_click(&base(), &page, "e1").unwrap().is_external());
        assert!(plan_click(&base(), &page, "e2").unwrap().is_external());
        assert_eq!(plan_click(&base(), &page, "e3").unwrap(), ClickPlan::NoAction("LINK_NOT_NAVIGABLE"));
        assert!(plan_click(&base(), &page, "e99").is_none());
    }

    #[test]
    fn every_post_submission_is_external_whatever_the_button_says() {
        let page = parse(r#"<form action="/x" method="post"><input name="q"><button>Continue</button></form>"#);
        let button = page.forms[0].fields.iter().find(|f| f.is_submit()).unwrap().element_ref.clone();
        let plan = plan_click(&base(), &page, &button).unwrap();
        assert!(plan.is_external());
        assert!(matches!(plan, ClickPlan::Submit { reason: "POST_FORM_SUBMISSION", .. }));
    }

    #[test]
    fn a_search_form_is_navigation_but_arabic_send_is_a_side_effect() {
        let search = parse(r#"<form action="/search"><input name="q"><button>Search</button></form>"#);
        let b = search.forms[0].fields[1].element_ref.clone();
        assert!(!plan_click(&base(), &search, &b).unwrap().is_external());
        let send = parse(r#"<form action="/go"><input name="q"><button>إرسال الطلب</button></form>"#);
        let b = send.forms[0].fields[1].element_ref.clone();
        assert!(plan_click(&base(), &send, &b).unwrap().is_external());
    }

    #[test]
    fn a_text_field_is_not_clickable_without_scripts() {
        let page = parse(r#"<form action="/s"><input name="q" id="q"></form>"#);
        assert_eq!(plan_click(&base(), &page, "#q").unwrap(), ClickPlan::NoAction("ELEMENT_NOT_CLICKABLE_WITHOUT_SCRIPT"));
    }
}
