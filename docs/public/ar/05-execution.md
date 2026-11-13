<div dir="rtl">

# تشغيل الشيفرة

[English](../en/05-execution.md)

الأوامر (Windows PowerShell) وPython تعمل داخل AppContainer خاصّ بالمهمّة وكائن مهمّة: لا وصول إلى ملفات المستخدم، ولا شبكة إلا بتشغيل موافَق عليه، وحدود للذاكرة والعمليات والمعالج، وكل عملية فرعية تنتهي مع كائن المهمّة. تثبيت الحزم واستعمال الشبكة وتغيير النظام وتشغيل الملفات المنزّلة تنتظر المستخدم دائمًا. يعمل Python من نسخة مملوكة يُعدّها بولاريس عند الطلب.

## تشغيل داخل الصندوق

الحالة: **IMPLEMENTED**

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

## حصر مساحة العمل

الحالة: **IMPLEMENTED**

```mermaid
flowchart TB
  Path[Requested path] --> N[Normalise, no absolute path]
  N --> D{Contains .. or a link?}
  D -- yes --> R[Refuse OUT_OF_SCOPE]
  D -- no --> A{Write into inputs/?}
  A -- yes --> R
  A -- no --> OK[Resolved inside the mission workspace]
```

## بيئة Python

الحالة: **IMPLEMENTED**

```mermaid
flowchart LR
  Find[Find a base Python install] --> Copy[Copy into the data folder]
  Copy --> Grant[Grant the AppContainer read access]
  Grant --> Ready[Runtime ready]
  Ready --> Run[Run code in the sandbox]
  Find -. "none found" .-> Unavailable[Python unavailable, said plainly]
```

</div>
