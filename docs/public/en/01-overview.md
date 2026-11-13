# POLARIS — overview

[العربية](../ar/01-overview.md)

POLARIS is a local-first desktop work environment for Windows in which AI agents do real work — run code, use a browser, produce documents — under controls the user can see: every action passes one gateway, anything risky waits for the user, and every result carries its evidence.

Each diagram below carries a status label: **IMPLEMENTED** (built and measured), **FOUNDATION_ONLY** (the structure exists, the full feature does not), **PLANNED** or **NOT_IMPLEMENTED**. Nothing here claims more than that.

What POLARIS is not, today: it is not signed, not released publicly, not available on macOS, and it has not been compared with any other product.

## System context

Status: **IMPLEMENTED**

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

## Component map

Status: **IMPLEMENTED**

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

## Phases delivered

Status: **IMPLEMENTED**

```mermaid
flowchart LR
  P00[00 Confinement spike] --> P01[01 Desktop shell] --> P02[02 Models and projects] --> P03[03 Missions]
  P03 --> P04[04 Tools and approvals] --> P05[05 Memory and browser] --> P06[06 Connectors and settings]
  P06 --> P07[07 Hardening and release candidate] --> P08[08 Real work: execution, browser, artifacts]
```
