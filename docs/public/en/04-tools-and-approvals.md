# Tools and approvals

[العربية](../ar/04-tools-and-approvals.md)

Agents never act directly. They propose a tool call; the tool gateway checks it step by step and either runs it, refuses it with a reason, or turns it into an approval the user sees. An approval is bound to the exact arguments: a changed argument is a new request. Budgets bound how much a mission can do; a managed policy can narrow them but never widen them.

## Tool gateway pipeline

Status: **IMPLEMENTED**

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

## Approval bound to arguments

Status: **IMPLEMENTED**

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

## Mission budgets

Status: **IMPLEMENTED**

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
