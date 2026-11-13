# ADR-007 — تعداد جدول المقابض على ويندوز بلا سقف مخترع وبواجهة عامة

- الحالة: **مقبول — المراجعة 2**
- التاريخ: 2026-09-04 (المراجعة 1)، 2026-09-04 (المراجعة 2: تصحيح واقعي واستبدال المصدر الأساسي)
- يمسّ: `tools/w4-windows-adapter`
  (`PssHandleEnumeration`، `NtHandleEnumeration`، `HandleTableModel`، `HandleScanner`، `ConfinedLauncher`، مسبار W-11)
- لا يغيّر: ADR-001 (آلية الحصر)، ADR-004 (الفرض والتصنيف)، ADR-005 (حلّ الحزم)، ADR-006 (نطاق كود التشغيل)

## تصحيح المراجعة 2 — ما كان خطأ في المراجعة 1

المراجعة 1 من هذه الوثيقة نفَت وجود واجهة عامة في `kernel32` تُعدّد جدول مقابض
عملية أخرى، وبنت على ذلك النفي اختيار واجهة داخلية أساسًا للتعداد.

**ذلك النفي خطأ واقعي.** مايكروسوفت توثّق Process Snapshotting API في
`processsnapshot.h`، ومكتبتها `kernel32.Lib`، وتصديرها `Kernel32.dll`، منذ
ويندوز 8.1 وويندوز سيرفر 2012 R2:

| الرمز | ما توثّقه مايكروسوفت |
| --- | --- |
| `PssCaptureSnapshot(ProcessHandle, CaptureFlags, ThreadContextFlags, &Snapshot)` | التقاط لقطة لعملية هدف |
| `PSS_CAPTURE_HANDLES` = `0x00000004` | «Capture the handle table (handle values only)» |
| `PSS_CAPTURE_HANDLE_BASIC_INFORMATION` = `0x00000010` | معلومات المقبض الأساسية |
| `PSS_CAPTURE_HANDLE_NAME_INFORMATION` = `0x00000008` | أسماء الكائنات |
| `PssQuerySnapshot(..., PSS_QUERY_HANDLE_INFORMATION = 4, ...)` | يعيد `PSS_HANDLE_INFORMATION` |
| `PSS_HANDLE_INFORMATION.HandlesCaptured` | «The count of handles captured» |
| `PssWalkMarkerCreate(NULL, &Marker)` | علّامة المشي؛ المُخصِّص اختياري ويجوز `NULL` |
| `PssWalkSnapshot(..., PSS_WALK_HANDLES = 2, Marker, Buffer, Length)` | يعيد `PSS_HANDLE_ENTRY` إدخالًا إدخالًا |
| `PSS_HANDLE_ENTRY.Handle` | **قيمة المقبض الخام في العملية الهدف** |
| `ERROR_NO_MORE_ITEMS` | «The walk has completed and there are no more items to return» |

وفي المقابل، توثيق `NtQueryInformationProcess` نفسه يقول نصًّا:

> «NtQueryInformationProcess may be altered or unavailable in future versions of
> Windows. Applications should use the alternate functions listed in this topic.»
>
> «The **NtQueryInformationProcess** function and the structures that it returns
> are internal to the operating system and subject to change from one release of
> Windows to another.»

وصفحة `PROCESSINFOCLASS` العامة توثّق سبع قيم فقط
(`ProcessBasicInformation` 0، `ProcessDebugPort` 7، `ProcessWow64Information` 26،
`ProcessImageFileName` 27، `ProcessBreakOnTermination` 29،
`ProcessTelemetryIdInformation` 64، `ProcessSubsystemInformation` 75).
**`ProcessHandleInformation` (51) ليست منها**، فلا يجوز وصفها في أي وثيقة أو تعليق
بأنها «موثّقة رسميًا».

## السياق — العيب الأصلي، وهو قائم كما هو

كان `HandleScanner` يحمل:

```csharp
private const long MaxHandleValue = 8192;
for (long value = 4; value <= MaxHandleValue; value += 4) { DuplicateHandle(...); }
```

