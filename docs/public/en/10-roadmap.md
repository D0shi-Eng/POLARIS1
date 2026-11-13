# What is not built yet

[العربية](../ar/10-roadmap.md)

These diagrams describe direction, not features. macOS has ports but no adapters. Moving a workspace between devices works as a digest-checked bundle; continuous sync does not exist. Collaboration roles are recorded locally; there is no shared service.

## macOS adapters

Status: **NOT_IMPLEMENTED**

```mermaid
flowchart LR
  Ports[Sandbox, browser and desktop ports<br/>as traits] -.-> MacSandbox[App Sandbox adapter]
  Ports -.-> MacBrowser[Browser adapter]
  Ports -.-> Signing[Notarised build]
```

## Several devices

Status: **FOUNDATION_ONLY**

```mermaid
flowchart LR
  Dev1[Device A] -- "workspace bundle<br/>digest-checked" --> Dev2[Device B]
  Dev1 -. "continuous sync" .-> Cloud[(Not built)]
```

## Collaboration

Status: **PLANNED**

```mermaid
flowchart LR
  Owner --> Roles[OWNER / EDITOR / VIEWER<br/>recorded locally]
  Roles -.-> Shared[Shared workspace service]
  Shared -.-> Review[Shared review and approvals]
```
