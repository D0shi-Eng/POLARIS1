# Missions and agents

[العربية](../ar/03-missions.md)

A mission is what the user asks for. A planner turns it into a small task graph, an executor works through each task over several turns — seeing the measured result of each tool call before the next — and a reviewer checks the claims against their evidence. Retries and revisions are bounded. The model is chosen per mission; local models are used over loopback, remote ones only when the user has added a key.

## Mission states

Status: **IMPLEMENTED**

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

## Plan, act, review

Status: **IMPLEMENTED**

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

## Multi-turn tool loop

Status: **IMPLEMENTED**

```mermaid
flowchart LR
  Prompt[Task prompt] --> Model
  Model -- "tools + continue=true" --> Gateway
  Gateway --> Result[Fenced result]
  Result --> Model
  Model -- "continue=false" --> Done[Task output and claims]
  Gateway -. "budget exhausted" .-> Stop[Stop with reason]
```

## Model routing

Status: **IMPLEMENTED**

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
