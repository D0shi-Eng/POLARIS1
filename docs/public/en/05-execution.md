# Code execution

[العربية](../ar/05-execution.md)

Commands (Windows PowerShell) and Python run inside the mission's own AppContainer and a Job Object: no access to the user's files, no network unless an approved run adds it, limits on memory, processes and CPU, and every child process ends with the job. Package installs, network use, system changes and running downloaded files always wait for the user. Python runs from an owned copy that POLARIS prepares on request.

## Sandboxed run

Status: **IMPLEMENTED**

```mermaid
sequenceDiagram
  participant T as Tool
  participant X as Execution service
  participant S as Win32 sandbox
  T->>X: command or Python code
  X->>X: write script into the workspace
  X->>S: program, arguments, explicit environment, limits
  S->>S: AppContainer SID for this mission
  S->>S: Job Object: memory, processes, CPU, kill on close
  S-->>X: exit code, output, processes, survivors
  X-->>T: measured result and audit record
```

## Workspace confinement

Status: **IMPLEMENTED**

```mermaid
flowchart TB
  Path[Requested path] --> N[Normalise, no absolute path]
  N --> D{Contains .. or a link?}
  D -- yes --> R[Refuse OUT_OF_SCOPE]
  D -- no --> A{Write into inputs/?}
  A -- yes --> R
  A -- no --> OK[Resolved inside the mission workspace]
```

## Python runtime

Status: **IMPLEMENTED**

```mermaid
flowchart LR
  Find[Find a base Python install] --> Copy[Copy into the data folder]
  Copy --> Grant[Grant the AppContainer read access]
  Grant --> Ready[Runtime ready]
  Ready --> Run[Run code in the sandbox]
  Find -. "none found" .-> Unavailable[Python unavailable, said plainly]
```
