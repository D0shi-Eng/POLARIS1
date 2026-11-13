<div dir="rtl">

# المخرجات

[English](../en/07-artifacts.md)

ينتج الوكلاء ملفات Word وExcel (بمخطّطات) وPowerPoint وPDF (ومنها العربية بخط مضمَّن) وHTML وMarkdown وCSV وصورًا وشيفرة. يكتب بولاريس هذه الصيغ بنفسه ويعيد فتح كل ملف للتحقّق منه قبل الإعلان عنه؛ ويرافق التحقّقُ المخرَج. المعاينة داخل إطار معزول بلا نصوص برمجية. والتصدير إلى مجلد اختاره المستخدم دون كتابة فوق ملف.

## مسار المخرجات

الحالة: **IMPLEMENTED**

```mermaid
flowchart LR
  Spec[Structured spec<br/>from the agent] --> Gen[Generate DOCX, XLSX, PPTX,<br/>PDF, HTML, MD, CSV]
  Gen --> Verify[Re-open and verify]
  Verify -- verified --> Store[Artifact record with checks]
  Verify -- failed --> Report[Reported as not verified]
  Store --> Preview[Preview in a sandboxed frame]
  Store --> Export[Export to the chosen folder]
  Store --> Publish[Publish after a decision]
```

</div>
