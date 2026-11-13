// خادم تجهيزة على الحلقة المحلية يقف مكان مزوّد نموذج — TEST FIXTURE.
//
// لماذا خادم حقيقي لا حقن في الكود: المسار الذي نريد إثباته هو المسار الكامل —
// محوّل الإنتاج، ثم توجيه Phase-02، ثم سياسة المحلّية، ثم بوابة الخروج، ثم محوّل
// المزوّد، ثم HTTP. حقن ردّ في منتصف الطريق يثبت أقلّ من ذلك بكثير.
//
// الردود مهيكلة وحتمية: التجهيزة تقرأ عقد المخرجات المُعلن في الطلب وتعيد الشكل
// المطلوب له. ولا تدّعي التجهيزة شيئًا عن الحقيقة: ما تعيده مخرجات نموذج، ويُسجَّل
// مخرجاتِ وكيل مهما بدا واثقًا.
//
// اختيار السيناريو يأتي من هدف المهمّة نفسه عبر وسم `[[FX:NAME]]`، لا من إعداد
// عام للخادم: مهمّة واحدة في التشغيل الواحد تختار سلوكها، فتُقاس عدّة سيناريوهات
// في جلسة تطبيق واحدة بلا إعادة تشغيل.

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";

/** العلامة التي تُكتب في كل دليل ووثيقة. ليست مزوّدًا حقيقيًّا. */
export const FIXTURE_LABEL = "TEST FIXTURE";

/** وسم يُدسّ في سياق المشروع ليُتتبّع في جسم الطلب. */
export const HOSTILE_MARKER = "P03-HOSTILE-MARKER";
/** وسم سياق عادي. */
export const NOTE_MARKER = "P03-NOTE-MARKER";

/** السيناريوهات التي تعرفها التجهيزة. مغلقة: وسم غير معروف يسقط إلى الأساس. */
export const SCENARIOS = Object.freeze([
  "BASELINE",
  "PARALLEL",
  "REVISE",
  "CONFLICT",
  "AGREE",
  "MALFORMED",
  "LOOP",
  "TRUSTED",
  "DELEGATE",
]);

const task = (key, type, role, deps = []) => ({
  local_key: key,
  title: `${type.toLowerCase()} ${key}`,
  objective: `carry out the ${type.toLowerCase()} step named ${key}`,
  task_type: type,
  depends_on: deps,
  dependency_kind: "REQUIRES_SUCCESS",
  recommended_role: role,
});

/** خطط كل سيناريو. البنية وحدها تختلف؛ الشكل واحد ومُتحقَّق منه عند المحوّل. */
const PLANS = Object.freeze({
  // بناء ثم مراجعة: أبسط رسم ذي حافة حقيقية.
  BASELINE: { tasks: [task("build", "BUILD", "BUILDER"), task("review", "REVIEW", "REVIEWER", ["build"])] },
  // عقدتان جاهزتان معًا: لإثبات أن المجموعة الجاهزة تحمل اثنتين وتُخصَّصان.
  PARALLEL: { tasks: [task("left", "BUILD", "BUILDER"), task("right", "BUILD", "BUILDER")] },
  REVISE: { tasks: [task("build", "BUILD", "BUILDER"), task("review", "REVIEW", "REVIEWER", ["build"])] },
  // بناءان مستقلّان يدّعيان القيمة نفسها بخاصيّة واحدة وقيمتين: تعارض مهيكل.
  CONFLICT: { tasks: [task("first", "BUILD", "BUILDER"), task("second", "BUILD", "BUILDER")] },
  // ثلاثة وكلاء يتفقون حرفيًّا: إجماع بلا قياس.
  AGREE: { tasks: [task("a", "BUILD", "BUILDER"), task("b", "BUILD", "BUILDER"), task("c", "BUILD", "BUILDER")] },
  MALFORMED: null,
  LOOP: { tasks: [task("build", "BUILD", "BUILDER"), task("review", "REVIEW", "REVIEWER", ["build"])] },
  // عقدة اختبار واحدة: ما يقيسه المسبار الموثوق.
  TRUSTED: { tasks: [task("verify", "TEST", "TEST_ENGINEER")] },
  DELEGATE: { tasks: [task("build", "BUILD", "BUILDER")] },
});

