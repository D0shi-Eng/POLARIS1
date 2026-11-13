<div dir="rtl">

# بولاريس — نظرة عامة

[English](../en/01-overview.md)

بولاريس بيئة عمل مكتبية محلية أولًا لنظام ويندوز، يؤدّي فيها وكلاء الذكاء الاصطناعي عملًا حقيقيًا — تشغيل شيفرة، واستعمال متصفّح، وإنتاج مستندات — تحت ضوابط يراها المستخدم: كل فعل يمرّ ببوابة واحدة، وكل ما فيه خطر ينتظر المستخدم، وكل نتيجة تحمل دليلها.

كل مخطّط أدناه موسوم بحالته: **IMPLEMENTED** (مبني ومقيس)، أو **FOUNDATION_ONLY** (البنية موجودة والميزة الكاملة ليست كذلك)، أو **PLANNED** أو **NOT_IMPLEMENTED**. لا شيء هنا يدّعي أكثر من ذلك.

ما ليس عليه بولاريس اليوم: ليس موقّعًا، ولم يُصدَر للعموم، وليس متاحًا على macOS، ولم يُقارَن بأي منتج آخر.

## سياق النظام

الحالة: **IMPLEMENTED**

```mermaid
flowchart LR
  User([User]) --> UI[Desktop window<br/>React renderer]
  UI -- "IPC envelope 1.7<br/>named operations only" --> Host[Rust host]
  Host --> Store[(SQLite store<br/>audit chain)]
  Host --> Models[Local model servers<br/>Ollama / LM Studio]
  Host -. "only with the user's key" .-> Remote[Remote model providers]
  Host --> Sandbox[AppContainer + Job Object<br/>PowerShell / Python]
  Host --> Edge[Headless Edge<br/>every request intercepted]
  Host --> Files[Mission workspaces<br/>inputs / work / outputs / downloads]
```

## خريطة المكوّنات

الحالة: **IMPLEMENTED**

```mermaid
flowchart TB
  subgraph Renderer
    Home[Home composer] --- Mission[Mission workspace] --- Settings[Settings]
  end
  subgraph Host
    GW[IPC gateway] --> P02[Providers, models, projects]
    GW --> P03[Missions and agents]
    GW --> P04[Tool gateway, skills, approvals]
    GW --> P05[Memory, browser sessions]
    GW --> P06[Connectors, cost, settings]
    GW --> P07[Recovery, backup, policy]
    GW --> P08[Execution, artifacts, scheduler, integrations]
  end
  Renderer --> GW
```

## المراحل المُنجزة

الحالة: **IMPLEMENTED**

```mermaid
flowchart LR
  P00[00 Confinement spike] --> P01[01 Desktop shell] --> P02[02 Models and projects] --> P03[03 Missions]
  P03 --> P04[04 Tools and approvals] --> P05[05 Memory and browser] --> P06[06 Connectors and settings]
  P06 --> P07[07 Hardening and release candidate] --> P08[08 Real work: execution, browser, artifacts]
```

</div>
