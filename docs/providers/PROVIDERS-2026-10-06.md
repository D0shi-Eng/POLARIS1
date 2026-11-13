# المزوّدون: كيف يتكلّم POLARIS مع كل واحد (2026-10-06)

**الغرض:** لكل مزوّد طلبه المالك:

- العنوان الذي يُرسل إليه POLARIS؛
- الحقول التي يرسلها، والتي لا يرسلها، ولماذا؛
- مصدر كل حكم.

**طريقة التحقّق:**

- قُرئت صفحة كل مزوّد الرسمية في 2026-10-06.
- Groq وحده قِيس بنداءات حقيقية، بمفتاح المالك الذي حفظه في التطبيق.
- ما لم يُتحقَّق منه مكتوب أنه لم يُتحقَّق منه.

**الكود الذي يطبّق هذا:**

| الجزء | الملف |
|---|---|
| جدول الصياغة لكل مزوّد | `tools/provider-catalog/wire.mjs` |
| الصياغة داخل الفهرس | `desktop/host/providers/data/hosted-catalog.json`، حقل `wire` |
| المحوّل الذي يقرؤها | `desktop/host/providers/src/adapters/openai_compat.rs` |
| أنواع الصياغة | `desktop/host/providers/src/domain/messages.rs`، `WireProfile` |

---

## 1. قواعد عامّة لكل مزوّد بعيد

| القاعدة | السبب والمصدر |
|---|---|
| **لا تُرسل درجة الحرارة** | تُرفض أو تُتجاهل عند عدّة مزوّدين؛ التفصيل تحت الجدول |
| **جهد الاستدلال لنموذج يعلن الفهرس أنه يستدلّ، وحده** | قِيس على Groq: `allam-2-7b` ردّ 400 «`reasoning_effort` is not supported with this model» |
| **رفض 400 يسمّي حقلًا اختياريًّا يُعاد النداء بدونه مرة** | الحقول: `stream_options` و`response_format` و`reasoning_effort` و`enable_thinking` و`thinking` و`reasoning_split` و`temperature` |
| **لا تُعرض الأدوات على نموذج يوثّق الفهرس أنه لا يستدعيها** | قِيس على Groq: `allam-2-7b` ردّ 400 «`tool calling` is not supported with this model» على الطلب كله |
| **خطأ داخل البثّ (`event: error`) برمز `tool_use_failed` عيبُ مخرجات** | قِيس على Groq: نموذج كتب اسم أداة خطأ (`polatis_workspace_write`)، فوصل الخطأ بعد حالة 200. قبل الإصلاح كان يُحسب عطل مزوّد، فيُعاد الطلب نفسه |
| **429 يُنتظر بمهلة `retry-after` التي يرسلها المزوّد** | التفصيل تحت الجدول |
| **413 يُنصّف سقف المخرجات للمهمّة ويُعاد النداء** | التفصيل تحت الجدول |
| **الاستدلال الظاهر يُلتقط من البثّ** | يأتي في `reasoning_content` أو `reasoning`. يُعاد في رسائل المساعد السابقة، للمزوّد الذي يشترطه وحده. لا يُحفظ ولا يُعرض |

**درجة الحرارة، من يرفضها:**

- **Anthropic:** «النماذج الصادرة بعد Claude Opus 4.6 لا تدعم ضبطها»، وتُرفض كل قيمة غير 1.0 (platform.claude.com/docs/en/api/messages).
- **Kimi:** قيمتها ثابتة لكل نموذج، و«القيم الأخرى تعيد خطأ» (platform.kimi.ai/docs/api/models-overview).
- **ديب سيك:** في وضع الاستدلال «لا خطأ ولا أثر».
- **OpenAI:** توصي بواجهة Responses لنماذج الاستدلال.
- **ما كان يرسله POLARIS:** 0.0 و0.3، فكانت طلباته تُرفض عند Anthropic وKimi.

**429، تحديد المعدّل:**

- قِيس على Groq، الطبقة المجانية: 19 ردًّا بـ429 في ثلاث مهامّ صغيرة.
- كانت ستّ إعادات لكل مهمّة بجدول ثابت 20/60 ثانية تستنفدها، فتُحجب المهمّة.
- **الآن:** عدّاد مستقلّ بحدّ 40، مهلة كلٍّ منها بين ثانية و90 ثانية، وتحت ميزانية وقت المهمّة نفسها.

**413، الطلب أكبر مما يقبله المزوّد:**

