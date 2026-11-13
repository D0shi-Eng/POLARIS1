<div dir="rtl">

# المتصفّح الحقيقي

[English](../en/06-browser.md)

لكل مهمّة متصفّح Microsoft Edge بلا واجهة وبملف تعريف مؤقّت. يعمل جافاسكربت فتعمل المواقع الحديثة، لكن كل طلب تُطلقه الصفحة يُوقَف ويحكم عليه المضيف: الشبكات الخاصّة وعناوين البيانات الوصفية السحابية مرفوضة، وإعادة التوجيه لا تُتبع عمياء، وإرسال البيانات (النماذج والرفع) يحتاج موافقة لكل موقع. حقول كلمات المرور لا يُكتب فيها أبدًا. التنزيلات تذهب إلى مجلد عزل ولا تُفتح. وما تقوله الصفحة يصل الوكيل موسومًا بيانات ويب غير موثوقة.

## كل طلب يُعترَض

الحالة: **IMPLEMENTED**

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

## إرسال البيانات يحتاج إذنًا

الحالة: **IMPLEMENTED**

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

</div>
