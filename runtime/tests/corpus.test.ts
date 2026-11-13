// اختبارات مجموعة المهام. غرضان: أن تكون المجموعة صالحة ومتنوعة فعلًا،
// وأن تبقى خالية من أي رقم قياس — فـ D1/D2 غير موجودين، وأي رقم هنا سيكون مختلقًا.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { findSecrets } from "@polaris/contracts";

import { ConfigService } from "../src/config/service.js";
import { LocalPdp } from "../src/policy/pdp.js";
import {
  corpusPath,
  buildCaseDescriptor,
  buildCaseInvocation,
  configForCase,
  type CorpusCase,
} from "./helpers.js";

interface Mission {
  mission_id: string;
  title: string;
  category: string;
  narrative: string;
  inputs: Array<{ source: string; expected_trust: string; expected_taint: string[] }>;
  candidate_declassifier: string;
  expected_action_effects: string[];
  expected_approval_need: string;
  expected_policy_outcome: string;
  w4_probe: string;
  w3_evaluable: boolean;
  w3_case?: CorpusCase;
}

interface Corpus {
  corpus_id: string;
  corpus_version: string;
  measurement_status: string;
  vocabularies: Record<string, string[]>;
  missions: Mission[];
}

const corpus = JSON.parse(readFileSync(join(corpusPath(), "missions.json"), "utf8")) as Corpus;

test("the corpus holds exactly twenty missions with unique ids", () => {
  assert.equal(corpus.missions.length, 20);
  assert.equal(new Set(corpus.missions.map((m) => m.mission_id)).size, 20);
});

test("every mission carries the full expected classification matrix", () => {
  for (const mission of corpus.missions) {
    assert.ok(mission.inputs.length > 0, `${mission.mission_id} has no inputs`);
    for (const input of mission.inputs) {
      assert.ok(corpus.vocabularies["expected_trust"]!.includes(input.expected_trust), `${mission.mission_id} trust`);
      for (const taint of input.expected_taint) {
        assert.ok(corpus.vocabularies["expected_taint"]!.includes(taint), `${mission.mission_id} taint ${taint}`);
      }
    }
    assert.ok(mission.candidate_declassifier.length > 0);
    assert.ok(mission.expected_action_effects.length > 0);
    assert.ok(corpus.vocabularies["expected_approval_need"]!.includes(mission.expected_approval_need));
    assert.ok(corpus.vocabularies["expected_policy_outcome"]!.includes(mission.expected_policy_outcome));
    assert.ok(corpus.vocabularies["w4_probe"]!.includes(mission.w4_probe));
    assert.ok(mission.narrative.length > 40, `${mission.mission_id} narrative is too thin to be representative`);
  }
});

test("the corpus is genuinely varied, not one scenario repeated", () => {
  assert.ok(new Set(corpus.missions.map((m) => m.category)).size >= 10, "too few distinct categories");
  assert.ok(new Set(corpus.missions.map((m) => m.narrative)).size === 20, "narratives repeat");
  const outcomes = new Set(corpus.missions.map((m) => m.expected_policy_outcome));
  assert.deepEqual([...outcomes].sort(), ["ALLOW", "DENY"]);
  assert.ok(corpus.missions.filter((m) => m.w4_probe !== "NONE").length >= 12, "too few missions probe D1/D2");
  const taints = new Set(corpus.missions.flatMap((m) => m.inputs.flatMap((i) => i.expected_taint)));
  for (const required of ["UNTRUSTED_WEB", "UNTRUSTED_FILE", "MODEL_GENERATED"]) {
    assert.ok(taints.has(required), `no mission exercises ${required}`);
  }
});

test("the corpus covers the areas W4 must probe", () => {
  const categories = new Set(corpus.missions.map((m) => m.category));
  for (const required of [
    "local_file_read",
    "local_file_write",
    "summarization",
    "extraction",
    "document_analysis",
    "code_analysis",
    "model_proposed_path",
    "untrusted_instruction",
    "web_derived_destination",
    "potential_egress",
    "potential_secret_reference",
    "tool_output_reuse",
    "mixed_trust_inputs",
  ]) {
    assert.ok(categories.has(required), `corpus does not cover ${required}`);
  }
});

test("the corpus states that nothing has been measured", () => {
  assert.equal(corpus.measurement_status, "NOT_MEASURED");
});

test("no mission record carries a measurement, only expectations", () => {
  // يُفحص سجل المهمة نفسه، لا نص التنويه في رأس الوثيقة الذي يذكر كلمة "burden"
  // ليقول صراحة إنه لا يوجد قياس. الفحص على المفاتيح والأرقام، وهو ما يمكن تزييفه فعلًا.
  const METRIC_KEY = /(burden|mean|median|average|percentile|p50|p95|p99|rate|score|count|duration|latency|elapsed)/i;
  const ALLOWED_NUMERIC_KEYS = new Set(["port"]);

  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => { walk(v, `${path}[${String(i)}]`); });
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        assert.equal(METRIC_KEY.test(key), false, `${path}.${key} is a measurement-shaped field`);
        walk(child, `${path}.${key}`);
      }
      return;
    }
    if (typeof value === "number") {
      const leaf = path.slice(path.lastIndexOf(".") + 1);
      assert.ok(ALLOWED_NUMERIC_KEYS.has(leaf), `${path} carries a number (${String(value)}) that is not an expectation`);
    }
  };

  for (const mission of corpus.missions) walk(mission, mission.mission_id);
});

test("the corpus carries no credential-shaped data and no real secret", () => {
  const flat: Record<string, unknown> = {};
  const walk = (value: unknown, prefix: string): void => {
    if (Array.isArray(value)) value.forEach((v, i) => { walk(v, `${prefix}.${String(i)}`); });
    else if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value)) walk(v, prefix === "" ? k : `${prefix}.${k}`);
    } else flat[prefix] = value;
  };
  walk(corpus, "");
  assert.deepEqual(findSecrets(flat, "/"), []);
});

test("every W3-evaluable mission reaches the outcome the corpus predicts", () => {
  const evaluable = corpus.missions.filter((m) => m.w3_evaluable);
  assert.ok(evaluable.length >= 10, "too few missions can be evaluated against the W3 policy set");

  for (const mission of evaluable) {
    const config = new ConfigService();
    const changes = configForCase(mission.w3_case!);
    if (changes.length > 0) {
      const applied = config.apply({ changeset_id: mission.mission_id, origin: "CORE", changes });
      assert.equal(applied.applied, true, `${mission.mission_id} config setup failed`);
    }
    const outcome = new LocalPdp(config).decide({
      invocation: buildCaseInvocation(mission.w3_case!),
      descriptor: buildCaseDescriptor(mission.w3_case!),
    });
    assert.equal(
      outcome.decision["result"],
      mission.expected_policy_outcome,
      `${mission.mission_id} (${mission.title}) expected ${mission.expected_policy_outcome}`,
    );
  }
});
