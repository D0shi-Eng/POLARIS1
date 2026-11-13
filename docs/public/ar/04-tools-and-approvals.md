<div dir="rtl">

# الأدوات والموافقات

[English](../en/04-tools-and-approvals.md)

الوكلاء لا يتصرّفون مباشرة. يقترحون نداء أداة؛ وتفحصه بوابة الأدوات خطوة خطوة، فإمّا تنفّذه، أو ترفضه بسبب، أو تحوّله إلى موافقة يراها المستخدم. الموافقة مربوطة بالحجج نفسها: حجّة تتغيّر طلبٌ جديد. الميزانيات تحدّ ما تستطيعه المهمّة؛ والسياسة المُدارة تضيّقها ولا توسّعها أبدًا.

## مسار بوابة الأدوات

الحالة: **IMPLEMENTED**

```mermaid
flowchart LR
  P[Proposal] --> C1[Cancelled?] --> C2[Same mission?] --> C3[Skill allows tool?]
  C3 --> C4[Schema] --> C5[Settings overlay] --> C6[Policy decision point]
  C6 --> C7[Capability] --> C8[Network policy] --> C9[Budget]
  C9 --> C10{Approval needed?}
  C10 -- no --> X[Adapter]
  C10 -- yes --> A[Pending approval bound to arguments]
  X --> Ev[Evidence and audit]
```

## موافقة مربوطة بالحجج

الحالة: **IMPLEMENTED**

```mermaid
sequenceDiagram
  participant Ag as Agent
  participant G as Tool gateway
  participant U as User
  Ag->>G: propose tool with arguments A
  G-->>U: approval (tool, target, effect, risk, digest of A)
  U->>G: grant
  Ag->>G: same tool, same arguments A
  G->>G: consume the grant once
  Note over G: arguments B would need a new approval
```

## ميزانيات المهمّة

الحالة: **IMPLEMENTED**

```mermaid
flowchart TB
  Profile[Work profile<br/>mission layer] --> Budget
  Defaults[Closed defaults] --> Budget
  Policy[Managed policy<br/>narrows only] --> Budget
  Budget[Effective budget] --> Calls[tool calls]
  Budget --> Runtime[tool runtime]
  Budget --> Net[network calls]
  Budget --> Ext[external side effects]
```

</div>