/** مخرجات لا تطابق أي عقد: تُستعمل لإثبات الرفض المغلق بدل التحليل على الظنّ. */
const MALFORMED_REPLY = "Sure! I think the plan looks good. Let me know if you want changes.";

/**
 * نتيجة تنفيذ. تدّعي الإنجاز ونجاح الاختبارات عمدًا: هذا هو ادّعاء الإنجاز الكاذب
 * الذي يجب أن يبقى غير مُثبَت ما لم يصل دليل مقيس من مسبار موثوق.
 */
function executionReply(scenario, ordinal) {
  const base = {
    output_summary: "the step is complete and all tests pass",
    claims: [
      {
        statement: "all tests pass and the task is complete",
        claim_type: "COMPLETION",
        subject: "deliverable",
        property: "status",
        value: "PASS",
      },
    ],
    evidence: [
      {
        source_ref: `agent:self#${ordinal}`,
        summary: "the agent asserts that the work is done",
        lineage: [`agent:self#${ordinal}`],
      },
    ],
    failed: false,
  };
  if (scenario === "CONFLICT") {
    // الخاصية نفسها بقيمتين: تعارض مهيكل صريح، لا خلاف في الصياغة.
    base.claims[0].value = ordinal === 1 ? "PASS" : "FAIL";
    base.claims[0].statement = ordinal === 1 ? "the deliverable passes" : "the deliverable does not pass";
  }
  if (scenario === "AGREE") {
    // اتفاق حرفي بين ثلاثة وكلاء، وكل واحد بسلالته. الإجماع ليس مرساة ثقة.
    base.claims[0].statement = "the deliverable is correct";
    base.claims[0].claim_type = "FACT";
  }
  return base;
}

function reviewReply(scenario, ordinal) {
  if (scenario === "LOOP") {
    return { verdict: "REVISE", notes: "the output still does not answer the objective; revise the build step" };
  }
  if (scenario === "REVISE") {
    return ordinal === 1
      ? { verdict: "REVISE", notes: "the summary omits the third constraint; name it explicitly" }
      : { verdict: "ACCEPT", notes: "the revised summary names all three constraints" };
  }
  return { verdict: "ACCEPT", notes: "the output answers the objective and names its constraints" };
}

function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  response.end(text);
}