أي أنه يستنتج جدول المقابض بتجريب مدى مخمَّن. مقبض موروث قيمته أعلى من السقف لا
يُرى إطلاقًا، فتُقرأ النتيجة نظيفة بينما لم يُفحص أعلى الجدول أصلًا. ورفع الرقم
يبقى تخمينًا: المشكلة ليست في الرقم بل في وجود رقم. هذا التشخيص لم يتغيّر. ما تغيّر
هو من أين يأتي البديل.

## القرار

مصدر التعداد هو النظام عبر **واجهة عامة موثّقة**، والاكتمال يُثبَت لا يُفترض.

### 1. المعدِّد الأساسي: Process Snapshotting API

`tools/w4-windows-adapter/PssHandleEnumeration.cs`:

```
PssCaptureSnapshot(child, PSS_CAPTURE_HANDLES | PSS_CAPTURE_HANDLE_BASIC_INFORMATION, 0, &snap)
PssQuerySnapshot(snap, PSS_QUERY_HANDLE_INFORMATION, &info, sizeof info)   → info.HandlesCaptured
PssWalkMarkerCreate(NULL, &marker)
while PssWalkSnapshot(snap, PSS_WALK_HANDLES, marker, &entry, size) == ERROR_SUCCESS:
        entry.Handle  ← قيمة المقبض في العملية الهدف
… حتى ERROR_NO_MORE_ITEMS
PssFreeSnapshot(GetCurrentProcess(), snap)
```

لا سقف لقيم المقابض في هذا المسار بحال، ولا تجريب أعمى. عدد الإدخالات يحدّده
النظام (`HandlesCaptured`) وينتهي المشي بجواب النظام نفسه.

**طول مخزن الإدخال** يُسوّى مع الواجهة لا يُخمَّن: أول محاولة بحجم البنية كما تعلنه
طبقة الترتيب، وإن ردّت الواجهة `ERROR_BAD_LENGTH` تُجرَّب أطوال متدرّجة حتى تقبل،
والطول المقبول يُسجَّل في الدليل (`entry_size_used`). التسوية تجري على علّامة مشي
مستقلة تُحرَّر بعدها، فلا تستهلك موضعًا من المشي الحقيقي. وهذا حدّ على حجم بنية
واحدة، لا على قيم المقابض ولا على عددها.

**راية الالتقاط** لها مسار احتياطي داخل الواجهة العامة نفسها: إن رفض النظام
`PSS_CAPTURE_HANDLES | PSS_CAPTURE_HANDLE_BASIC_INFORMATION` يُعاد الالتقاط
بـ`PSS_CAPTURE_HANDLES` وحدها، والراية المستعملة تُسجَّل (`capture_flags`).

### 2. إثبات اكتمال التعداد العام — خمسة شواهد

| الشاهد | ما يثبته |
| --- | --- |
| `PssCaptureSnapshot` نجح، والراية المستعملة مسجَّلة | الالتقاط وقع فعلًا، وبأي صلاحية |
| `PSS_HANDLE_INFORMATION.HandlesCaptured` مقروء ومسجَّل | عدّ النظام نفسه معروف، لا مستنتج |
| المشي انتهى بـ`ERROR_NO_MORE_ITEMS` لا بخطأ آخر | المشي اكتمل ولم يُقطع |
| عدد ما مُشي عليه == `HandlesCaptured` | لم يسقط إدخال ولم يُكرَّر |
| الضابط الموجب في W-11: مقبض مسرَّب عمدًا **يجب أن يراه هذا التعداد** | أداة القياس ترى ما هو موجود فعلًا، على هذا الجهاز، في هذا التشغيل |

سقوط أيٍّ منها ⇒ التعداد غير مكتمل ⇒ **INCONCLUSIVE**، ولا يُقرأ نظافةً بحال.

ويبقى قائمًا فوق ذلك الشاهد المستقل من المراجعة 1: تجريب `DuplicateHandle` على مدى
**مشتق من القياس** (حتى أعلى قيمة معدودة، وزيادة متناسبة مع حجم الجدول المُبلَّغ).
أي مقبض ينسخ بنجاح ولا يوجد في التعداد ⇒ التعداد ناقص
(`ENUMERATION_MISSED_DUPLICABLE_HANDLE`). المدى ليس سقفًا: التعداد لا يعتمد عليه،
ووظيفته الشهادة عليه لا استبداله.

### 3. الواجهة الداخلية — دورها بعد التصحيح

