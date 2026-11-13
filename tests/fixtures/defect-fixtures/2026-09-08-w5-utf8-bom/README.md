# عيّنات عيب الترميز — 2026-09-08، التشغيل الأصلي الثالث لـW5

هذه نسخ بايتية مطابقة لملفات دليل كتبها مشغّلا PowerShell في التشغيل الأصلي
الذي وقع فيه العيب. تُحفظ كما هي، ولا تُصلَح، ولا تُحذف.

**البايتات الأربعة الأولى في كل ملف: `ef bb bf 7b`** — أي `EF BB BF` (علامة
ترتيب بايتات UTF-8) ثم `{`.

الأثر: `JSON.parse` في طبقة التشغيل سقط بـ

    SyntaxError: Unexpected token 'ي╗┐'

في سبعة اختبارات — خمسة في `w5-runner-bootstrap.test.ts` واثنان في
`w5-runner-package-refresh.test.ts` — وكلها تقرأ `evidence/w5-runner-bootstrap.json`
الذي يكتبه المشغّل داخل مستودع عيّنة.

الكاتب: `Set-Content -LiteralPath ... -Encoding UTF8` تحت Windows PowerShell
5.1، حيث دلالة `UTF8` تشمل BOM. الإصلاح المعتمد في الكاتب، لا في القارئ:
`tools/evidence-contract/json-evidence.ps1`.

الغرض هنا ضبط موجب دائم: `runtime/tests/w5-evidence-encoding.test.ts` يشترط أن
تبقى هذه الملفات حاملةً للعيب، فكاشفٌ توقّف عن الكشف يسقط الاختبار بدل أن
يمرّ صامتًا.
