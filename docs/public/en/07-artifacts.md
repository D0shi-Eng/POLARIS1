# Artifacts

[العربية](../ar/07-artifacts.md)

Agents produce Word, Excel (with charts), PowerPoint, PDF (including Arabic with an embedded font), HTML, Markdown and CSV files, images and code. POLARIS writes these formats itself and re-opens every file to verify it before reporting it; the verification travels with the artifact. Previews run in a sandboxed frame with scripts off. Exports go to a folder the user chose, never overwriting.

## Artifact pipeline

Status: **IMPLEMENTED**

```mermaid
flowchart LR
  Spec[Structured spec<br/>from the agent] --> Gen[Generate DOCX, XLSX, PPTX,<br/>PDF, HTML, MD, CSV]
  Gen --> Verify[Re-open and verify]
  Verify -- verified --> Store[Artifact record with checks]
  Verify -- failed --> Report[Reported as not verified]
  Store --> Preview[Preview in a sandboxed frame]
  Store --> Export[Export to the chosen folder]
  Store --> Publish[Publish after a decision]
```