- قِيس على Groq: ردّ 413 لأن المدخلات مع سقف المخرجات (4096) تجاوزت حدّ الرموز في الدقيقة.
- قبل الإصلاح كان 413 يُقرأ «الخادم يرفض الأدوات الأصيلة»، فتنتقل المهمّة إلى الصيغة النصّية، فيعيد النموذج ردودًا فارغة، وتُحجب المهمّة.

---

## 2. المزوّدون واحدًا واحدًا

**مفردات حالة التحقّق في الجداول:**

| المفردة | معناها |
|---|---|
| **قِيس** | بنداء حقيقي |
| **وثائق** | قُرئ في الصفحة الرسمية |
| **فهرس** | من لقطة models.dev وحدها |

### Groq

| البند | القيمة | الحالة |
|---|---|---|
| العنوان | `https://api.groq.com/openai/v1` | وثائق، قِيس |
| المفتاح | `Authorization: Bearer` | قِيس |
| سقف المخرجات | `max_completion_tokens`؛ `max_tokens` «Deprecated» | وثائق |
| الاستدلال | `reasoning_effort`؛ يظهر في `delta.reasoning` | قِيس |
| الاستهلاك في البثّ | `stream_options.include_usage` يعمل | قِيس |
| إعادة الاستدلال | لا تُشترط | وثائق |
| قائمة النماذج | `/models` تعيد `context_window` و`max_completion_tokens`، وPOLARIS يقرؤهما الآن بوسم «أبلغ به المزوّد» | وثائق، قِيس |

**جهد الاستدلال حسب النموذج:**

- `gpt-oss`: `low/medium/high`.
- `qwen3.8-27b`: `none/default/low/medium/high`.

**ما لا يُدعم (400):** `logprobs`، و`logit_bias`، و`top_logprobs`، و`messages[].name`. `n` يجب أن يكون 1.

**ما قِيس على `gpt-oss-120b` وعلى `qwen3.8-27b`:**

- `json_object` مع البثّ يعمل.
- الأدوات مع البثّ تعمل.
- الاستدعاء يصل في جزء واحد.

**ما يقوله Groq عن نفسه:**

- **«Structured Outputs»:** بمخطّط، «غير مدعومة مع البثّ ومع الأدوات».
- **الأدوات المتوازية:** `gpt-oss` لا يدعمها، بخلاف `qwen3.8-27b`.
- **مكان التعليمات:** يوصي بوضع التعليمات في رسالة المستخدم لا رسالة النظام لنماذج الاستدلال. **لم يُطبَّق:** لم يُقَس أثره.

**الأخطاء المقيسة:**

- 413 حين تتجاوز المدخلات مع السقف حدّ الدقيقة.
- 429 متكرّر في الطبقة المجانية.
- `tool_use_failed` داخل البثّ.

**المصادر:**

- console.groq.com/docs/openai
- console.groq.com/docs/api-reference
- console.groq.com/docs/reasoning
- console.groq.com/docs/tool-use
- console.groq.com/docs/structured-outputs

### ديب سيك

| البند | القيمة | الحالة |
|---|---|---|
| العنوان | `https://api.deepseek.com`؛ وصيغة Anthropic على `/anthropic` | وثائق |
| النماذج | `deepseek-flash` و`deepseek-v4-pro`؛ والأسماء القديمة «مقبولة لكنها مهملة» | وثائق |
| الاستدلال | `thinking: {type: enabled|disabled}`، مفعّل افتراضًا بجهد `high`. `reasoning_effort` في أعلى الجسم: `low/high/max` | وثائق |
| **إعادة الاستدلال** | **مع الأدوات: «يجب أن يُعاد `reasoning_content` كاملًا في كل الطلبات اللاحقة»، وإلا 400** | وثائق |
| ما يرسله POLARIS | `max_tokens`، و`reasoning_effort` لنموذج يستدلّ، و`reasoning_content` في رسائل المساعد السابقة | — |
| `tool_choice` | «غير مدعوم في وضع الاستدلال». POLARIS يرسل `auto` | وثائق |

**ما لم يُقَس:** لا مفتاح لديب سيك على هذا الجهاز.

**المصادر:**

- api-docs.deepseek.com
- api-docs.deepseek.com/guides/thinking_mode
- api-docs.deepseek.com/api/create-chat-completion
- api-docs.deepseek.com/quick_start/pricing

### Kimi (Moonshot)

