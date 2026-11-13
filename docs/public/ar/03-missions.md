<div dir="rtl">

# المهامّ والوكلاء

[English](../en/03-missions.md)

المهمّة هي ما يطلبه المستخدم. يحوّلها المخطِّط إلى رسم مهامّ صغير، وينفّذ المنفّذ كل مهمّة على جولات — يرى النتيجة المقيسة لكل أداة قبل الجولة التالية — ويتحقّق المراجع من الادّعاءات مقابل أدلّتها. المحاولات والمراجعات محدودة العدد. يُختار النموذج لكل مهمّة؛ النماذج المحلية عبر الحلقة المحلية، والبعيدة فقط حين يضيف المستخدم مفتاحه.

## حالات المهمّة

الحالة: **IMPLEMENTED**

```mermaid
stateDiagram-v2
  [*] --> CREATED
  CREATED --> PLANNING
  PLANNING --> RUNNING
  RUNNING --> WAITING_FOR_APPROVAL
  WAITING_FOR_APPROVAL --> RUNNING: user grants or denies
  RUNNING --> VERIFYING
  VERIFYING --> COMPLETED
  RUNNING --> FAILED
  RUNNING --> CANCELLED: user cancels
  COMPLETED --> [*]
```

## خطّط، نفّذ، راجع

الحالة: **IMPLEMENTED**

```mermaid
sequenceDiagram
  participant P as Planner
  participant E as Executor
  participant T as Tool gateway
  participant V as Reviewer
  P->>E: task graph
  loop each task
    E->>T: structured tool proposal
    T-->>E: measured result (untrusted)
    E->>E: next turn sees the result
  end
  E->>V: claims with evidence
  V-->>P: accept or revise (bounded)
```

## حلقة الأدوات متعدّدة الجولات

الحالة: **IMPLEMENTED**

```mermaid
flowchart LR
  Prompt[Task prompt] --> Model
  Model -- "tools + continue=true" --> Gateway
  Gateway --> Result[Fenced result]
  Result --> Model
  Model -- "continue=false" --> Done[Task output and claims]
  Gateway -. "budget exhausted" .-> Stop[Stop with reason]
```

## توجيه النماذج

الحالة: **IMPLEMENTED**

```mermaid
flowchart TB
  Req[Mission starts] --> Pref{Model chosen<br/>for this mission?}
  Pref -- yes --> Manual[Manual routing]
  Pref -- no --> Auto[Default model and locality preference]
  Manual --> Check{Local, enabled,<br/>chat capable?}
  Auto --> Check
  Check -- yes --> Invoke[Invoke over loopback]
  Check -- no --> Refuse[Refuse with reason]
```

</div>
