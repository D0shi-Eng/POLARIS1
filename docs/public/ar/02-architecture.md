<div dir="rtl">

# المعمارية

[English](../en/02-architecture.md)

العارض (React داخل نافذة WebView2) غير موثوق عمدًا: لا يستطيع إلا إرسال عمليات مسمّاة داخل ظرف بإصدار، والمضيف يتحقّق من كل حمولة وكل نتيجة بمخطّطات JSON يتشاركها مع حزمة العقود. المضيف مساحة عمل Rust؛ والشيفرة الخاصّة بويندوز في حزمة مستقلّة كي تبقى النواة قابلة للنقل والاختبار على أي نظام.

## حدود الثقة

الحالة: **IMPLEMENTED**

```mermaid
flowchart LR
  subgraph Untrusted
    R[Renderer]
    W[Web pages]
    M[Model output]
    A[Attached files]
  end
  subgraph Trusted host
    G[IPC gateway] --> T[Tool gateway] --> S[Services]
  end
  R -- "schema-checked envelope" --> G
  W -- "WEB_UNTRUSTED data" --> T
  M -- "proposals, never commands" --> T
  A -- "inputs/, fenced as untrusted" --> T
  S --> K[Kernel-enforced sandbox]
```

## الحزم

الحالة: **IMPLEMENTED**

```mermaid
flowchart TB
  app[polaris-host<br/>Tauri binding] --> core[polaris-host-core]
  app --> win[polaris-host-win<br/>Windows ports]
  win --> core
  core --> providers[polaris-host-providers<br/>HTTP, redaction, cancel]
  maint[polaris-maint] --> core
  harness[polaris-p08-harness<br/>measurement, not shipped] --> core
  harness --> win
  renderer[desktop/renderer] --> contracts[contracts<br/>JSON Schemas]
  core -. "embeds the same schemas" .-> contracts
```

## نداء IPC واحد

الحالة: **IMPLEMENTED**

```mermaid
sequenceDiagram
  participant R as Renderer
  participant G as Gateway
  participant S as Service
  R->>G: envelope (version, identity, operation, payload)
  G->>G: validate envelope and payload schema
  G->>G: check idempotency key for side effects
  G->>S: typed call
  S-->>G: result
  G->>G: validate result schema
  G-->>R: response or error code
```

## تخطيط البيانات المحلية

الحالة: **IMPLEMENTED**

```mermaid
flowchart TB
  Data[(Data folder)] --> DB[polaris.db<br/>schema v6]
  Data --> WS[workspaces/&lt;mission&gt;]
  Data --> RT[runtimes/python<br/>owned copy]
  Data --> BP[browser-profiles<br/>deleted on close]
  Data --> BK[backups, quarantine]
  WS --> I[inputs] & Wk[work] & O[outputs] & Dl[downloads]
```

</div>
