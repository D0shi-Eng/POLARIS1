// صياغة الطلب لكل مزوّد مستضاف، كما توثّقها صفحته الرسمية. قُرئت كل صفحة في 2026-10-06، والتفصيل والاقتباسات في
// docs/providers/PROVIDERS-2026-10-06.md. لا اسم نموذج هنا: ما يختلف بين نماذج المزوّد الواحد يُحسم في المضيف من علامة
// «يستدلّ» في الفهرس، ومن رفض 400 يسمّي حقلًا اختياريًا فيُعاد النداء بدونه مرة.
//
// الحقول:
//   max_tokens      — اسم حقل سقف المخرجات: "max_tokens" أو "max_completion_tokens".
//   effort          — كيف يُطلب جهد الاستدلال: "reasoning_effort" في أعلى الجسم، أو "enable_thinking" (يُرسل لإطفائه
//                     وحده)، أو "thinking" بصيغة {"type":"disabled"} (لإطفائه وحده)، أو "omit" (افتراض المزوّد).
//   echo_reasoning  — يُعاد `reasoning_content` في رسائل المساعد السابقة.
//   reasoning_split — يُرسل `reasoning_split: true` فيأتي الاستدلال في حقله لا داخل `<think>`.
//
// درجة الحرارة لا تُرسل إلى أيّ مستضاف (قرار في المضيف لا هنا): Kimi وAnthropic ونماذج الاستدلال عند OpenAI ترفض كل قيمة
// غير قيمتها الثابتة، وDeepSeek يتجاهلها في وضع الاستدلال.

const DEFAULT = { max_tokens: "max_tokens", effort: "reasoning_effort", echo_reasoning: false, reasoning_split: false };

export const WIRE = {
  // console.groq.com/docs/api-reference: «max_tokens: Deprecated in favor of max_completion_tokens»؛ reasoning_effort
  // لنماذج الاستدلال. قِيس 2026-10-06: نموذج لا يستدلّ رفض reasoning_effort برمز 400.
  groq: { ...DEFAULT, max_tokens: "max_completion_tokens" },
  // api-docs.deepseek.com/guides/thinking_mode: مع الأدوات «يجب أن يُعاد reasoning_content كاملًا في كل الطلبات
  // اللاحقة» وإلا 400؛ reasoning_effort في أعلى الجسم.
  deepseek: { ...DEFAULT, echo_reasoning: true },
  // platform.kimi.ai/docs/api/chat: «max_completion_tokens (deprecated: max_tokens)»، و«احفظ دائمًا reasoning_content
  // لكل رسالة مساعد سابقة». نماذج K2 تأخذ thinking لا reasoning_effort، فلا يُرسل جهد.
  moonshotai: { ...DEFAULT, max_tokens: "max_completion_tokens", effort: "omit", echo_reasoning: true },
  "moonshotai-cn": { ...DEFAULT, max_tokens: "max_completion_tokens", effort: "omit", echo_reasoning: true },
  // docs.z.ai/api-reference/llm/chat-completion: thinking {type: enabled|disabled}، وclear_thinking افتراضه true فلا
  // يلزم إعادة الاستدلال.
  zai: { ...DEFAULT, effort: "thinking" },
  "zai-coding-plan": { ...DEFAULT, effort: "thinking" },
  zhipuai: { ...DEFAULT, effort: "thinking" },
  // platform.minimax.io/docs/api-reference/text-openai-api: max_completion_tokens مفضَّل، وreasoning_split يفصل
  // الاستدلال، و«يجب أن يُلحق ردّ النموذج كاملًا بسجلّ المحادثة».
  minimax: { ...DEFAULT, max_tokens: "max_completion_tokens", effort: "omit", echo_reasoning: true, reasoning_split: true },
  "minimax-cn": { ...DEFAULT, max_tokens: "max_completion_tokens", effort: "omit", echo_reasoning: true, reasoning_split: true },
  // www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions: enable_thinking في أعلى الجسم عند
  // الطلب المباشر عبر HTTP.
  alibaba: { ...DEFAULT, effort: "enable_thinking" },
  "alibaba-cn": { ...DEFAULT, effort: "enable_thinking" },
  // docs.x.ai/docs/guides/reasoning: reasoning_effort لنماذج الاستدلال.
  xai: { ...DEFAULT },
};
