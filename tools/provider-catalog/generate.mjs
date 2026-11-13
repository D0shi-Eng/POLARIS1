// مولّد فهرس المزوّدات المستضافة (ADR-037).
//
// المصدر: لقطة من https://models.dev/api.json، الفهرس الذي يبني منه OpenCode قائمة مزوّداته. اللقطة لا تُحفظ في
// المستودع (5 ميغابايت)، وما يُحفظ هو الناتج المقلَّص وحده مع تاريخه ومصدره. التشغيل:
//
//   node tools/provider-catalog/generate.mjs <snapshot.json> <retrieved-date>
//
// يُكتب الناتج إلى desktop/host/providers/data/hosted-catalog.json، ويُقرأ في المضيف بـinclude_str.
//
// ما يدخل الفهرس: كل مزوّد في اللقطة يتكلّم بروتوكول OpenAI-compatible على عنوان https ثابت (بلا متغيّر في
// العنوان، وبلا حلقة محلية). المزوّدات المدمجة بمحوّلاتها الخاصة (OpenAI وAnthropic وGoogle وOpenRouter) لا تدخل
// قائمة المستضاف، وتُحفظ نماذجها الموثّقة لتسميتها فقط. اثنا عشر مزوّدًا لا تذكر اللقطة عنوانًا متوافقًا لها،
// فعناوينها من وثائقها الرسمية، والمصدر مذكور بجانب كل واحد.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WIRE } from "./wire.mjs";

const [, , snapshotPath, retrieved] = process.argv;
if (!snapshotPath || !/^\d{4}-\d{2}-\d{2}$/.test(retrieved ?? "")) {
  console.error("usage: node generate.mjs <snapshot.json> <YYYY-MM-DD>");
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "desktop", "host", "providers", "data", "hosted-catalog.json");
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));

/** المزوّدات التي لها محوّل خاص في المضيف: نماذجها للتسمية فقط. */
const BUILTIN = { openai: "openai", anthropic: "anthropic", google: "google", openrouter: "openrouter" };

/** عناوين متوافقة من الوثائق الرسمية لمزوّدات تستعمل في اللقطة حزمة خاصة. */
const VERIFIED = {
  groq: { base_url: "https://api.groq.com/openai/v1", source: "https://console.groq.com/docs/openai" },
  xai: { base_url: "https://api.x.ai/v1", source: "https://docs.x.ai/docs/api-reference" },
  mistral: { base_url: "https://api.mistral.ai/v1", source: "https://docs.mistral.ai/api/" },
  togetherai: { base_url: "https://api.together.xyz/v1", source: "https://docs.together.ai/docs/openai-api-compatibility" },
  cerebras: { base_url: "https://api.cerebras.ai/v1", source: "https://inference-docs.cerebras.ai/resources/openai" },
  deepinfra: { base_url: "https://api.deepinfra.com/v1/openai", source: "https://docs.deepinfra.com/chat/overview" },
  cohere: { base_url: "https://api.cohere.ai/compatibility/v1", source: "https://docs.cohere.com/docs/compatibility-api" },
  perplexity: { base_url: "https://api.perplexity.ai", source: "https://docs.perplexity.ai/docs/sonar/openai-compatibility" },
  minimax: { base_url: "https://api.minimax.io/v1", source: "https://platform.minimaxi.com/docs/api-reference/text-openai-api" },
  venice: { base_url: "https://api.venice.ai/api/v1", source: "https://docs.venice.ai/overview/getting-started" },
  vercel: { base_url: "https://ai-gateway.vercel.sh/v1", source: "https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions" },
};

/** أسماء عرض أوضح لمن يُعرف بمنتجه لا بشركته. */
const NAMES = { alibaba: "Alibaba (Qwen)", moonshotai: "Moonshot AI (Kimi)", "moonshotai-cn": "Moonshot AI China (Kimi)", zai: "Z.AI (GLM)", minimax: "MiniMax", llama: "Meta Llama API", nvidia: "NVIDIA" };

/** ترتيب «الشائعون» في الإعدادات وفي نافذة الاتصال، بعد المدمجة (Anthropic وOpenAI وGoogle وOpenRouter). */
const POPULAR = ["deepseek", "alibaba", "groq", "zai", "xai", "minimax", "moonshotai", "nvidia", "llama", "meta", "mistral", "togetherai", "fireworks-ai", "cerebras", "perplexity"];

/** معرّف POLARIS: شكل `^[a-z][a-z0-9-]{1,47}$`. معرّف يبدأ برقم يُقلب (302ai ← ai302). */
function slug(id) {
  let s = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (/^[0-9]/.test(s)) {
    const m = s.match(/^([0-9]+)(.*)$/);
    s = (m[2].replace(/^-/, "") || "p") + m[1];
  }
  return s.slice(0, 48);
}

function models(provider) {
  return Object.values(provider.models ?? {})
    .filter((m) => typeof m.id === "string" && m.id.length > 0 && m.id.length <= 200)
    .map((m) => [
      m.id,
      typeof m.name === "string" && m.name.length > 0 ? m.name.slice(0, 120) : m.id,
      Number.isInteger(m.limit?.context) ? m.limit.context : 0,
      Number.isInteger(m.limit?.output) ? m.limit.output : 0,
      (m.tool_call ? 1 : 0) | (m.reasoning ? 2 : 0) | (m.attachment ? 4 : 0),
    ])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function host(base) {
  const url = new URL(base);
  if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) throw new Error(`bad base ${base}`);
  return url.hostname.toLowerCase();
}

const hosted = [];
const documented = {};
const seen = new Set();
for (const [key, provider] of Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b))) {
  if (key in BUILTIN) {
    documented[BUILTIN[key]] = models(provider);
    continue;
  }
  const api = typeof provider.api === "string" ? provider.api : "";
  const compatible = (provider.npm === "@ai-sdk/openai-compatible" || provider.npm === "@ai-sdk/openai") && api.startsWith("https://") && !api.includes("${");
  const verified = VERIFIED[key];
  if (!compatible && verified === undefined) continue;
  if (key === "lmstudio") continue;
  const base_url = (verified?.base_url ?? api).replace(/\/+$/, "");
  const id = slug(key);
  if (seen.has(id) || ["openai", "anthropic", "google", "openrouter", "lm-studio", "ollama", "local-openai-compatible"].includes(id)) continue;
  seen.add(id);
  // شكل المتغيّر في العقد: يبدأ بحرف (`302AI_API_KEY` لا يُقرأ؛ المفتاح يُكتب في نافذة الاتصال).
  const env = (provider.env ?? []).find((v) => /^[A-Z][A-Z0-9_]{2,63}$/.test(v)) ?? null;
  hosted.push({
    id,
    name: String(NAMES[key] ?? provider.name ?? key).slice(0, 64),
    popular: POPULAR.includes(key) ? POPULAR.indexOf(key) + 1 : 0,
    base_url,
    host: host(base_url),
    env,
    doc: typeof provider.doc === "string" && provider.doc.startsWith("https://") ? provider.doc : null,
    source: verified?.source ?? "models.dev",
    models: models(provider),
    ...(WIRE[id] ? { wire: WIRE[id] } : {}),
  });
}

const catalog = { source: "https://models.dev/api.json", retrieved, hosted, documented };
writeFileSync(out, JSON.stringify(catalog) + "\n", "utf8");
console.log(`hosted ${hosted.length}, documented ${Object.keys(documented).length}, bytes ${JSON.stringify(catalog).length}`);
