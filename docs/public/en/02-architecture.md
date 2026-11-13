# Architecture

[العربية](../ar/02-architecture.md)

The renderer (React in a WebView2 window) is untrusted by design: it can only send named operations in a versioned envelope, and the host validates every payload and every result against JSON Schemas shared with the contracts package. The host is a Rust workspace; Windows-specific code lives in its own crate so that the core stays portable and testable on any system.

## Trust boundaries

Status: **IMPLEMENTED**

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

## Crates and packages

Status: **IMPLEMENTED**

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

## One IPC call

Status: **IMPLEMENTED**

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

## Local data layout

Status: **IMPLEMENTED**

```mermaid
flowchart TB
  Data[(Data folder)] --> DB[polaris.db<br/>schema v6]
  Data --> WS[workspaces/&lt;mission&gt;]
  Data --> RT[runtimes/python<br/>owned copy]
  Data --> BP[browser-profiles<br/>deleted on close]
  Data --> BK[backups, quarantine]
  WS --> I[inputs] & Wk[work] & O[outputs] & Dl[downloads]
```
