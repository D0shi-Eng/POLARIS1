<div dir="rtl">

# ما لم يُبنَ بعد

[English](../en/10-roadmap.md)

هذه المخطّطات تصف اتجاهًا لا ميزات. لنظام macOS منافذ بلا محوّلات. نقل مساحة العمل بين الأجهزة يعمل حزمةً مُتحقَّقًا من خلاصتها؛ والمزامنة المستمرّة غير موجودة. أدوار التعاون تُسجَّل محليًا؛ ولا خدمة مشتركة.

## محوّلات macOS

الحالة: **NOT_IMPLEMENTED**

```mermaid
flowchart LR
  Ports[Sandbox, browser and desktop ports<br/>as traits] -.-> MacSandbox[App Sandbox adapter]
  Ports -.-> MacBrowser[Browser adapter]
  Ports -.-> Signing[Notarised build]
```

## عدّة أجهزة

الحالة: **FOUNDATION_ONLY**

```mermaid
flowchart LR
  Dev1[Device A] -- "workspace bundle<br/>digest-checked" --> Dev2[Device B]
  Dev1 -. "continuous sync" .-> Cloud[(Not built)]
```

## التعاون

الحالة: **PLANNED**

```mermaid
flowchart LR
  Owner --> Roles[OWNER / EDITOR / VIEWER<br/>recorded locally]
  Roles -.-> Shared[Shared workspace service]
  Shared -.-> Review[Shared review and approvals]
```

</div>
