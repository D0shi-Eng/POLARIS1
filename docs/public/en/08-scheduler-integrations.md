# Schedules and integrations

[العربية](../ar/08-scheduler-integrations.md)

A schedule starts an ordinary mission; it never carries a pre-granted approval. OAuth uses the system browser with PKCE and a loopback redirect, and tokens stay in the operating system's credential store — no live provider login has been measured yet, so this is a foundation. Connectors and publishing pass the same gateway; the only publisher built today writes to a local folder after a decision.

## Scheduled missions

Status: **IMPLEMENTED**

```mermaid
flowchart TB
  Tick[Tick every 30 s] --> Due{Schedule due?}
  Due -- yes --> Start[Create and start a normal mission]
  Start --> Needs{Needs approval?}
  Needs -- WAIT_FOR_APPROVAL --> Wait[Waits for the user]
  Needs -- FAIL_ON_APPROVAL --> Stop[Stops and records why]
  Needs -- no --> Run[Runs within its budget]
```

## OAuth 2.0 with PKCE

Status: **FOUNDATION_ONLY**

```mermaid
sequenceDiagram
  participant U as User
  participant H as Host
  participant B as System browser
  participant P as Provider
  H->>H: verifier, S256 challenge, state
  H->>B: open consent URL
  U->>P: signs in (the host never sees it)
  P->>H: redirect to loopback with code and state
  H->>P: exchange code with verifier
  H->>H: tokens into the credential store, never over IPC
```

## Connectors and publishing

Status: **FOUNDATION_ONLY**

```mermaid
flowchart LR
  Agent --> CG[Connector gateway<br/>policy, egress, budgets]
  CG --> Local[Local and loopback connectors]
  CG -. "remote only with a key and privacy allowed" .-> Remote[Remote REST]
  Artifact --> Propose[Publish proposal] --> Decide{User decision} --> LocalFolder[Local folder publisher]
```