| البند | القيمة | الحالة |
|---|---|---|
| العنوان | `https://api.moonshot.ai/v1` (الصين `api.moonshot.cn/v1` من الفهرس) | وثائق |
| النماذج | `kimi-k3`، و`kimi-k2.6`، و`kimi-k2.7-code` | وثائق |
| سقف المخرجات | `max_completion_tokens`؛ `max_tokens` مهمل | وثائق |
| **درجة الحرارة** | **ثابتة: k3 وk2.7-code عند 1.0، وk2.6 عند 1.0 مع الاستدلال و0.6 بدونه؛ «القيم الأخرى تعيد خطأ»** | وثائق |
| `top_p` و`n` والعقوبات | ثابتة لا تُغيَّر | وثائق |
| **إعادة الاستدلال** | **«احفظ دائمًا `reasoning_content` لكل رسالة مساعد سابقة»** | وثائق |
| الاستدلال | k2.6: `thinking {type}`؛ k3: `reasoning_effort`. POLARIS لا يرسل جهدًا لهذا المزوّد، فيبقى افتراضه | وثائق |

**ما لم يُقَس:** لا مفتاح.

**المصادر:**

- platform.kimi.ai/docs/api/chat
- platform.kimi.ai/docs/api/models-overview

### Z.AI (GLM)

| البند | القيمة | الحالة |
|---|---|---|
| العنوان | `https://api.z.ai/api/paas/v4`. خطة البرمجة: `…/api/coding/paas/v4`. الصين: `open.bigmodel.cn` | وثائق، فهرس |
| الاستدلال | `thinking {type: enabled|disabled}`، مفعّل افتراضًا. POLARIS يرسل `disabled` حين يُطلب «بلا استدلال»، ولا شيء غير ذلك | وثائق |
| إعادة الاستدلال | `clear_thinking` افتراضه `true`، فلا تُشترط | وثائق |
| درجة الحرارة | `[0.0, 1.0]`، ولا تُرسل | وثائق |
| `tool_choice` | «`auto` وحدها» | وثائق |
| `response_format` | `text` أو `json_object` | وثائق |

**ما لم يُقَس:** لا مفتاح.

**المصدر:** docs.z.ai/api-reference/llm/chat-completion

### MiniMax

| البند | القيمة | الحالة |
|---|---|---|
| العنوان | `https://api.minimax.io/v1` | وثائق |
| سقف المخرجات | `max_completion_tokens` (موصى به) | وثائق |
| **فصل الاستدلال** | **`reasoning_split: true` يضعه في `reasoning_content`؛ بدونه يبقى داخل `<think>` في النصّ. POLARIS يرسله** | وثائق |
| **إعادة الاستدلال** | **«يجب أن يُلحق ردّ النموذج كاملًا بسجلّ المحادثة»** | وثائق |
| الاستهلاك في البثّ | `stream_options.include_usage` | وثائق |

**ما لم يُقَس:** لا مفتاح. الصفحة لا تذكر الافتراض حين يغيب `reasoning_split`.

**المصدر:** platform.minimax.io/docs/api-reference/text-openai-api

### Alibaba Model Studio (Qwen)

| البند | القيمة | الحالة |
|---|---|---|
| العنوان | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (سنغافورة) | وثائق |
| الاستدلال | `enable_thinking` في أعلى الجسم عند الطلب المباشر عبر HTTP. POLARIS يرسل `false` حين يُطلب «بلا استدلال»، ولا شيء غير ذلك | وثائق |
| الاستهلاك في البثّ | في آخر جزء فقط | وثائق |
| `response_format` | `json_object` يتطلّب ذكر JSON في الموجّه | وثائق |

**العنوان الأقدم:**

- ما زال متاحًا، لكن الوثائق توصي بعنوان المساحة الخاصّ: `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`.
- تقول الوثائق إن نطاق DashScope «لن يدعم ميزات جديدة بعد 30 سبتمبر 2026».
- **من له مساحة خاصّة:** يضيفها «مزوّدًا مخصّصًا» بعنوانها.

**ما لم يُقَس:** لا مفتاح.

**المصادر:**

- www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions
- …/compatibility-of-openai-with-dashscope

### xAI

| البند | القيمة | الحالة |
|---|---|---|
| العنوان | `https://api.x.ai/v1` | وثائق |
| الاستدلال | `reasoning_effort` لـ grok-4.5 فما بعد: `low/medium/high`؛ و`xhigh` من 4.6 | وثائق |
| ما يُرفض مع نماذج الاستدلال | `presencePenalty` و`frequencyPenalty` و`stop`. POLARIS لا يرسلها | وثائق |
| واجهة Responses | الواجهة الأساسية عندهم، وتعيد استدلالًا مشفّرًا يُعاد. POLARIS يستعمل Chat Completions | وثائق |

**ما لم يُقَس:** لا مفتاح.

**المصادر:**

