# The real browser

[العربية](../ar/06-browser.md)

Each mission gets a headless Microsoft Edge with a throw-away profile. JavaScript runs, so modern sites work, but every request the page makes is paused and judged by the host: private networks and cloud metadata addresses are refused, redirects are not followed blindly, and sending data (forms, uploads) needs a per-site approval. Password fields are never typed into. Downloads go to a quarantine folder and are never opened. What the page says reaches the agent labelled as untrusted web data.

## Every request intercepted

Status: **IMPLEMENTED**

```mermaid
sequenceDiagram
  participant Pg as Page (JavaScript)
  participant E as Edge (CDP Fetch)
  participant H as Host
  participant N as Navigation policy
  Pg->>E: request
  E->>H: requestPaused
  H->>N: URL, method, resource type
  alt allowed read
    H->>H: fetch once, no redirect following
    H-->>E: fulfil
  else private network, metadata, write without grant
    H-->>E: fail
  end
```

## Sending data needs a grant

Status: **IMPLEMENTED**

```mermaid
flowchart LR
  Form[Form post or upload] --> Check{Origin granted<br/>for this mission?}
  Check -- no --> Block[Blocked, WRITE_NEEDS_APPROVAL]
  Block --> Ask[Agent asks permit_write]
  Ask --> User{User decides}
  User -- grant --> Allowed[Writes to that origin allowed]
  User -- deny --> Block
  Check -- yes --> Allowed
```