`NtQueryInformationProcess(ProcessHandleInformation = 51)` تبقى في
`NtHandleEnumeration.cs` بدورين معلنين، ولا ثالث لهما:

1. **شاهد ثانٍ مستقل** على تعداد PSS، يجري في كل لقطة.
2. **مسار احتياطي معلن** (`NT_FALLBACK_DECLARED`) حين تتعذّر الواجهة العامة على
   الجهاز. لا يُخفَّف شرط اكتمال واحد بسبب ذلك، ويُسجَّل مصدر التعداد في الدليل
   (`enumeration_source`) فلا يمرّ المسار الاحتياطي صامتًا.

وهي كذلك مصدر الحقول الوصفية (الصلاحية الممنوحة، دليل النوع، السمات) التي تصف
وثيقة `PSS_HANDLE_ENTRY` نظائرها بأنها «Reserved for OS use». **هذه الحقول وصفية
في الدليل ولا يُبنى عليها حكم.**

كل موضع يذكرها يصنّفها `INTERNAL_UNDOCUMENTED` صراحةً، مقابل `PUBLIC_DOCUMENTED`
لمسار PSS.

### 4. اختلاف المصدرين لا يُدمج ولا يُخفى

المقارنة على **مجموعتَي قيم المقابض** — وهي ما تعطيه الواجهتان بصفة معتمَدة —
وتجري على هدف **معلّق** فقط: هناك أي اختلاف يعني أن أحد القياسين خاطئ.

- اختلفا ⇒ **INCONCLUSIVE**، `reason_code = HANDLE_ENUMERATION_SOURCES_DISAGREE`،
  ومعه في الدليل `primary_only_values` و`secondary_only_values` كاملتين.
- وفي مسار W4 الحقيقي الفرض لا الوصف: الاختلاف **يمنع استئناف العملية**
  (`WINDOWS_HANDLE_ENUMERATION_SOURCES_DISAGREE`)، تمامًا كما يمنعه تعداد ناقص أو
  مقبض خارج النطاق.
- **لا يُرجَّح مصدر على آخر عند الاختلاف، ولا تُدمج القائمتان، ولا يُؤخذ اتحادهما
  ولا تقاطعهما.** القياس نفسه موضع شك، والحكم يقف.

وعلى هدف **يعمل** (لقطة ما بعد الاستئناف، وهي تشخيصية بحتة) لا تجري المقارنة أصلًا،
ويُسجَّل سبب امتناعها `TARGET_NOT_SUSPENDED`: جدول عملية تعمل قد يتغيّر بين
القياسين، واتهام ذلك بأنه تناقض قياس خطأ بالاتجاه المعاكس.

### 5. الابن يبقى معلّقًا طوال لقطة الوراثة الأساسية

`CREATE_SUSPENDED` ثم الضم إلى الـJob ثم **كل** تعداد الوراثة (PSS والداخلي معًا)
ثم الفرض ثم `ResumeThread`. لا يقع أي التقاط أو مشي بعد الاستئناف في مسار الحكم.
هذا ما يجعل نتيجة اللقطة حتمية وقابلة للمقارنة بين مصدرين.

### 6. الوصف

لكل قيمة معدودة: `DuplicateHandle` إلى عملية الفاحص، ثم `GetFileType`، ثم
`GetFinalPathNameByHandleW` لمقابض القرص. النسخ يقع في جدول **الفاحص** لا في جدول
الهدف، فلا يغيّر ما نقيسه. ومقبض لا يُنسخ يُسجَّل كما هو (`duplicable: false`
ورمز الخطأ) بدل أن يُحذف من الدليل.

### 7. تصنيف المنشأ

| التصنيف | متى |
| --- | --- |
| `INHERITED_AT_CREATE` | موجود في لقطة العملية وهي **معلّقة**، ولم تنفّذ تعليمة واحدة |
| `PROBE_CREATED` | الكائن نفسه من صنع المسبار (أنابيب المجاري القياسية)، يُطابَق بـ`CompareObjectHandles` |
| `RUNTIME_OPENED` | ظهر في لقطة ما بعد الاستئناف ولم يكن في لقطة الإنشاء |

### 8. أثر الاكتمال على الحكم

