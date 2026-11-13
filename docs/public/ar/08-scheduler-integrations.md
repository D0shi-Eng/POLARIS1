<div dir="rtl">

# الجداول والتكاملات

[English](../en/08-scheduler-integrations.md)

الجدول يبدأ مهمّة عادية؛ ولا يحمل موافقة ممنوحة سلفًا. يستعمل OAuth متصفّح النظام مع PKCE وإعادة توجيه إلى الحلقة المحلية، وتبقى الرموز في مخزن اعتماد نظام التشغيل — لم يُقس تسجيل دخول حقيقي لدى مزوّد بعد، فهذا أساس. الموصلات والنشر تمرّ بالبوابة نفسها؛ والناشر الوحيد المبني اليوم يكتب في مجلد محلي بعد قرار.

## المهامّ المجدولة

الحالة: **IMPLEMENTED**

```mermaid
flowchart TB
  Tick[Tick every 30 s] --> Due{Schedule due?}
  Due -- yes --> Start[Create and start a normal mission]
  Start --> Needs{Needs approval?}
  Needs -- WAIT_FOR_APPROVAL --> Wait[Waits for the user]
  Needs -- FAIL_ON_APPROVAL --> Stop[Stops and records why]
  Needs -- no --> Run[Runs within its budget]
```

## OAuth 2.0 مع PKCE

الحالة: **FOUNDATION_ONLY**

```mermaid
sequenceDiagram
  participant U as User
  participant H as Host
  participant B as System browser
  participant P as Provider
  H->>H: verifier, S256 challenge, state
  H->>B: open consent URL
  U->>P: signs in (the host never sees it)
  P->>H: redirect to loopback with code and state
  H->>P: exchange code with verifier
  H->>H: tokens into the credential store, never over IPC
```

## الموصلات والنشر

الحالة: **FOUNDATION_ONLY**

```mermaid
flowchart LR
  Agent --> CG[Connector gateway<br/>policy, egress, budgets]
  CG --> Local[Local and loopback connectors]
  CG -. "remote only with a key and privacy allowed" .-> Remote[Remote REST]
  Artifact --> Propose[Publish proposal] --> Decide{User decision} --> LocalFolder[Local folder publisher]
```

</div>
