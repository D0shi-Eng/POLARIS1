# قاعدة eval/2.1 و2.2 الآلية (2026-10-14): طلب اختيار يشير إلى مادة يملكها المستخدم ولا تُرفق به. القاعدة تُطبَّق على الطلبات الـ300 كلها
# كما هي، لا على الحالات التي رسبت وحدها. كُتبت بعد أن أظهر التشغيل التجريبي أن المنسّق لا يفوّض حين يشير الطلب إلى ملف غير موجود.
# 2.2: ضمير الملكية العربي المتصل («شركتنا»، «لشركتنا») إشارة أيضًا، وللقوائم المالية ونتائج الاستبيان مرفق بمحتواها.
import re

# إشارة إلى مادة حاضرة: اسم إشارة أو ملكية أو «هنا»، يليه (في الستين حرفًا التالية) اسم مادة.
POINTERS_EN = r"\b(this|these|here are|here is|our|my|attached)\b"
POINTERS_AR = r"(هذا|هذه|هذي|لدينا|عندنا|عندي|لدي|المرفق|المرفقة|[ء-ي]{2,}نا(?![ء-ي]))"
MATERIALS = {
    'financials': r"\b(financial statements|income statement|balance sheet)\b|القوائم المالية|قوائم مالية",
    'survey': r"\b(survey|questionnaire)\b|استبيان",
    'data': r"\b(data|figures|sales figures|results|numbers|dataset|table|spreadsheet|csv|bill|statements?)\b|بيانات|أرقام|نتائج|جدول|فاتورة",
    'logs': r"\blogs?\b|سجلات",
    'contract': r"\b(contract|agreement|lease|clause|judgment)\b|عقد|العقد|حكم",
    'code': r"\b(code|pull request|query|queries|script|schema|app|api)\b|الكود|كود|سكربت|تطبيق",
    'text': r"\b(text|document|report|brochure|letter|description|dialogue|slogan|draft|cv|interviews?|references|argument|equation|translation)\b|النص|نص|التقرير|المستند|الرسالة|المقابلات|الحجة|المعادلة|الشعار|التعليمات|الدليل",
}


def material(request: str):
    """نوع المادة التي يشير إليها الطلب، أو لا شيء. أوّل إشارة يليها اسم مادة تحسم، والأنواع الأدقّ تُفحص أوّلًا."""
    low = request.lower()
    for m in re.finditer(POINTERS_EN + "|" + POINTERS_AR, low):
        # العربية تقدّم المادة على الضمير المتصل («القوائم المالية لشركتنا»)، فالنافذة تشمل أربعين حرفًا قبل الإشارة.
        window = low[max(0, m.start() - 40): m.end() + 60]
        for kind, pattern in MATERIALS.items():
            if re.search(pattern, window):
                return kind
    return None


if __name__ == '__main__':
    import os, sys
    sys.path.insert(0, os.path.dirname(__file__))
    from selection_requests import REQUESTS
    hits = [(i, material(r), r) for i, r in enumerate(REQUESTS) if material(r)]
    print(len(hits))
    for i, k, r in hits:
        print(i, k, r[:100])