- تعداد لم يثبت اكتماله ⇒ **INCONCLUSIVE**، لا PASS ولا FAIL.
- مصدران متناقضان ⇒ **INCONCLUSIVE**، لا PASS ولا FAIL.
- كلا المصدرين فشل ⇒ **INCONCLUSIVE**،
  `reason_code = NO_HANDLE_ENUMERATION_SOURCE_SUCCEEDED`.
- قائمة نظيفة من تعداد لم يثبت اكتماله لا تُقرأ نظافةً بحال.
- **هذه المراجعة لم ترفع أي حكم إلى PASS.** كل ما فعلته أنها زادت شروط الاكتمال
  وأضافت سببًا جديدًا للتوقف.

## العزل

`ntdll` تُستدعى في ملف واحد: `NtHandleEnumeration.cs`. مسار PSS كلّه `kernel32`
ولا يلمس `ntdll` بحال. النماذج المشتركة في `HandleTableModel.cs`. ولا يظهر شيء من
هذا في `contracts` ولا في `runtime`. محروس باختبارات تفشل إن ذُكرت `ntdll` في ملف
آخر من المحوّل، أو ذُكر تفصيل أصلي في مصدر العقود أو الـruntime، أو سبق استدعاء
الواجهة الداخلية استدعاءَ العامة في `HandleScanner`.

## البدائل المرفوضة

| البديل | سبب الرفض |
| --- | --- |
| إبقاء `NtQueryInformationProcess` أساسًا | واجهة داخلية تصفها مايكروسوفت بأنها قابلة للتغيير بين الإصدارات، وتوجد بديلة عامة تفي بالغرض. الاعتماد الأساسي عليها بلا ضرورة دَيْن معماري |
| رفع السقف إلى 65536 | تخمين آخر. المشكلة ليست في الرقم بل في وجود رقم |
| الاكتفاء بالتجريب الأعمى | يقيس ما جرّبه فقط، ويسمّي ما لم يجرّبه «نظيفًا» |
| دمج نتائج PSS والداخلية في قائمة واحدة | يخفي التناقض بدل أن يعلنه، ويصنع ثقة لم تُقَس |
| `NtQuerySystemInformation(SystemExtendedHandleInformation)` | مقابض النظام كله ثم ترشيح بالـPID: أثقل، وأوسع امتيازًا، وداخلي أيضًا |
| أدوات خارجية (handle.exe وغيرها) | تبعية خارجية في بوابة مطابقة، وبلا ضمان وجود |
| منطق واصفات لينكس | ليس دليلًا على ويندوز بحال |

## الحدود المعلنة

- Process Snapshotting API متاحة من ويندوز 8.1 وسيرفر 2012 R2. على ما دونها لا
  تتوفر، ويعمل المسار الاحتياطي المعلن. نطاق POLARIS هو ويندوز 11، فهذه حدود
  نظرية لا عملية، وتُسجَّل مع ذلك.
- توثيق `PSS_CAPTURE_FLAGS` لا ينصّ على صلاحية وصول مطلوبة لرايات المقابض (ينصّ
  على `PROCESS_VM_READ` لراية فضاء العناوين وحدها). المحوّل يعدّد ابنًا أنشأه بنفسه
  فيملك مقبضه كامل الصلاحية؛ فشل الالتقاط يُسجَّل برمزه ولا يُقرأ نظافةً.
- الحكم يقع على مقابض **نظام الملفات** خارج النطاق. مقابض الكائنات الأخرى تُسجَّل
  بنوعها ولا تدخل الحكم: الحكم عليها يحتاج حلّ أسماء الكائنات، وهو خارج نطاق W4.
- `CompareObjectHandles` (ويندوز 10 1607+) قد لا تتوفر؛ عندها يُسجَّل
  `object_identity_available: false` ولا يُدَّعى تصنيف لم يُقَس.
- التعداد يقع من عملية الوالد على ابن أنشأته هي. لا يُدّعى شيء عن عمليات أخرى.
- **لم يُشغَّل أي من هذا على ويندوز بعد.** المحوّل لم يُصرَّف في هذه الجولة
  (`ADAPTER_BUILD` = BLOCKED، لا مُصرِّف C# في بيئة الجلسة)، وW-01…W-12 تبقى
  `NOT_TESTED` حتى التشغيل الأصلي.