function readBody(request, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/** يقرأ وسم السيناريو من جسم الطلب. وسم غير معروف يسقط إلى الأساس بلا تخمين. */
export function scenarioOf(body) {
  const match = /\[\[FX:([A-Z-]+)\]\]/.exec(body);
  const name = match === null ? "BASELINE" : match[1];
  return SCENARIOS.includes(name) ? name : "BASELINE";
}

/**
 * أي عقد مخرجات يطلبه هذا الطلب: خطّة، أم تنفيذ، أم مراجعة.
 *
 * العلامات المختارة بلا اقتباسات عمدًا: الجسم الذي يصل هنا JSON، فالاقتباس داخل
 * العقد يصل مهرَّبًا (`\"verdict\"`) ولا يطابق علامة تحمل اقتباسًا. علامة عارية
 * تنجو من التهريب، فيبقى التعرّف صحيحًا على النقل الحقيقي لا على النصّ المجرّد.
 */
export function contractOf(body) {
  if (body.includes("ACCEPT|REVISE|REJECT|BLOCKED")) return "review";
  if (body.includes("local_key")) return "plan";
  if (body.includes("output_summary")) return "execute";
  return "unknown";
}

export async function startPhase03Fixture({ onStop } = {}) {
  /** سجل ما وصل: يُقرأ بعد التشغيل لإثبات ما عبر وما لم يعبر. */
  const requests = [];
  /** عدّادات لكل (سيناريو، عقد): تجعل التتابع حتميًّا بلا زمن ولا عشوائية. */
  const counters = new Map();

  const nextOrdinal = (scenario, contract) => {
    const key = `${scenario}|${contract}`;
    const value = (counters.get(key) ?? 0) + 1;
    counters.set(key, value);
    return value;
  };

  /** يبني نصّ الردّ الذي يعود في `message.content`. */
  const replyFor = (body) => {
    const scenario = scenarioOf(body);
    const contract = contractOf(body);
    const ordinal = nextOrdinal(scenario, contract);
    if (contract === "plan") {
      const plan = PLANS[scenario];
      // خطة غائبة تعني سيناريو المخرجات المشوّهة: نثر حرّ يجب أن يُرفض مغلقًا.
      return { scenario, contract, ordinal, content: plan === null ? MALFORMED_REPLY : JSON.stringify(plan) };
    }
    if (contract === "review") {
      return { scenario, contract, ordinal, content: JSON.stringify(reviewReply(scenario, ordinal)) };
    }
    if (contract === "execute") {
      return { scenario, contract, ordinal, content: JSON.stringify(executionReply(scenario, ordinal)) };
    }
    // عقد لا تعرفه التجهيزة: نثر صريح، فيُرفض عند المحوّل بدل أن يُخمَّن.
    return { scenario, contract, ordinal, content: MALFORMED_REPLY };
  };

  const server = createServer(async (request, response) => {
    const path = (request.url ?? "").split("?")[0];

    if (path === "/__fixture/stop") {
      json(response, 200, { stopping: true });
      if (typeof onStop === "function") onStop(requests);
      return;
    }

    if (request.method === "GET" && (path === "/v1/models" || path === "/models")) {
      requests.push({ at: new Date().toISOString(), url: request.url ?? "", kind: "models" });
      return json(response, 200, {
        object: "list",
        data: [{ id: "fixture-chat", object: "model", owned_by: "fixture" }],
      });
    }

    if (request.method === "POST" && path.endsWith("/chat/completions")) {
      const body = await readBody(request);
      let model = "";
      try {
        model = String(JSON.parse(body).model ?? "");
      } catch {
        model = "UNPARSEABLE";
      }
      const reply = replyFor(body);
      // ما يُسجَّل هنا هو ما يُحاسَب عليه لاحقًا: هل عبر وسم معادٍ؟ وهل عبر سرّ؟
      requests.push({
        at: new Date().toISOString(),
        url: request.url ?? "",
        kind: "completion",
        model,
        scenario: reply.scenario,
        contract: reply.contract,
        ordinal: reply.ordinal,
        hostile_marker: body.includes(HOSTILE_MARKER),
        note_marker: body.includes(NOTE_MARKER),
        // لا مفتاح يُتوقَّع هنا: المزوّد المحلي لا يحتاجه، ووجوده انحراف يُسجَّل.
        carried_authorization: request.headers.authorization !== undefined,
        declares_output_contract: body.includes("OUTPUT_CONTRACT"),
        declares_system_policy: body.includes("SYSTEM_POLICY"),
        asks_for_no_reasoning_trace: body.includes("Do not include a reasoning trace"),
        body_bytes: Buffer.byteLength(body),
      });
      return json(response, 200, {
        id: "chatcmpl-p03-fixture",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model || "fixture-chat",
        choices: [{ index: 0, message: { role: "assistant", content: reply.content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
      });
    }

    requests.push({ at: new Date().toISOString(), url: request.url ?? "", kind: "unknown" });
    return json(response, 404, { error: { message: "not found" } });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  return {
    port,
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function writeFile(path, document) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8" });
}

function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const statePath = argument("--state", "");
  const logPath = argument("--log", "");
  const maxSeconds = Number(argument("--max-seconds", "900"));
  if (statePath === "" || logPath === "") {
    console.error("usage: p03-fixture-server.mjs --state <file> --log <file> [--max-seconds N]");
    process.exitCode = 2;
  } else {
    let fixture;
    const stop = async (reason, log) => {
      writeFile(logPath, { tool: "polaris.p03.fixture", label: FIXTURE_LABEL, stopped_at: stamp(), reason, requests: log });
      await fixture?.close();
      process.exit(0);
    };
    fixture = await startPhase03Fixture({ onStop: (log) => void stop("STOP_REQUESTED", log) });
    writeFile(statePath, {
      tool: "polaris.p03.fixture",
      label: FIXTURE_LABEL,
      pid: process.pid,
      started_at: stamp(),
      port: fixture.port,
      endpoint: fixture.endpoint,
      scenarios: SCENARIOS,
    });
    console.log(`fixture ${FIXTURE_LABEL} at ${fixture.endpoint}`);
    setTimeout(() => void stop("MAX_LIFETIME_REACHED", fixture.requests), Math.max(10, maxSeconds) * 1000).unref();
  }
}