- docs.x.ai/docs/guides/reasoning
- docs.x.ai/docs/api-reference

### OpenAI (محوّل مدمج)

| البند | القيمة | الحالة |
|---|---|---|
| العنوان | `https://api.openai.com` | — |
| سقف المخرجات | `max_completion_tokens` | — |
| درجة الحرارة | لا تُرسل | — |
| الاستدلال | `reasoning_effort` لنموذج يعلن الفهرس أنه يستدلّ، ويُسقط إن رُفض | — |

**حدّ معلن:**

- الوثائق تقول: «Chat Completions لا يدعم استدعاء الدوال مع GPT-6 Astra وGPT-6.1 Sol».
- وتقول: «نماذج الاستدلال تعمل أفضل مع واجهة Responses».
- **POLARIS لا يملك محوّل Responses بعد.** مع هذين النموذجين تعمل المهمّة بالصيغة النصّية لا بالأدوات الأصيلة.

**ما لم يُقَس:** لا مفتاح.

**المصدر:** developers.openai.com/api/docs/guides/reasoning

### Anthropic (محوّل مدمج)

| البند | القيمة | الحالة |
|---|---|---|
| **الأدوات الأصيلة** | **بُنيت في هذه الجلسة:** `tools` بـ`input_schema`، و`tool_use` و`tool_result` كتلًا، و`tool_choice: {type: auto}`. ما تتابع من دور واحد يُدمج في رسالة | وثائق، مختبَر |
| درجة الحرارة | لا تُرسل | وثائق |
| الاستدلال الموسَّع | لا يُطلب، فلا توقيعات تُعاد | — |

**حدّ معلن:**

- الاستدعاء غير متدفّق كما كان.
- الوثائق توصي بالبثّ للطلبات الطويلة.

**ما لم يُقَس:** لا مفتاح.

**المصدر:** platform.claude.com/docs/en/api/messages

### Google (محوّل مدمج)

| البند | القيمة | الحالة |
|---|---|---|
| درجة الحرارة | لا تُرسل: الوثائق توصي بإبقائها على افتراضها 1.0 لنماذجها الأحدث | — |

**حدّ معلن:** المحوّل لا ينقل الأدوات أصيلةً. المهمّة تعمل بالصيغة النصّية. استدعاء الدوال عند نماذج Google الأحدث يشترط إعادة «توقيعات الفكر»، ولم يُبنَ.

**ما لم يُقَس:** لا مفتاح.

### OpenRouter (محوّل مدمج)

| البند | القيمة | الحالة |
|---|---|---|
| الاستدلال | الصيغة الموصى بها `reasoning {effort}`، والقديمة ما زالت تعمل | وثائق |

**حدّ معلن:**

- إعادة `reasoning_details` مع الأدوات (توصي بها الوثائق) لم تُبنَ.
- بعض النماذج خلفه قد تحتاجها.

**ما لم يُقَس:** لا مفتاح.

**المصدر:** openrouter.ai/docs/use-cases/reasoning-tokens

### NVIDIA وMeta وMistral والبقية

| المزوّد | ما يُعرف | الحالة |
|---|---|---|
| NVIDIA | `https://integrate.api.nvidia.com/v1/chat/completions`؛ دعم الأدوات يختلف لكل نموذج ولم يُوثَّق في الصفحة المقروءة | وثائق جزئيًّا |
| Meta Llama API | `https://api.llama.com/compat/v1` | فهرس؛ **صفحة الوثائق تطلب تسجيل الدخول، فلم تُقرأ** |
| Meta (Muse) | `https://api.meta.ai/v1` | فهرس |
| Mistral وTogether وFireworks وCerebras وCohere وPerplexity وغيرها | العناوين من الفهرس أو من صفحاتها | فهرس |

**الصياغة لهذه المجموعة:** الافتراضية للمستضاف: بلا درجة حرارة، و`max_tokens`، و`reasoning_effort` لنموذج يستدلّ مع الإسقاط إن رُفض.

**ما لم يُقَس:** لا مفتاح لأيٍّ منها.

---

## 3. ما بقي مفتوحًا، صراحةً

1. **محوّل OpenAI Responses:** بدونه لا أدوات أصيلة مع أحدث نموذجين عند OpenAI.
2. **أدوات Google الأصيلة مع توقيعات الفكر.**
3. **`reasoning_details` عند OpenRouter.**
4. **قياس حقيقي لأي مزوّد غير Groq:** يحتاج مفتاح المالك.
5. **التعليمات في رسالة المستخدم لنماذج الاستدلال على Groq:** توصية لم تُقَس.
