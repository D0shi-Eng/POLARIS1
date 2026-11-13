// تجهيزة الاختبار المحلية لمجموعة E2E الأصلية في Phase-02 — TEST FIXTURE.
//
// خادمان على 127.0.0.1 وحده بمنفذين يختارهما النظام:
//   local  : خادم متوافق مع OpenAI، يقف مكان المزوّد المحلي العام؛
//   remote : يقف مكان مزوّد بعيد في ثنائي القياس وحده (البيئة POLARIS_E2E_REMOTE_FIXTURE).
// ومنفذ ثالث يُحجز ثم يُغلق ليكون «لا شيء يستمع هنا».
//
// لا يُسجَّل جسم أي طلب: السجل يحمل المسار، والنموذج، وهل وصل سياق المشروع،
// وهل حُمل ترويسة تفويض (بلا قيمتها)، وهل قُطع الاتصال قبل الاكتمال.
//
// الاستعمال:
//   node p02-fixture-server.mjs --state <file> --log <file> [--max-seconds 900]
// الإيقاف: GET http://127.0.0.1:<local>/__fixture/stop

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, canonicalJson, stamp } from "./p02-common.mjs";

export const FIXTURE_LABEL = "TEST FIXTURE";
export const FIXTURE_REPLY_PARTS = ["POLARIS ", "fixture reply."];
export const NOTE_MARKER = "P02-NOTE-MARKER";
export const HOSTILE_MARKER = "P02-HOSTILE-MARKER";
const SLOW_CHUNKS = 120;
const SLOW_GAP_MS = 250;

function sse(object) {
  return `data: ${JSON.stringify(object)}\n\n`;
}

function readBody(request, limit = 4 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(""));
  });
}

function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  response.end(text);
}

function streamCompletion(request, response, entry, parts, gapMs) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  let index = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
  };
  request.socket.on("close", () => {
    if (!entry.completed) entry.aborted = true;
    finish();
  });
  const send = () => {
    if (index < parts.length) {
      response.write(sse({ id: "chatcmpl-fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: parts[index] } }] }));
      index += 1;
      return;
    }
    response.write(sse({ id: "chatcmpl-fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: parts.length } }));
    response.write("data: [DONE]\n\n");
    entry.completed = true;
    response.end();
    finish();
  };
  const timer = setInterval(send, gapMs);
  send();
}

/** يبني الخادمين ويعيد وعدًا بعناوينهما وسجلّهما. */
export async function startFixture({ onStop } = {}) {
  const log = [];
  const record = (port, request, extra = {}) => {
    const entry = {
      at: stamp(),
      port,
      method: request.method,
      path: (request.url ?? "").split("?")[0],
      authorization_present: typeof request.headers["authorization"] === "string",
      aborted: false,
      completed: false,
      ...extra,
    };
    log.push(entry);
    return entry;
  };

  const local = createServer(async (request, response) => {
    const path = (request.url ?? "").split("?")[0];
    if (path === "/__fixture/log") return json(response, 200, { label: FIXTURE_LABEL, log });
    if (path === "/__fixture/stop") {
      json(response, 200, { stopping: true });
      setTimeout(() => onStop?.(log), 50);
      return;
    }
    if (request.method === "GET" && path === "/v1/models") {
      const entry = record("local", request);
      entry.completed = true;
      return json(response, 200, { object: "list", data: [{ id: "fixture-chat", object: "model", owned_by: "fixture" }, { id: "fixture-slow", object: "model", owned_by: "fixture" }] });
    }
    if (request.method === "POST" && path === "/v1/chat/completions") {
      const body = await readBody(request);
      let model = "";
      try {
        model = String(JSON.parse(body).model ?? "");
      } catch {
        model = "UNPARSEABLE";
      }
      const entry = record("local", request, {
        model,
        context_marker: body.includes(NOTE_MARKER),
        hostile_marker: body.includes(HOSTILE_MARKER),
      });
      if (model === "fixture-slow") {
        return streamCompletion(request, response, entry, Array.from({ length: SLOW_CHUNKS }, (_, i) => `tick${i} `), SLOW_GAP_MS);
      }
      return streamCompletion(request, response, entry, FIXTURE_REPLY_PARTS, 5);
    }
    record("local", request, { unknown: true }).completed = true;
    return json(response, 404, { error: { message: "not found" } });
  });

  const remote = createServer(async (request, response) => {
    const path = (request.url ?? "").split("?")[0];
    if (request.method === "GET" && path === "/api/v1/models") {
      record("remote", request).completed = true;
      return json(response, 200, {
        data: [{ id: "fixture/remote-chat", name: "Fixture Remote Chat", context_length: 32000, architecture: { input_modalities: ["text"], output_modalities: ["text"] } }],
      });
    }
    if (request.method === "POST" && path.endsWith("/chat/completions")) {
      const body = await readBody(request);
      const entry = record("remote", request, { context_marker: body.includes(NOTE_MARKER), hostile_marker: body.includes(HOSTILE_MARKER) });
      return streamCompletion(request, response, entry, FIXTURE_REPLY_PARTS, 5);
    }
    record("remote", request, { unknown: true }).completed = true;
    return json(response, 404, { error: { message: "not found" } });
  });

  const listen = (server) =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
  const localPort = await listen(local);
  const remotePort = await listen(remote);
  const probe = createServer();
  const closedPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));

  const close = async () => {
    for (const server of [local, remote]) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  };
  return { localPort, remotePort, closedPort, log, close };
}

function writeFile(path, document) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalJson(document), "utf8");
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const statePath = argument("--state", "");
  const logPath = argument("--log", "");
  const maxSeconds = Number(argument("--max-seconds", "900"));
  if (statePath === "" || logPath === "") {
    console.error("usage: p02-fixture-server.mjs --state <file> --log <file> [--max-seconds N]");
    process.exitCode = 2;
  } else {
    let fixture;
    const stop = async (reason, log) => {
      writeFile(logPath, { label: FIXTURE_LABEL, stopped_at: stamp(), reason, requests: log });
      await fixture?.close();
      process.exit(0);
    };
    fixture = await startFixture({ onStop: (log) => void stop("STOP_REQUESTED", log) });
    writeFile(statePath, {
      label: FIXTURE_LABEL,
      pid: process.pid,
      started_at: stamp(),
      local_port: fixture.localPort,
      remote_port: fixture.remotePort,
      closed_port: fixture.closedPort,
    });
    console.log(`fixture local=${fixture.localPort} remote=${fixture.remotePort} closed=${fixture.closedPort}`);
    setTimeout(() => void stop("MAX_LIFETIME_REACHED", fixture.log), Math.max(10, maxSeconds) * 1000).unref();
  }
}
