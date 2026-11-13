<div dir="rtl">

# النموذج الأمني

[English](../en/09-security.md)

مخرجات النموذج وصفحات الويب والملفات المرفقة بيانات لا تعليمات. والذاكرة سياق لا مرتكز ثقة. العارض لا يستطيع تنفيذ شيء. كل نداء أداة يُسجَّل بخلاصاته في سجلّ تدقيق مسلسل التجزئة، ولا تكتمل مهمّة إلا بإثبات مبني من أدلّتها. والقياسات التي تعذّرت تُعلن NOT_TESTED أو BLOCKED مع السبب، ولا تُعلن ناجحة أبدًا.

## أين يتوقّف كل تهديد

الحالة: **IMPLEMENTED**

```mermaid
flowchart TB
  Inj[Prompt injection in a file or page] --> Fence[Fenced untrusted data]
  Esc[Write outside the workspace] --> Kernel[AppContainer file denial]
  Exf[Network exfiltration] --> NoCap[No network capability without approval]
  SSRF[Private network or metadata URL] --> Nav[Navigation policy]
  Self[Agent approving itself] --> Human[Approvals only through the user's IPC call]
  Leak[Secret in output] --> Redact[Redaction and environment allow-list]
```

## الأدلّة والتدقيق

الحالة: **IMPLEMENTED**

```mermaid
flowchart LR
  Act[Tool call] --> Rec[Invocation record]
  Rec --> Ev[Evidence with digests]
  Rec --> Audit[Hash-chained audit ledger]
  Ev --> Claim[Claims cite evidence]
  Claim --> Proof[Completion proof]
```

</div>
