# Security model

[العربية](../ar/09-security.md)

Model output, web pages and attached files are data, never instructions. Memory is context, never a trust anchor. The renderer cannot execute anything. Every tool call is recorded with digests in a hash-chained audit ledger, and a mission completes only with a proof built from its evidence. Measurements that could not be made are reported as NOT_TESTED or BLOCKED with the reason, never as passed.

## Where each threat stops

Status: **IMPLEMENTED**

```mermaid
flowchart TB
  Inj[Prompt injection in a file or page] --> Fence[Fenced untrusted data]
  Esc[Write outside the workspace] --> Kernel[AppContainer file denial]
  Exf[Network exfiltration] --> NoCap[No network capability without approval]
  SSRF[Private network or metadata URL] --> Nav[Navigation policy]
  Self[Agent approving itself] --> Human[Approvals only through the user's IPC call]
  Leak[Secret in output] --> Redact[Redaction and environment allow-list]
```

## Evidence and audit

Status: **IMPLEMENTED**

```mermaid
flowchart LR
  Act[Tool call] --> Rec[Invocation record]
  Rec --> Ev[Evidence with digests]
  Rec --> Audit[Hash-chained audit ledger]
  Ev --> Claim[Claims cite evidence]
  Claim --> Proof[Completion proof]
```
